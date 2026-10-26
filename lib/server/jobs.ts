import "server-only";
import fsp from "node:fs/promises";
import path from "node:path";
import { env } from "./env";
import { newId, ownerKey, safeFilename, isId } from "./ids";
import { state, init, dirs, getFile, getJob, registerUpload, type JobRecord } from "./store";
import { UserError, CancelledError } from "./errors";
import { PROCESSORS, type InputFile, type ProcessContext } from "./processors";
import { getTool, type ToolDef } from "@/lib/tools/catalog";
import { sofficePath } from "./libreoffice";
import { FORMATS, IMAGE_INPUTS } from "@/lib/formats";
import { RangeError_ } from "@/lib/pdf/pages";
import type { Job, StoredFile } from "@/types";

let running = 0;
const queue: string[] = [];

const SENSITIVE_OPTIONS = ["password"];

function validateInputs(tool: ToolDef, files: StoredFile[]) {
  const isEditor = tool.ui === "editor";
  const primary = isEditor ? files.slice(0, 1) : files;
  if (primary.length < tool.minFiles) {
    throw new UserError(tool.minFiles === 1 ? "Add a file to continue." : `${tool.name} needs at least ${tool.minFiles} files.`, "too_few_files");
  }
  if (primary.length > tool.maxFiles) throw new UserError(`${tool.name} accepts at most ${tool.maxFiles} file${tool.maxFiles === 1 ? "" : "s"}.`, "too_many_files");
  for (const f of primary) {
    if (!tool.accepts.includes(f.format)) {
      throw new UserError(`${tool.name} doesn't accept ${FORMATS[f.format].label} files (“${f.name}”).`, "unsupported_format", 415);
    }
    if (f.encrypted && f.format === "pdf" && tool.id !== "unlock") {
      throw new UserError(`“${f.name}” is password-protected. Unlock it first with Unlock PDF.`, "encrypted");
    }
  }
  if (isEditor) {
    for (const f of files.slice(1)) {
      if (!IMAGE_INPUTS.includes(f.format)) throw new UserError("Only images can be inserted into a PDF.", "unsupported_format", 415);
    }
  }
  if (tool.requires === "libreoffice" && !sofficePath()) {
    throw new UserError(`${tool.name} needs LibreOffice, which isn't configured on this server.`, "engine_unavailable", 503);
  }
}

function publicOptions(options: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(options)) if (!SENSITIVE_OPTIONS.includes(k)) out[k] = v;
  return out;
}

export function createJob(sessionId: string, toolId: string, fileIds: unknown, options: unknown): Job {
  init();
  const tool = getTool(toolId);
  if (!tool) throw new UserError("Unknown tool.", "unknown_tool", 404);
  const processorId = tool.processor ?? tool.id;
  if (!PROCESSORS[processorId]) throw new UserError("This tool isn't available.", "unknown_tool", 404);
  if (!Array.isArray(fileIds) || fileIds.length === 0 || fileIds.length > 200 || !fileIds.every(isId)) {
    throw new UserError("Choose files to process.", "no_files");
  }
  const opts = options && typeof options === "object" && !Array.isArray(options) ? { ...(options as Record<string, unknown>) } : {};
  if (JSON.stringify(opts).length > 2_000_000) throw new UserError("Options are too large.", "options_too_large", 413);
  Object.assign(opts, tool.fixed ?? {});
  const files = fileIds.map((id) => getFile(sessionId, id).meta);
  validateInputs(tool, files);

  const id = newId();
  const now = Date.now();
  const job: Job = {
    id,
    tool: tool.id,
    toolName: tool.name,
    status: "queued",
    progress: null,
    message: "Waiting to start…",
    inputs: files.map((f) => ({ id: f.id, name: f.name, size: f.size })),
    outputs: [],
    createdAt: now,
    expiresAt: now + env.retentionMs,
  };
  const rec: JobRecord = {
    job,
    owner: ownerKey(sessionId),
    tool: processorId,
    inputIds: files.map((f) => f.id),
    options: opts,
    dir: path.join(dirs.jobs, id),
    outputs: [],
  };
  state.jobs.set(id, rec);
  queue.push(id);
  pump();
  return job;
}

function pump() {
  while (running < env.jobConcurrency && queue.length) {
    const id = queue.shift()!;
    const rec = state.jobs.get(id);
    if (!rec || rec.job.status !== "queued") continue;
    running++;
    run(rec).finally(() => {
      running--;
      pump();
    });
  }
}

