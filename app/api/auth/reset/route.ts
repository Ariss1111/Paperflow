import { NextResponse, type NextRequest } from "next/server";
import { route, rateLimit, noStore } from "@/lib/server/http";
import { requestReset, resetPassword, clientIp } from "@/lib/server/cloud/auth";
import { mailAvailable } from "@/lib/server/cloud/mail";
import { UserError } from "@/lib/server/errors";
import { baseUrl, body, json, withSession } from "@/lib/server/cloud/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** {email}: emails a reset link (same answer whether or not the account exists). {token, password}: sets it. */
export const POST = route(
  async (req: NextRequest) => {
    const b = await body(req);
    rateLimit(`reset:${clientIp(req)}`, 5);
    if (typeof b.token === "string") {
      const userId = await resetPassword(b.token, b.password);
      return withSession(req, NextResponse.json({ ok: true }, { headers: noStore }), { id: userId });
    }
    if (!mailAvailable()) throw new UserError("Password reset by email isn't available because this server can't send email yet.", "mail_unavailable", 503);
    await requestReset(b.email, baseUrl(req));
    return json({ ok: true });
  },
  { mutating: true },
);
