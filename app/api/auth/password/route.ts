import type { NextRequest } from "next/server";
import { route, rateLimit } from "@/lib/server/http";
import { changePassword, requireUser } from "@/lib/server/cloud/auth";
import { body, json } from "@/lib/server/cloud/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Changes (or, for Google accounts, adds) the password and signs out other devices. */
export const POST = route(
  async (req: NextRequest) => {
    const user = await requireUser(req, { verified: false });
    rateLimit(`pw:${user.id}`, 5);
    const b = await body(req);
    await changePassword(user, b.current, b.password, req);
    return json({ ok: true });
  },
  { mutating: true },
);