async function run(rec: JobRecord) {
  const { job } = rec;
  const controller = new AbortController();
  rec.controller = controller;
  job.status = "processing";
  job.startedAt = Date.now();
  job.message = "Starting…";
  const timer = setTimeout(() => controller.abort(new Error("timeout")), env.jobTimeoutMs);
  await fsp.mkdir(rec.dir, { recursive: true });
  const names = new Set<string>();
  const inputs: InputFile[] = [];
  const ctx: ProcessContext = {
    inputs,
    options: rec.options,
    workDir: path.join(rec.dir, "work"),
    signal: controller.signal,
    progress(p, message) {
      job.progress = p === null ? null : Math.max(0, Math.min(1, p));
      if (message) job.message = message;
    },
    async emit(name, data, mime) {
      if (!data || data.length === 0) throw new Error("processor produced an empty output");
      let safe = safeFilename(name, "output");
      // de-duplicate names inside one job (they become ZIP entries)
      if (names.has(safe.toLowerCase())) {
        const ext = path.extname(safe);
        let k = 2;
        while (names.has(`${path.basename(safe, ext)} (${k})${ext}`.toLowerCase())) k++;
        safe = `${path.basename(safe, ext)} (${k})${ext}`;
      }
      names.add(safe.toLowerCase());
      const index = rec.outputs.length;
      const p = path.join(rec.dir, `out-${index}`);
      await fsp.writeFile(p, data);
      rec.outputs.push({ path: p });
      job.outputs.push({ index, name: safe, mime, size: data.length });
    },
    summary: {},
    notes: [],
  };
  try {
    for (const id of rec.inputIds) {
      const f = state.files.get(id);
      if (!f) throw new UserError("An input file expired before processing started.", "not_found", 404);
      inputs.push({ id, name: f.meta.name, format: f.meta.format, path: f.path, size: f.meta.size, read: async () => new Uint8Array(await fsp.readFile(f.path)) });
    }
    await PROCESSORS[rec.tool](ctx);
    if (job.outputs.length === 0) throw new UserError("Processing finished without producing a file.", "no_output", 500);
    job.status = "completed";
    job.progress = 1;
    job.message = "Done";
    job.summary = ctx.summary;
    job.notes = ctx.notes;
  } catch (e) {
    const err = e as Error;
    const reason = controller.signal.reason;
    const timedOut = controller.signal.aborted && reason instanceof Error && reason.message === "timeout";
    if (rec.cancelRequested) {
      job.status = "cancelled";
      job.message = "Cancelled";
    } else if (timedOut || (err instanceof CancelledError && controller.signal.aborted)) {
      job.status = "failed";
      job.error = `Processing took longer than ${Math.round(env.jobTimeoutMs / 1000)} seconds and was stopped. Try a smaller file or fewer pages.`;
    } else if (err instanceof UserError || err instanceof RangeError_) {
      job.status = "failed";
      job.error = err.message;
    } else {
      job.status = "failed";
      job.error = "Something went wrong while processing this document. It may be damaged or use features we can't handle yet.";
      // Log the failure class only — never document contents or options (which may hold passwords).
      console.error(`[job ${job.id}] ${rec.tool} failed: ${err?.name ?? "Error"}: ${String(err?.message ?? "").slice(0, 200)}`);
    }
    job.progress = null;
    // drop partial outputs
    for (const o of rec.outputs) await fsp.rm(o.path, { force: true });
    rec.outputs = [];
    job.outputs = [];
  } finally {
    clearTimeout(timer);
    rec.controller = undefined;
    job.finishedAt = Date.now();
    // secrets are not needed after the run
    for (const k of SENSITIVE_OPTIONS) delete rec.options[k];
    await fsp.rm(path.join(rec.dir, "work"), { recursive: true, force: true });
  }
}

export function cancelJob(sessionId: string, id: string): Job {
  const rec = getJob(sessionId, id);
  if (rec.job.status === "queued") {
    rec.job.status = "cancelled";
    rec.job.message = "Cancelled";
    rec.job.finishedAt = Date.now();
  } else if (rec.job.status === "processing") {
    rec.cancelRequested = true;
    rec.job.message = "Cancelling…";
    rec.controller?.abort();
  }
  return rec.job;
}

export function retryJob(sessionId: string, id: string, options?: Record<string, unknown>): Job {
  const rec = getJob(sessionId, id);
  if (rec.job.status !== "failed" && rec.job.status !== "cancelled") throw new UserError("Only failed or cancelled jobs can be retried.");
  // passwords were wiped after the first run; the client re-sends them
  return createJob(sessionId, rec.job.tool, rec.inputIds, { ...publicOptions(rec.options), ...(options ?? {}) });
}

export function jobOutput(sessionId: string, id: string, index: number) {
  const rec = getJob(sessionId, id);
  if (rec.job.status !== "completed") throw new UserError("This job has no downloadable result.", "not_ready", 409);
  const meta = rec.job.outputs[index];
  const file = rec.outputs[index];
  if (!meta || !file) throw new UserError("That result doesn't exist.", "not_found", 404);
  return { meta, path: file.path, job: rec.job };
}

/** Registers a job output as a new session file so it can be fed into another tool. */
export async function outputToFile(sessionId: string, id: string, index: number): Promise<StoredFile> {
  const { meta, path: p } = jobOutput(sessionId, id, index);
  const tmp = path.join(dirs.incoming, newId());
  await fsp.mkdir(dirs.incoming, { recursive: true });
  await fsp.copyFile(p, tmp);
  return registerUpload(sessionId, tmp, meta.name, id);
}
