import { NextResponse, type NextRequest } from "next/server";
import { route, noStore } from "@/lib/server/http";
import { endSession, endOtherSessions, requireUser } from "@/lib/server/cloud/auth";
import { body, clearSession } from "@/lib/server/cloud/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Signs out this browser, or with {others: true} every other device. */
export const POST = route(
  async (req: NextRequest) => {
    const b = await body(req);
    if (b.others === true) {
      const user = await requireUser(req, { verified: false });
      await endOtherSessions(user.id, req);
      return NextResponse.json({ ok: true }, { headers: noStore });
    }
    await endSession(req);
    return clearSession(req, NextResponse.json({ ok: true }, { headers: noStore }));
  },
  { mutating: true },
);
