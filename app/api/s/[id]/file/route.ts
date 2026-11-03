import { NextResponse } from "next/server";
import { route, rateLimit, noStore } from "@/lib/server/http";
import { currentUser, clientIp } from "@/lib/server/cloud/auth";
import { shareFileUrl, proofCookie } from "@/lib/server/cloud/docs";
import { json } from "@/lib/server/cloud/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The shared file through a short-lived signed link: ?download=1 to download (if allowed), else to view. */
export const GET = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const { id } = await params;
  rateLimit(`sfile:${clientIp(req)}`, 60);
  const p = req.nextUrl.searchParams;
  const url = await shareFileUrl(id, await currentUser(req), req.cookies.get(proofCookie(id))?.value, p.get("download") === "1");
  if (p.get("json")) return json({ url });
  return NextResponse.redirect(new URL(url, req.url), { status: 303, headers: noStore });
});
