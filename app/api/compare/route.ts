import fsp from "node:fs/promises";
import { NextResponse, type NextRequest } from "next/server";
import { route, sessionId, rateLimit } from "@/lib/server/http";
import { getFile } from "@/lib/server/store";
import { UserError } from "@/lib/server/errors";
import { compareDocuments } from "@/lib/server/compare-docs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Compares the text of two of the session's PDFs, paragraph by paragraph. Runs locally; no AI involved. */
export const POST = route(
  async (req: NextRequest) => {
    const sid = sessionId(req);
    rateLimit(`compare:${sid}`, 30);
    const body = (await req.json().catch(() => null)) as { fileId?: unknown; otherId?: unknown } | null;
    if (typeof body?.fileId !== "string" || typeof body?.otherId !== "string") throw new UserError("Choose two documents to compare.");
    const [a, b] = [getFile(sid, body.fileId), getFile(sid, body.otherId)];
    for (const f of [a, b]) {
      if (f.meta.format !== "pdf") throw new UserError(`“${f.meta.name}” isn't a PDF. Comparison works with two PDFs.`, "unsupported_format", 415);
      if (f.meta.encrypted) throw new UserError(`“${f.meta.name}” is password-protected. Unlock it first.`, "encrypted");
    }
    const result = compareDocuments(new Uint8Array(await fsp.readFile(a.path)), new Uint8Array(await fsp.readFile(b.path)), a.meta.name, b.meta.name, req.signal);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  },
  { mutating: true },
);
