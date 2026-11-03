import { NextResponse, type NextRequest } from "next/server";
import { route, rateLimit, noStore } from "@/lib/server/http";
import { UserError } from "@/lib/server/errors";
import { verifyEmail, requireUser, currentUser, sendVerification, clientIp } from "@/lib/server/cloud/auth";
import { baseUrl, body, json, withSession } from "@/lib/server/cloud/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** {token}: confirms the address and signs in. {resend: true}: sends a new link to the signed-in user. */
export const POST = route(
  async (req: NextRequest) => {
    const b = await body(req);
    if (b.resend === true) {
      const user = await requireUser(req, { verified: false });
      rateLimit(`resend:${user.id}`, 2);
      if (user.verified) throw new UserError("Your email is already confirmed.");
      await sendVerification(user, baseUrl(req));
      return json({ ok: true });
    }
    rateLimit(`verify:${clientIp(req)}`, 20);
    const userId = await verifyEmail(b.token);
    const me = await currentUser(req);
    const res = NextResponse.json({ ok: true }, { headers: noStore });
    // the link proves access to the inbox: sign in, unless this browser is already signed in
    return me ? res : withSession(req, res, { id: userId });
  },
  { mutating: true },
);
