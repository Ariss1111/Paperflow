import { NextResponse } from "next/server";
import { route, rateLimit, noStore } from "@/lib/server/http";
import { requireUser } from "@/lib/server/cloud/auth";
import { downloadUrl } from "@/lib/server/cloud/docs";
import { json } from "@/lib/server/cloud/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A short-lived signed link to the file, issued after the access check. ?inline=1 to view, ?version=N, ?json=1 for the link itself. */
export const GET = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const user = await requireUser(req);
  rateLimit(`dl:${user.id}`, 120);
  const p = req.nextUrl.searchParams;
  const url = await downloadUrl(user, (await params).id, { inline: p.get("inline") === "1", version: p.get("version") ?? undefined });
  if (p.get("json")) return json({ url });
  return NextResponse.redirect(new URL(url, req.url), { status: 303, headers: noStore });
});
