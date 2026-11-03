import "server-only";
import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import { UserError } from "../errors";
import { isHttps } from "../http";
import { newId } from "../ids";
import { cloud } from "./config";
import { db, type Queryable } from "./db";
import { sendMail } from "./mail";

// Accounts: email + password (scrypt) or Google. Sessions are random tokens in an httpOnly cookie;
// the database only keeps their SHA-256, so a leaked database can't be used to sign in.

export const AUTH_COOKIE = "pf_auth";

export interface User {
  id: string;
  email: string;
  name: string;
  verified: boolean;
  hasPassword: boolean;
  google: boolean;
  prefs: Record<string, unknown>;
  createdAt: number;
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string | null;
  email_verified_at: Date | null;
  google_sub: string | null;
  prefs: Record<string, unknown>;
  created_at: Date;
}

const toUser = (r: UserRow): User => ({
  id: r.id,
  email: r.email,
  name: r.name,
  verified: !!r.email_verified_at,
  hasPassword: !!r.password_hash,
  google: !!r.google_sub,
  prefs: r.prefs ?? {},
  createdAt: new Date(r.created_at).getTime(),
});

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const token = () => crypto.randomBytes(32).toString("base64url");

// ------------------------------------------------------------------ passwords

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await new Promise<Buffer>((res, rej) => crypto.scrypt(password.normalize("NFKC"), salt, 32, SCRYPT, (e, k) => (e ? rej(e) : res(k))));
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function checkPassword(password: string, stored: string | null): Promise<boolean> {
  const parts = (stored ?? "").split("$");
  // always do the work, so a missing account takes as long as a wrong password
  const [, N, r, p, saltB64, keyB64] = parts.length === 6 ? parts : ["", "32768", "8", "1", "AAAAAAAAAAAAAAAAAAAAAA", "x"];
  const salt = Buffer.from(saltB64, "base64url");
  const want = Buffer.from(keyB64, "base64url");
  const got = await new Promise<Buffer>((res, rej) => crypto.scrypt(password.normalize("NFKC"), salt, 32, { N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem }, (e, k) => (e ? rej(e) : res(k))));
  return parts.length === 6 && want.length === got.length && crypto.timingSafeEqual(want, got);
}

export function validatePassword(password: unknown): string {
  if (typeof password !== "string" || password.length < 10) throw new UserError("Use a password of at least 10 characters.", "weak_password");
  if (password.length > 200) throw new UserError("That password is too long.", "weak_password");
  if (/^(.)\1+$/.test(password) || /^(?:0123456789|1234567890|password\d*)$/i.test(password)) throw new UserError("That password is too easy to guess. Try a short phrase.", "weak_password");
  return password;
}

export function validateEmail(email: unknown): string {
  const e = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (e.length > 254 || !/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(e)) throw new UserError("Enter a valid email address.", "bad_email");
  return e;
}

const cleanName = (n: unknown) => (typeof n === "string" ? n.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80) : "");

// ------------------------------------------------------------------ sessions

export async function createSession(userId: string, userAgent: string): Promise<{ token: string; maxAge: number }> {
  const t = token();
  const maxAge = cloud.sessionDays * 86400;
  await (await db()).query("insert into sessions (id_hash, user_id, expires_at, user_agent) values ($1, $2, now() + make_interval(secs => $3), $4)", [sha(t), userId, maxAge, userAgent.slice(0, 200)]);
  return { token: t, maxAge };
}

export function cookieOptions(req: NextRequest, maxAge: number) {
  // Lax, so arriving from an email link or Google still finds you signed in; state-changing APIs
  // additionally check the request's origin.
  return { httpOnly: true, sameSite: "lax" as const, secure: isHttps(req), path: "/", maxAge };
}

/** The signed-in user, or null. Expired sessions are treated as signed out. */
export async function currentUser(req: NextRequest): Promise<User | null> {
  const t = req.cookies.get(AUTH_COOKIE)?.value;
  if (!t || !/^[A-Za-z0-9_-]{43}$/.test(t)) return null;
  const d = await db();
  const [row] = await d.query<UserRow & { last_seen_at: Date }>(
    "select u.*, s.last_seen_at from sessions s join users u on u.id = s.user_id where s.id_hash = $1 and s.expires_at > now()",
    [sha(t)],
  );
  if (!row) return null;
  // refresh "last seen" at most every 10 minutes
  if (Date.now() - new Date(row.last_seen_at).getTime() > 600_000) await d.query("update sessions set last_seen_at = now() where id_hash = $1", [sha(t)]);
  return toUser(row);
}

export async function requireUser(req: NextRequest, o: { verified?: boolean } = {}): Promise<User> {
  const u = await currentUser(req);
  if (!u) throw new UserError("Sign in to use your documents.", "signed_out", 401);
  if (o.verified !== false && !u.verified) throw new UserError("Confirm your email address first. We sent you a link when you signed up.", "unverified", 403);
  return u;
}

