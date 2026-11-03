import { NextResponse, type NextRequest } from "next/server";
import { route, noStore, isHttps } from "@/lib/server/http";
import { currentUser, throttle, recordFailure, clearFailures, clientIp } from "@/lib/server/cloud/auth";
import { openShare, unlockShare, proofCookie, proofMaxAge } from "@/lib/server/cloud/docs";
import { body, json } from "@/lib/server/cloud/api";
import { UserError } from "@/lib/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** What a visitor may do with a link. Each successful page view is counted. */
export const GET = route<Ctx>(async (req: NextRequest, { params }) => {
  const { id } = await params;
  const v = await openShare(id, await currentUser(req), req.cookies.get(proofCookie(id))?.value, { count: req.nextUrl.searchParams.get("view") === "1" });
  const { blobKey: _hidden, ...out } = v;
  return json(out);
});

/** {password}: unlocks a password-protected link in this browser for 12 hours. */
export const POST = route<Ctx>(
  async (req: NextRequest, { params }) => {
    const { id } = await params;
    const keys = [`share:${id}:${clientIp(req)}`];
    throttle(keys, 10);
    try {
      const proof = await unlockShare(id, (await body(req)).password);
      clearFailures(keys);
      const res = NextResponse.json({ ok: true }, { headers: noStore });
      res.cookies.set(proofCookie(id), proof, { httpOnly: true, sameSite: "lax", secure: isHttps(req), path: "/", maxAge: proofMaxAge });
      return res;
    } catch (e) {
      if (e instanceof UserError && e.code === "bad_password") recordFailure(keys);
      throw e;
    }
  },
  { mutating: true },
);
