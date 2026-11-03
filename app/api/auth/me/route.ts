import { NextResponse, type NextRequest } from "next/server";
import { route, rateLimit, noStore } from "@/lib/server/http";
import { UserError } from "@/lib/server/errors";
import { currentUser, requireUser, updateProfile, checkPassword } from "@/lib/server/cloud/auth";
import { deleteAccount } from "@/lib/server/cloud/docs";
import { googleConfigured, devMailbox } from "@/lib/server/cloud/config";
import { mailAvailable } from "@/lib/server/cloud/mail";
import { db } from "@/lib/server/cloud/db";
import { body, clearSession, json } from "@/lib/server/cloud/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (req: NextRequest) => {
  return json({ user: await currentUser(req), features: { google: googleConfigured(), email: mailAvailable(), devMailbox: devMailbox() } });
});

/** Name and synced preferences. */
export const PATCH = route(
  async (req: NextRequest) => {
    const user = await requireUser(req, { verified: false });
    rateLimit(`prefs:${user.id}`, 60);
    const b = await body(req);
    return json({ user: await updateProfile(user, { name: b.name, prefs: b.prefs }) });
  },
  { mutating: true },
);

/** Deletes the account and everything stored in it. Needs the password (or the email, for Google accounts). */
export const DELETE = route(
  async (req: NextRequest) => {
    const user = await requireUser(req, { verified: false });
    rateLimit(`delete:${user.id}`, 5);
    const b = await body(req);
    if (user.hasPassword) {
      const [row] = await (await db()).query<{ password_hash: string }>("select password_hash from users where id = $1", [user.id]);
      if (!(await checkPassword(typeof b.password === "string" ? b.password : "", row.password_hash))) throw new UserError("Your password isn't right.", "bad_login", 401);
    } else if (typeof b.confirm !== "string" || b.confirm.trim().toLowerCase() !== user.email) {
      throw new UserError("Type your email address to confirm.", "confirm");
    }
    await deleteAccount(user);
    return clearSession(req, NextResponse.json({ ok: true }, { headers: noStore }));
  },
  { mutating: true },
);