export async function endSession(req: NextRequest) {
  const t = req.cookies.get(AUTH_COOKIE)?.value;
  if (t) await (await db()).query("delete from sessions where id_hash = $1", [sha(t)]);
}

export async function endOtherSessions(userId: string, req: NextRequest) {
  const t = req.cookies.get(AUTH_COOKIE)?.value ?? "";
  await (await db()).query("delete from sessions where user_id = $1 and id_hash <> $2", [userId, sha(t)]);
}

// ------------------------------------------------------------------ one-time tokens (email verification, password reset)

const TOKEN_HOURS = { verify: 48, reset: 1 } as const;

async function issueToken(q: Queryable, userId: string, kind: keyof typeof TOKEN_HOURS): Promise<string> {
  const t = token();
  // only the newest link of each kind works
  await q.query("delete from tokens where user_id = $1 and kind = $2", [userId, kind]);
  await q.query("insert into tokens (hash, user_id, kind, expires_at) values ($1, $2, $3, now() + make_interval(hours => $4))", [sha(t), userId, kind, TOKEN_HOURS[kind]]);
  return t;
}

/** Uses up a token. Returns the user id, or throws if it's unknown, used or expired. */
async function spendToken(q: Queryable, t: unknown, kind: keyof typeof TOKEN_HOURS): Promise<string> {
  const rows = typeof t === "string" && t.length < 100 ? await q.query<{ user_id: string }>("delete from tokens where hash = $1 and kind = $2 and expires_at > now() returning user_id", [sha(t), kind]) : [];
  if (!rows[0]) throw new UserError(kind === "verify" ? "This confirmation link has expired or was already used. Sign in to get a new one." : "This reset link has expired or was already used. Ask for a new one.", "bad_token", 400);
  return rows[0].user_id;
}

const link = (base: string, path: string, t: string) => `${cloud.appUrl || base}${path}?token=${encodeURIComponent(t)}`;

export async function sendVerification(user: Pick<User, "id" | "email" | "name">, base: string) {
  const t = await issueToken(await db(), user.id, "verify");
  await sendMail(
    user.email,
    "Confirm your Pagelyt email address",
    `Hi${user.name ? ` ${user.name}` : ""},\n\nConfirm your email address to start saving documents in Pagelyt:\n\n${link(base, "/verify", t)}\n\nThe link works for 48 hours. If you didn't create a Pagelyt account, ignore this email.\n`,
  );
}

// ------------------------------------------------------------------ account actions

/**
 * Creates an account and emails a confirmation link; clicking it confirms the address and signs in.
 * The response is the same whether or not the address already has an account (its owner gets an email
 * instead), so sign-up can't be used to find out who uses Pagelyt.
 */
export async function signUp(input: { email: unknown; password: unknown; name: unknown }, base: string): Promise<void> {
  const email = validateEmail(input.email);
  const password = validatePassword(input.password);
  const hash = await hashPassword(password);
  const d = await db();
  const [existing] = await d.query<UserRow>("select * from users where email = $1", [email]);
  if (existing) {
    if (!existing.email_verified_at && existing.password_hash) {
      // never confirmed: the newest sign-up's password wins, and a fresh link goes out
      await d.query("update users set password_hash = $2, name = $3 where id = $1", [existing.id, hash, cleanName(input.name) || existing.name]);
      await sendVerification(toUser(existing), base);
      return;
    }
    await sendMail(email, "Someone tried to create a Pagelyt account with your email", `Someone (maybe you) tried to sign up for Pagelyt with this address, which already has an account.\n\nIf it was you, sign in instead, or reset your password at ${cloud.appUrl || base}/reset.\n`);
    return;
  }
  const [row] = await d.query<UserRow>("insert into users (id, email, name, password_hash) values ($1, $2, $3, $4) returning *", [newId(), email, cleanName(input.name), hash]);
  await sendVerification(toUser(row), base);
}

export async function logIn(emailIn: unknown, password: unknown): Promise<User> {
  const email = typeof emailIn === "string" ? emailIn.trim().toLowerCase() : "";
  const [row] = email ? await (await db()).query<UserRow>("select * from users where email = $1", [email]) : [];
  const ok = await checkPassword(typeof password === "string" ? password : "", row?.password_hash ?? null);
  if (!row || !ok) throw new UserError(row && !row.password_hash ? "This account signs in with Google. Use “Continue with Google”, or reset your password to add one." : "That email and password don't match.", "bad_login", 401);
  return toUser(row);
}

export async function verifyEmail(t: unknown): Promise<string> {
  const d = await db();
  return d.tx(async (q) => {
    const userId = await spendToken(q, t, "verify");
    await q.query("update users set email_verified_at = coalesce(email_verified_at, now()) where id = $1", [userId]);
    return userId;
  });
}

