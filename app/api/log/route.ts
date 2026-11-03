import { NextResponse, type NextRequest } from "next/server";
import { clientIp, rateLimit } from "@/lib/server/http";
import { UserError } from "@/lib/server/errors";

export const runtime = "nodejs";

/** Browser crash reports, written to the server log. Only the error itself and the page path: no document data. */
export async function POST(req: NextRequest) {
  try {
    rateLimit(`log:${clientIp(req)}`, 10);
  } catch (e) {
    if (e instanceof UserError) return new NextResponse(null, { status: 429 });
    throw e;
  }
  const b = (await req.json().catch(() => ({}))) as { message?: unknown; digest?: unknown; path?: unknown };
  const clip = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").slice(0, n) : "");
  console.error(`[client-error] ${clip(b.path, 200)} ${clip(b.digest, 40)} ${clip(b.message, 300)}`);
  return new NextResponse(null, { status: 204 });
}
