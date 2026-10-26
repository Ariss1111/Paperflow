import fs from "node:fs";
import { Readable, PassThrough } from "node:stream";
import { ZipArchive } from "archiver";
import { route, sessionId, contentDisposition } from "@/lib/server/http";
import { getJob } from "@/lib/server/store";
import { jobOutput } from "@/lib/server/jobs";
import { UserError } from "@/lib/server/errors";
import { safeFilename } from "@/lib/server/ids";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const SAFE_HEADERS = {
  // downloads are never rendered in our origin (protects against HTML/SVG outputs)
  "Content-Security-Policy": "sandbox; default-src 'none'",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "private, no-store",
};

/**
 * Session-bound download. `?i=N` streams one output; `?all=1` streams a ZIP of every output.
 * Links stop working when the job expires (retention period) or from another browser session.
 */
export const GET = route<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const sid = sessionId(req);
  const all = req.nextUrl.searchParams.get("all") === "1";
  if (!all) {
    const index = Number(req.nextUrl.searchParams.get("i") ?? "0");
    if (!Number.isInteger(index) || index < 0) throw new UserError("Invalid result index.");
    const { meta, path } = jobOutput(sid, id, index);
    return new Response(Readable.toWeb(fs.createReadStream(path)) as ReadableStream, {
      headers: {
        ...SAFE_HEADERS,
        "Content-Type": meta.mime,
        "Content-Length": String(meta.size),
        "Content-Disposition": contentDisposition(meta.name),
      },
    });
  }
  const rec = getJob(sid, id);
  if (rec.job.status !== "completed") throw new UserError("This job has no downloadable result.", "not_ready", 409);
  const zip = new ZipArchive({ zlib: { level: 6 } });
  const pass = new PassThrough();
  zip.on("error", (e) => pass.destroy(e));
  zip.pipe(pass);
  rec.job.outputs.forEach((o, i) => zip.file(rec.outputs[i].path, { name: o.name }));
  void zip.finalize();
  const name = `${safeFilename(rec.job.toolName.toLowerCase().replace(/\s+/g, "-"))}-results.zip`;
  return new Response(Readable.toWeb(pass) as ReadableStream, {
    headers: { ...SAFE_HEADERS, "Content-Type": "application/zip", "Content-Disposition": contentDisposition(name) },
  });
});