/** Always looks the same from outside, whether or not the address has an account. */
export async function requestReset(emailIn: unknown, base: string) {
  const email = validateEmail(emailIn);
  const [row] = await (await db()).query<UserRow>("select * from users where email = $1", [email]);
  if (!row) return;
  const t = await issueToken(await db(), row.id, "reset");
  await sendMail(email, "Reset your Pagelyt password", `Hi${row.name ? ` ${row.name}` : ""},\n\nUse this link to choose a new password:\n\n${link(base, "/reset/confirm", t)}\n\nThe link works for 1 hour. If you didn't ask for this, ignore this email; your password stays the same.\n`);
}

/** Sets the new password, confirms the email (the link proved access to it) and signs out every device. */
export async function resetPassword(t: unknown, password: unknown): Promise<string> {
  const pw = validatePassword(password);
  const hash = await hashPassword(pw);
  return (await db()).tx(async (q) => {
    const userId = await spendToken(q, t, "reset");
    await q.query("update users set password_hash = $2, email_verified_at = coalesce(email_verified_at, now()) where id = $1", [userId, hash]);
    await q.query("delete from sessions where user_id = $1", [userId]);
    return userId;
  });
}

export async function changePassword(user: User, current: unknown, next: unknown, req: NextRequest) {
  const [row] = await (await db()).query<UserRow>("select * from users where id = $1", [user.id]);
  if (row.password_hash && !(await checkPassword(typeof current === "string" ? current : "", row.password_hash))) throw new UserError("Your current password isn't right.", "bad_login", 401);
  const hash = await hashPassword(validatePassword(next));
  await (await db()).query("update users set password_hash = $2 where id = $1", [user.id, hash]);
  await endOtherSessions(user.id, req);
}

export async function updateProfile(user: User, input: { name?: unknown; prefs?: unknown }): Promise<User> {
  const d = await db();
  if (input.name !== undefined) await d.query("update users set name = $2 where id = $1", [user.id, cleanName(input.name)]);
  if (input.prefs !== undefined) {
    if (!input.prefs || typeof input.prefs !== "object" || Array.isArray(input.prefs)) throw new UserError("Invalid preferences.");
    const json = JSON.stringify(input.prefs);
    if (json.length > 16_000) throw new UserError("Preferences are too large.");
    // merged, so each device only sends what it changed
    await d.query("update users set prefs = prefs || $2::jsonb where id = $1", [user.id, json]);
  }
  const [row] = await d.query<UserRow>("select * from users where id = $1", [user.id]);
  return toUser(row);
}

// ------------------------------------------------------------------ Google

/** Finds or creates the account for a Google identity (Google has verified the email). */
export async function googleUser(sub: string, emailIn: string, name: string): Promise<User> {
  const email = validateEmail(emailIn);
  const d = await db();
  return d.tx(async (q) => {
    const [bySub] = await q.query<UserRow>("select * from users where google_sub = $1", [sub]);
    if (bySub) return toUser(bySub);
    const [byEmail] = await q.query<UserRow>("select * from users where email = $1", [email]);
    if (byEmail) {
      // link Google to the existing account; an unverified password account is reset, since
      // whoever created it never proved they own this address
      const [row] = await q.query<UserRow>(
        "update users set google_sub = $2, email_verified_at = coalesce(email_verified_at, now()), password_hash = case when email_verified_at is null then null else password_hash end where id = $1 returning *",
        [byEmail.id, sub],
      );
      if (!byEmail.email_verified_at) await q.query("delete from sessions where user_id = $1", [byEmail.id]);
      return toUser(row);
    }
    const [row] = await q.query<UserRow>("insert into users (id, email, name, google_sub, email_verified_at) values ($1, $2, $3, $4, now()) returning *", [newId(), email, cleanName(name), sub]);
    return toUser(row);
  });
}

// ------------------------------------------------------------------ login throttling

const g = globalThis as unknown as { __pfLogin?: Map<string, number[]> };
const fails: Map<string, number[]> = (g.__pfLogin ??= new Map());

/** At most `max` failures per key in 15 minutes (keyed by email and by address, separately). */
export function throttle(keys: string[], max = 8) {
  const now = Date.now();
  for (const k of keys) {
    const recent = (fails.get(k) ?? []).filter((t) => now - t < 15 * 60_000);
    fails.set(k, recent);
    if (recent.length >= max) throw new UserError("Too many attempts. Wait 15 minutes and try again, or reset your password.", "throttled", 429);
  }
}
export function recordFailure(keys: string[]) {
  for (const k of keys) fails.set(k, [...(fails.get(k) ?? []), Date.now()]);
  if (fails.size > 100_000) fails.clear();
}
export function clearFailures(keys: string[]) {
  for (const k of keys) fails.delete(k);
}

export { clientIp } from "../http";
