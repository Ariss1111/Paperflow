import fsp from "node:fs/promises";
import { NextResponse, type NextRequest } from "next/server";
import { route, sessionId, rateLimit } from "@/lib/server/http";
import { getFile } from "@/lib/server/store";
import { UserError } from "@/lib/server/errors";
import { startAi, AI_TASKS, type AiTask, type AiDoc, type SummaryStyle } from "@/lib/server/ai";
import { perMinute } from "@/lib/server/ai/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  fileId?: unknown;
  otherId?: unknown;
  task?: unknown;
  language?: unknown;
  style?: unknown;
  conversation?: unknown;
}

async function readDoc(sid: string, id: string): Promise<AiDoc> {
  const file = getFile(sid, id);
  if (file.meta.encrypted) throw new UserError(`“${file.meta.name}” is password-protected. Unlock it first.`, "encrypted");
  return { bytes: new Uint8Array(await fsp.readFile(file.path)), mime: file.meta.mime, name: file.meta.name, pages: file.meta.pages };
}

/**
 * Runs an AI task on the session's documents.
 * Response: newline-delimited JSON events ({t:"text"|"progress"|"notice"|"data"|"error"|"done"}), streamed as the AI writes.
 */
export const POST = route(
  async (req: NextRequest) => {
    const sid = sessionId(req);
    rateLimit(`ai:${sid}`, perMinute());
    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body || typeof body.fileId !== "string") throw new UserError("Choose a document first.");
    if (!AI_TASKS.includes(body.task as AiTask)) throw new UserError("Unknown AI task.");
    const conversation = Array.isArray(body.conversation)
      ? body.conversation
          .slice(-40)
          .filter((m): m is { role: "user" | "assistant"; content: string } => !!m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
          .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }))
      : [];
    const events = await startAi(
      {
        task: body.task as AiTask,
        doc: await readDoc(sid, body.fileId),
        other: typeof body.otherId === "string" ? await readDoc(sid, body.otherId) : undefined,
        conversation,
        language: typeof body.language === "string" ? body.language.slice(0, 40) : "",
        style: typeof body.style === "string" ? (body.style as SummaryStyle) : undefined,
      },
      sid,
      req.signal,
    );
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const next = await events.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(JSON.stringify(next.value) + "\n"));
      },
      async cancel() {
        await events.return(undefined);
      },
    });
    return new NextResponse(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
  },
  { mutating: true },
);
