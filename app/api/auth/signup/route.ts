import type { NextRequest } from "next/server";
import { route, rateLimit } from "@/lib/server/http";
import { UserError } from "@/lib/server/errors";
import { signUp, clientIp } from "@/lib/server/cloud/auth";
import { mailAvailable } from "@/lib/server/cloud/mail";
import { baseUrl, body, json } from "@/lib/server/cloud/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Always answers the same way, whether or not the email already has an account. */
export const POST = route(
  async (req: NextRequest) => {
    rateLimit(`signup:${clientIp(req)}`, Number(process.env.RATE_LIMIT_SIGNUPS_PER_MIN || 5));
    if (!mailAvailable()) throw new UserError("Sign-up with email isn't available yet because this server can't send email. Use Continue with Google, or ask the administrator to set up SMTP.", "mail_unavailable", 503);
    const b = await body(req);
    await signUp({ email: b.email, password: b.password, name: b.name }, baseUrl(req));
    return json({ ok: true });
  },
  { mutating: true },
);
