import fs from "node:fs";
import { Readable } from "node:stream";
import { NextResponse, type NextRequest } from "next/server";
import { contentDisposition } from "@/lib/server/http";
import { diskFile, verifyDisk } from "@/lib/server/cloud/blobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Serves a stored file from local disk, only with a valid, unexpired signature (see blobs.ts). */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const key = p.get("k") ?? "";
  const name = p.get("n") ?? "document";
  const mime = p.get("m") ?? "application/octet-stream";
  const inline = p.get("i") === "1";
  if (!verifyDisk(key, Number(p.get("e")), name, mime, inline, p.get("s") ?? "")) {
    return NextResponse.json({ error: "This download link has expired. Go back and try again.", code: "link_expired" }, { status: 403 });
  }
  const file = diskFile(key);
  if (!file) return NextResponse.json({ error: "This file no longer exists.", code: "not_found" }, { status: 404 });
  const size = fs.statSync(file).size;
  return new NextResponse(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(size),
      "Content-Disposition": contentDisposition(name, inline),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      // a document opened in the browser can't run scripts or reach this site's cookies
      "Content-Security-Policy": "sandbox; default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'",
    },
  });
}
