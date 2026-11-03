import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { noStore } from "../http";
import { UserError } from "../errors";
import { cloud } from "./config";
import { AUTH_COOKIE, cookieOptions, createSession, type User } from "./auth";
import { startCleanup } from "./docs";

// Small helpers shared by the account and document API routes.

export function json(data: unknown, status = 200) {
  startCleanup();
  return NextResponse.json(data, { status, headers: noStore });
}

/** Signs the user in on this response (a new session cookie). */
export async function withSession(req: NextRequest, res: NextResponse, user: Pick<User, "id">) {
  const s = await createSession(user.id, req.headers.get("user-agent") ?? "");
  res.cookies.set(AUTH_COOKIE, s.token, cookieOptions(req, s.maxAge));
  return res;
}

export function clearSession(req: NextRequest, res: NextResponse) {
  res.cookies.set(AUTH_COOKIE, "", cookieOptions(req, 0));
  return res;
}

/**
 * The site's own address, for links in emails and Google's redirect. In production it comes only from
 * configuration (APP_URL, or RENDER_EXTERNAL_URL which Render sets): request headers can be forged, and a
 * forged Host would put an attacker's address in password-reset emails.
 */
export function baseUrl(req: NextRequest): string {
  if (cloud.appUrl) return cloud.appUrl;
  if (process.env.NODE_ENV === "production" && process.env.DEV_MAILBOX !== "1") {
    throw new UserError("This server's public address isn't configured (APP_URL), so it can't send links yet.", "config", 503);
  }
  return `${req.nextUrl.protocol}//${req.headers.get("host") ?? req.nextUrl.host}`;
}

export async function body<T = Record<string, unknown>>(req: NextRequest): Promise<T> {
  return ((await req.json().catch(() => null)) ?? {}) as T;
}

/** Only same-site paths are allowed as "where to go next" after signing in. */
export function safeNext(next: unknown): string {
  return typeof next === "string" && /^\/(?![/\\])[\w\-./?=&%#~]*$/.test(next) ? next : "/files";
}
