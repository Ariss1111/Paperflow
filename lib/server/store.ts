import "server-only";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { env } from "./env";
import { newId, ownerKey, safeFilename } from "./ids";
import { detectFormat } from "./detect";
import { scanFile } from "./scan";
import { UserError } from "./errors";
import { inspect, openDoc, hasTextLayer } from "@/lib/pdf/mu";
import { imageMeta } from "@/lib/conversion/images";
import { FORMATS, type FormatId } from "@/lib/formats";
import type { StoredFile, Job } from "@/types";

export interface FileRecord {
  meta: StoredFile;
  owner: string;
  path: string;
}

export interface JobRecord {
  job: Job;
  owner: string;
  tool: string;
  inputIds: string[];
  options: Record<string, unknown>;
  dir: string;
  outputs: { path: string }[];
  controller?: AbortController;
  cancelRequested?: boolean;
}

interface State {
  files: Map<string, FileRecord>;
  jobs: Map<string, JobRecord>;
  sweeper?: NodeJS.Timeout;
  initialised?: boolean;
}

// Survives Next.js dev hot reloads.
const g = globalThis as unknown as { __paperflow?: State };
export const state: State = (g.__paperflow ??= { files: new Map(), jobs: new Map() });

export const dirs = {
  files: path.join(env.dataDir, "files"),
  jobs: path.join(env.dataDir, "jobs"),
  incoming: path.join(env.dataDir, "incoming"),
};

export function init() {
  if (state.initialised) return;
  state.initialised = true;
  // State is in memory, so anything on disk from a previous process is orphaned: remove it.
  for (const d of Object.values(dirs)) {
    fs.rmSync(d, { recursive: true, force: true });
    fs.mkdirSync(d, { recursive: true });
  }
  state.sweeper = setInterval(sweep, 60_000);
  state.sweeper.unref?.();
}

export async function sweep(now = Date.now()) {
  for (const [id, f] of state.files) {
    if (f.meta.expiresAt <= now) {
      state.files.delete(id);
      await fsp.rm(f.path, { force: true });
    }
  }
  for (const [id, j] of state.jobs) {
    if (j.job.expiresAt <= now && j.job.status !== "processing") {
      state.jobs.delete(id);
      await fsp.rm(j.dir, { recursive: true, force: true });
    }
  }
}

export function ownerDir(sessionId: string) {
  return path.join(dirs.files, ownerKey(sessionId));
}

/** Validates an uploaded temp file by content, moves it into the session's storage and registers it. */
export async function registerUpload(sessionId: string, tempPath: string, originalName: string, sourceJobId?: string): Promise<StoredFile> {
  init();
  try {
    const stat = await fsp.stat(tempPath);
    if (stat.size === 0) throw new UserError(`“${safeFilename(originalName)}” is empty.`, "empty_file");
    const format = await detectFormat(tempPath, originalName);
    await scanFile(tempPath);
    const meta: StoredFile = {
      id: newId(),
      name: normaliseName(originalName, format),
      size: stat.size,
      format,
      mime: FORMATS[format].mime,
      createdAt: Date.now(),
      expiresAt: Date.now() + env.retentionMs,
      sourceJobId,
    };
    if (format === "pdf") {
      const bytes = new Uint8Array(await fsp.readFile(tempPath));
      const info = inspect(bytes);
      meta.pages = info.pages ?? undefined;
      meta.encrypted = info.encrypted;
      if (!info.needsPassword && info.pages) {
        // a document with no text on its first pages is very likely a scan
        const doc = openDoc(bytes);
        const probe = Math.min(3, info.pages);
        let withText = 0;
        for (let i = 0; i < probe; i++) if (hasTextLayer(doc, i)) withText++;
        meta.scanned = withText === 0;
      }
    } else if (FORMATS[format].kind === "image") {
      await imageMeta(new Uint8Array(await fsp.readFile(tempPath)));
    }
    const dir = ownerDir(sessionId);
    await fsp.mkdir(dir, { recursive: true });
    const finalPath = path.join(dir, meta.id);
    await fsp.rename(tempPath, finalPath).catch(async () => {
      await fsp.copyFile(tempPath, finalPath);
      await fsp.rm(tempPath, { force: true });
    });
    state.files.set(meta.id, { meta, owner: ownerKey(sessionId), path: finalPath });
    return meta;
  } catch (e) {
    await fsp.rm(tempPath, { force: true });
    if (e instanceof UserError) {
      // prefix with the file name so multi-file uploads say which file failed
      throw new UserError(e.message.includes("“") ? e.message : `${safeFilename(originalName)}: ${e.message}`, e.code, e.status);
    }
    throw e;
  }
}

function normaliseName(name: string, format: FormatId): string {
  const safe = safeFilename(name, `document.${FORMATS[format].ext}`);
  return safe;
}

export function getFile(sessionId: string, id: string): FileRecord {
  const f = state.files.get(id);
  // Same error for "missing" and "someone else's": never confirm existence across sessions.
  if (!f || f.owner !== ownerKey(sessionId) || f.meta.expiresAt <= Date.now()) {
    throw new UserError("This file is no longer available. Files are deleted automatically after the retention period.", "not_found", 404);
  }
  return f;
}

export function listFiles(sessionId: string): StoredFile[] {
  const key = ownerKey(sessionId);
  return [...state.files.values()].filter((f) => f.owner === key && f.meta.expiresAt > Date.now()).map((f) => f.meta).sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteFile(sessionId: string, id: string) {
  const f = getFile(sessionId, id);
  state.files.delete(id);
  await fsp.rm(f.path, { force: true });
}

export function renameFile(sessionId: string, id: string, name: string): StoredFile {
  const f = getFile(sessionId, id);
  const ext = FORMATS[f.meta.format].ext;
  let clean = safeFilename(name, f.meta.name);
  if (!clean.toLowerCase().endsWith(`.${ext}`) && !(FORMATS[f.meta.format].aliases ?? []).some((a) => clean.toLowerCase().endsWith(`.${a}`))) {
    clean = `${clean}.${ext}`;
  }
  f.meta.name = clean;
  return f.meta;
}

export function getJob(sessionId: string, id: string): JobRecord {
  const j = state.jobs.get(id);
  if (!j || j.owner !== ownerKey(sessionId)) throw new UserError("This job doesn't exist or has expired.", "not_found", 404);
  return j;
}

export function listJobs(sessionId: string): Job[] {
  const key = ownerKey(sessionId);
  return [...state.jobs.values()].filter((j) => j.owner === key).map((j) => j.job).sort((a, b) => b.createdAt - a.createdAt);
}
