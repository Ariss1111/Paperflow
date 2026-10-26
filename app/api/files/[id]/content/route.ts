import fs from "node:fs";
import { Readable } from "node:stream";
import { route, sessionId, contentDisposition } from "@/lib/server/http";
import { getFile } from "@/lib/server/store";
import { FORMATS } from "@/lib/formats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Streams an uploaded file back to its owner (used for previews and the editor). */
export const GET = route<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const f = getFile(sessionId(req), id);
  const kind = FORMATS[f.meta.format].kind;
  // Only PDFs and raster images are ever rendered inline; everything else downloads.
  const inline = f.meta.format === "pdf" || (kind === "image" && f.meta.format !== "svg");
  return new Response(Readable.toWeb(fs.createReadStream(f.path)) as ReadableStream, {
    headers: {
      "Content-Type": inline ? f.meta.mime : "application/octet-stream",
      "Content-Length": String(f.meta.size),
      "Content-Disposition": contentDisposition(f.meta.name, inline),
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "Cache-Control": "private, no-store",
    },
  });
});
