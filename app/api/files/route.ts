import { NextResponse, type NextRequest } from "next/server";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import Busboy from "busboy";
import { route, sessionId, rateLimit, noStore } from "@/lib/server/http";
import { env } from "@/lib/server/env";
import { dirs, listFiles, registerUpload } from "@/lib/server/store";
import { newId, safeFilename } from "@/lib/server/ids";
import { UserError } from "@/lib/server/errors";
import { formatBytes } from "@/lib/utils";
import type { StoredFile } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  return NextResponse.json({ files: listFiles(sessionId(req)) }, { headers: noStore });
});

interface Incoming {
  name: string;
  tmp: string;
  truncated: boolean;
}

/** Streams multipart uploads straight to disk; files are never held in memory whole. */
export const POST = route(
  async (req) => {
    const sid = sessionId(req);
    rateLimit(`up:${sid}`, env.uploadsPerMin);
    const type = req.headers.get("content-type") ?? "";
    if (!type.startsWith("multipart/form-data") || !req.body) throw new UserError("Send files as multipart/form-data.", "bad_request");
    await fsp.mkdir(dirs.incoming, { recursive: true });

    const incoming: Incoming[] = [];
    const writes: Promise<void>[] = [];
    let tooMany = false;
    const bb = Busboy({
      headers: { "content-type": type },
      limits: { fileSize: env.maxUploadBytes, files: env.maxFilesPerRequest, fields: 10, fieldSize: 1024 },
      defParamCharset: "utf8",
    });
    bb.on("file", (_field, stream, info) => {
      const item: Incoming = { name: safeFilename(info.filename || "upload"), tmp: path.join(dirs.incoming, newId()), truncated: false };
      incoming.push(item);
      stream.on("limit", () => {
        item.truncated = true;
      });
      writes.push(pipeline(stream, fs.createWriteStream(item.tmp)));
    });
    bb.on("filesLimit", () => {
      tooMany = true;
    });
    try {
      await pipeline(Readable.fromWeb(req.body as import("node:stream/web").ReadableStream), bb);
      await Promise.all(writes);
    } catch {
      await Promise.all(incoming.map((f) => fsp.rm(f.tmp, { force: true })));
      throw new UserError("The upload was interrupted. Please try again.", "upload_failed");
    }

    const files: StoredFile[] = [];
    const errors: { name: string; error: string; code?: string }[] = [];
    if (tooMany) errors.push({ name: "", error: `Only ${env.maxFilesPerRequest} files can be uploaded at once; the rest were skipped.`, code: "too_many_files" });
    for (const f of incoming) {
      if (f.truncated) {
        await fsp.rm(f.tmp, { force: true });
        errors.push({ name: f.name, error: `“${f.name}” is larger than the ${formatBytes(env.maxUploadBytes)} limit.`, code: "too_large" });
        continue;
      }
      try {
        files.push(await registerUpload(sid, f.tmp, f.name));
      } catch (e) {
        if (e instanceof UserError) errors.push({ name: f.name, error: e.message, code: e.code });
        else {
          console.error(`[upload] ${(e as Error)?.name}: ${String((e as Error)?.message).slice(0, 200)}`);
          errors.push({ name: f.name, error: `“${f.name}” couldn't be processed.`, code: "internal" });
        }
      }
    }
    if (incoming.length === 0) throw new UserError("No files were received.", "no_files");
    const status = files.length ? 200 : errors.some((e) => e.code === "too_large") ? 413 : 422;
    return NextResponse.json({ files, errors }, { status, headers: noStore });
  },
  { mutating: true },
);
