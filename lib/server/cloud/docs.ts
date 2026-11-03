import "server-only";
import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { env } from "../env";
import { UserError } from "../errors";
import { newId, safeFilename } from "../ids";
import { detectFormat } from "../detect";
import { scanFile } from "../scan";
import { getFile, registerUpload } from "../store";
import { inspect } from "@/lib/pdf/mu";
import { FORMATS, type FormatId } from "@/lib/formats";
import type { StoredFile } from "@/types";
import { authSecret, cloud } from "./config";
import { blobs, newBlobKey } from "./blobs";
import { db, type Queryable } from "./db";
import { checkPassword, hashPassword, validateEmail, type User } from "./auth";

// A signed-in user's documents. Every query here is scoped by user_id, and "not yours" looks
// exactly like "doesn't exist" (404), so ids can't be probed.

export interface CloudDoc {
  id: string;
  name: string;
  format: FormatId;
  mime: string;
  size: number;
  pages: number | null;
  version: number;
  favorite: boolean;
  folderId: string | null;
  createdAt: number;
  updatedAt: number;
  openedAt: number | null;
  deletedAt: number | null;
  shared: boolean;
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
}

interface DocRow {
  id: string;
  user_id: string;
  folder_id: string | null;
  name: string;
  format: FormatId;
  mime: string;
  size: number;
  pages: number | null;
  blob_key: string;
  version: number;
  favorite: boolean;
  created_at: Date;
  updated_at: Date;
  opened_at: Date | null;
  deleted_at: Date | null;
  shared?: boolean;
}

const ms = (d: Date | null) => (d ? new Date(d).getTime() : null);
const toDoc = (r: DocRow): CloudDoc => ({
  id: r.id,
  name: r.name,
  format: r.format,
  mime: r.mime,
  size: Number(r.size),
  pages: r.pages,
  version: r.version,
  favorite: r.favorite,
  folderId: r.folder_id,
  createdAt: ms(r.created_at)!,
  updatedAt: ms(r.updated_at)!,
  openedAt: ms(r.opened_at),
  deletedAt: ms(r.deleted_at),
  shared: !!r.shared,
});

const NOT_FOUND = () => new UserError("This document doesn't exist or you don't have access to it.", "not_found", 404);
const isId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{22}$/.test(v);

async function event(q: Queryable, userId: string, documentId: string | null, kind: string, detail: Record<string, unknown> = {}) {
  await q.query("insert into events (id, user_id, document_id, kind, detail) values ($1, $2, $3, $4, $5)", [newId(), userId, documentId, kind, JSON.stringify(detail)]);
}

async function ownDoc(q: Queryable, user: User, id: unknown, o: { trashed?: boolean } = {}): Promise<DocRow> {
  if (!isId(id)) throw NOT_FOUND();
  const [row] = await q.query<DocRow>(`select * from documents where id = $1 and user_id = $2 and deleted_at is ${o.trashed ? "not null" : "null"}`, [id, user.id]);
  if (!row) throw NOT_FOUND();
  return row;
}

async function ownFolder(q: Queryable, user: User, id: unknown): Promise<string | null> {
  if (id === null || id === undefined || id === "") return null;
  if (!isId(id)) throw new UserError("That folder doesn't exist.", "not_found", 404);
  const [f] = await q.query<{ id: string }>("select id from folders where id = $1 and user_id = $2", [id, user.id]);
  if (!f) throw new UserError("That folder doesn't exist.", "not_found", 404);
  return f.id;
}

// ------------------------------------------------------------------ storage

export interface StorageStats {
  used: number;
  quota: number;
  available: number;
  documents: number;
  versions: number;
  trash: number;
  largest: Pick<CloudDoc, "id" | "name" | "size" | "format">[];
  recent: Pick<CloudDoc, "id" | "name" | "size" | "format" | "createdAt">[];
}

/** Every stored version counts, including documents in the trash. */
async function usedBytes(q: Queryable, userId: string): Promise<number> {
  const [r] = await q.query<{ used: number }>("select coalesce(sum(v.size), 0)::float8 as used from versions v join documents d on d.id = v.document_id where d.user_id = $1", [userId]);
  return Number(r.used);
}

export async function storageStats(user: User): Promise<StorageStats> {
  const d = await db();
  const used = await usedBytes(d, user.id);
  const [c] = await d.query<{ docs: number; trash: number; versions: number }>(
    "select count(*) filter (where deleted_at is null)::int as docs, count(*) filter (where deleted_at is not null)::int as trash, (select count(*)::int from versions v join documents x on x.id = v.document_id where x.user_id = $1) as versions from documents where user_id = $1",
    [user.id],
  );
  const largest = await d.query<DocRow>("select * from documents where user_id = $1 and deleted_at is null order by size desc, created_at desc limit 5", [user.id]);
  const recent = await d.query<DocRow>("select * from documents where user_id = $1 and deleted_at is null order by created_at desc limit 5", [user.id]);
  return {
    used,
    quota: cloud.quotaBytes,
    available: Math.max(0, cloud.quotaBytes - used),
    documents: c.docs,
    versions: c.versions,
    trash: c.trash,
    largest: largest.map((r) => ({ id: r.id, name: r.name, size: Number(r.size), format: r.format })),
    recent: recent.map((r) => ({ id: r.id, name: r.name, size: Number(r.size), format: r.format, createdAt: ms(r.created_at)! })),
  };
}

// ------------------------------------------------------------------ adding documents and versions

interface Checked {
  format: FormatId;
  size: number;
  pages: number | null;
}

/** Validates a file by its content (not its name), scans it and checks size limits. */
async function check(file: string, name: string): Promise<Checked> {
  const stat = await fsp.stat(file);
  if (stat.size === 0) throw new UserError(`“${safeFilename(name)}” is empty.`, "empty_file");
  if (stat.size > cloud.maxDocumentBytes) throw new UserError(`“${safeFilename(name)}” is larger than ${Math.round(cloud.maxDocumentBytes / 1024 / 1024)} MB, the most a saved document can be.`, "too_large", 413);
  const format = await detectFormat(file, name);
  await scanFile(file);
  let pages: number | null = null;
  if (format === "pdf") pages = inspect(new Uint8Array(await fsp.readFile(file))).pages ?? null;
  return { format, size: stat.size, pages };
}

async function ensureRoom(q: Queryable, userId: string, size: number) {
  const used = await usedBytes(q, userId);
  if (used + size > cloud.quotaBytes) {
    const free = Math.max(0, cloud.quotaBytes - used);
    throw new UserError(`Not enough storage: this needs ${(size / 1048576).toFixed(1)} MB and you have ${(free / 1048576).toFixed(1)} MB left. Delete documents or empty the trash to make room.`, "quota", 413);
  }
}

function cleanName(name: unknown, format: FormatId, fallback = "Document"): string {
  const ext = FORMATS[format].ext;
  let n = safeFilename(typeof name === "string" ? name : "", fallback);
  if (!n.toLowerCase().endsWith(`.${ext}`) && !(FORMATS[format].aliases ?? []).some((a) => n.toLowerCase().endsWith(`.${a}`))) n = `${n}.${ext}`;
  return n;
}

/** Stores a new document from a file on disk (an upload, or a file from the current session). */
export async function addDocument(user: User, file: string, name: string, folderId?: unknown): Promise<CloudDoc> {
  const c = await check(file, name);
  const d = await db();
  const folder = await ownFolder(d, user, folderId);
  const key = newBlobKey();
  // reserve the space first, so two uploads at once can't both squeeze past the quota
  await ensureRoom(d, user.id, c.size);
  await blobs().put(key, file, FORMATS[c.format].mime);
  try {
    return await d.tx(async (q) => {
      await ensureRoom(q, user.id, c.size);
      const id = newId();
      const [row] = await q.query<DocRow>(
        "insert into documents (id, user_id, folder_id, name, format, mime, size, pages, blob_key) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *",
        [id, user.id, folder, cleanName(name, c.format), c.format, FORMATS[c.format].mime, c.size, c.pages, key],
      );
      await q.query("insert into versions (id, document_id, version, size, pages, blob_key, note) values ($1, $2, 1, $3, $4, $5, $6)", [newId(), id, c.size, c.pages, key, "Uploaded"]);
      await event(q, user.id, id, "uploaded", { name: row.name, size: c.size });
      return toDoc(row);
    });
  } catch (e) {
    await blobs().remove(key).catch(() => undefined);
    throw e;
  }
}

export async function addFromSession(user: User, sid: string, fileId: unknown, o: { folderId?: unknown; name?: unknown } = {}): Promise<CloudDoc> {
  if (!isId(fileId)) throw new UserError("That file is no longer available.", "not_found", 404);
  const f = getFile(sid, fileId);
  return addDocument(user, f.path, typeof o.name === "string" && o.name.trim() ? o.name : f.meta.name, o.folderId);
}

/** Saves a session file as the next version of a document (e.g. after editing it). */
export async function addVersion(user: User, docId: unknown, sid: string, fileId: unknown, note = "Edited"): Promise<CloudDoc> {
  if (!isId(fileId)) throw new UserError("That file is no longer available.", "not_found", 404);
  const f = getFile(sid, fileId);
  const d = await db();
  const doc = await ownDoc(d, user, docId);
  const c = await check(f.path, doc.name);
  if (c.format !== doc.format) throw new UserError(`A new version must be the same kind of file (${FORMATS[doc.format].label}).`, "format_mismatch");
  await ensureRoom(d, user.id, c.size);
  const key = newBlobKey();
  await blobs().put(key, f.path, doc.mime);
  try {
    const out = await d.tx(async (q) => {
      await ensureRoom(q, user.id, c.size);
      const v = doc.version + 1;
      await q.query("insert into versions (id, document_id, version, size, pages, blob_key, note) values ($1, $2, $3, $4, $5, $6, $7)", [newId(), doc.id, v, c.size, c.pages, key, note.slice(0, 120)]);
      const [row] = await q.query<DocRow>("update documents set blob_key = $2, size = $3, pages = $4, version = $5, updated_at = now() where id = $1 returning *", [doc.id, key, c.size, c.pages, v]);
      await event(q, user.id, doc.id, "version", { version: v, note });
      await pruneVersions(q, doc.id);
      return toDoc(row);
    });
    return out;
  } catch (e) {
    await blobs().remove(key).catch(() => undefined);
    throw e;
  }
}

/** Keeps the newest VERSIONS_KEPT versions; older files are released. */
async function pruneVersions(q: Queryable, docId: string) {
  const old = await q.query<{ id: string; blob_key: string }>("select id, blob_key from versions where document_id = $1 order by version desc offset $2", [docId, cloud.versionsKept]);
  for (const v of old) {
    await q.query("delete from versions where id = $1", [v.id]);
    await releaseBlob(q, v.blob_key);
  }
}

/** Queues a stored file for deletion; the sweeper removes it once nothing refers to it. */
async function releaseBlob(q: Queryable, key: string) {
  await q.query("insert into blob_trash (key) values ($1) on conflict do nothing", [key]);
}

export async function restoreVersion(user: User, docId: unknown, version: unknown): Promise<CloudDoc> {
  const d = await db();
  return d.tx(async (q) => {
    const doc = await ownDoc(q, user, docId);
    const [v] = await q.query<{ version: number; size: number; pages: number | null; blob_key: string }>("select * from versions where document_id = $1 and version = $2", [doc.id, Number(version)]);
    if (!v) throw new UserError("That version doesn't exist any more.", "not_found", 404);
    const next = doc.version + 1;
    // a restore is a new version pointing at the old file: nothing is lost
    await q.query("insert into versions (id, document_id, version, size, pages, blob_key, note) values ($1, $2, $3, $4, $5, $6, $7)", [newId(), doc.id, next, v.size, v.pages, v.blob_key, `Restored version ${v.version}`]);
    const [row] = await q.query<DocRow>("update documents set blob_key = $2, size = $3, pages = $4, version = $5, updated_at = now() where id = $1 returning *", [doc.id, v.blob_key, v.size, v.pages, next]);
    await event(q, user.id, doc.id, "restored", { version: v.version });
    await pruneVersions(q, doc.id);
    return toDoc(row);
  });
}

// ------------------------------------------------------------------ listing and details

export type View = "all" | "recent" | "favorites" | "shared" | "trash";
export type Sort = "updated" | "name" | "size" | "created";

export async function listDocuments(user: User, o: { view?: unknown; folderId?: unknown; q?: unknown; sort?: unknown; dir?: unknown }) {
  const d = await db();
  const view: View = (["all", "recent", "favorites", "shared", "trash"] as const).includes(o.view as View) ? (o.view as View) : "all";
  const sort: Sort = (["updated", "name", "size", "created"] as const).includes(o.sort as Sort) ? (o.sort as Sort) : "updated";
  const asc = o.dir === "asc";
  const q = typeof o.q === "string" ? o.q.trim().slice(0, 100) : "";
  const where: string[] = ["d.user_id = $1"];
  const params: unknown[] = [user.id];
  where.push(view === "trash" ? "d.deleted_at is not null" : "d.deleted_at is null");
  const folder = view === "all" && !q ? await ownFolder(d, user, o.folderId) : null;
  if (view === "all" && !q) where.push(folder ? `d.folder_id = $${params.push(folder)}` : "d.folder_id is null");
  if (view === "favorites") where.push("d.favorite");
  if (view === "recent") where.push("coalesce(d.opened_at, d.updated_at) > now() - interval '30 days'");
  if (view === "shared") where.push("exists (select 1 from shares s where s.document_id = d.id and s.revoked_at is null and (s.expires_at is null or s.expires_at > now()))");
  if (q) where.push(`d.name ilike $${params.push(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)}`);
  const col = { updated: "d.updated_at", name: "lower(d.name)", size: "d.size", created: "d.created_at" }[sort];
  const order = view === "recent" ? "coalesce(d.opened_at, d.updated_at) desc" : `${col} ${asc ? "asc" : "desc"}, d.id`;
  const rows = await d.query<DocRow>(
    `select d.*, exists (select 1 from shares s where s.document_id = d.id and s.revoked_at is null and (s.expires_at is null or s.expires_at > now())) as shared
     from documents d where ${where.join(" and ")} order by ${order} limit 500`,
    params,
  );
  const folders = await d.query<{ id: string; name: string; parent_id: string | null; created_at: Date }>("select * from folders where user_id = $1 order by lower(name)", [user.id]);
  return {
    documents: rows.map(toDoc),
    folders: folders.map((f) => ({ id: f.id, name: f.name, parentId: f.parent_id, createdAt: ms(f.created_at)! })),
    folderId: folder,
    rev: await revision(user),
  };
}

/** Changes whenever anything in the library changes: other devices poll it to stay in sync. */
export async function revision(user: User): Promise<string> {
  const [r] = await (await db()).query<{ a: Date | null; n: number; f: number; e: Date | null }>(
    "select (select max(updated_at) from documents where user_id = $1) as a, (select count(*)::int from documents where user_id = $1) as n, (select count(*)::int from folders where user_id = $1) as f, (select max(at) from events where user_id = $1) as e",
    [user.id],
  );
  return crypto.createHash("sha1").update(JSON.stringify([ms(r.a), r.n, r.f, ms(r.e)])).digest("hex").slice(0, 16);
}

export async function documentDetail(user: User, id: unknown) {
  const d = await db();
  const [row] = isId(id) ? await d.query<DocRow>("select * from documents where id = $1 and user_id = $2", [id, user.id]) : [];
  if (!row) throw NOT_FOUND();
  const versions = await d.query<{ version: number; size: number; pages: number | null; note: string; created_at: Date }>("select version, size, pages, note, created_at from versions where document_id = $1 order by version desc", [row.id]);
  const events = await d.query<{ kind: string; detail: Record<string, unknown>; at: Date }>("select kind, detail, at from events where document_id = $1 order by at desc limit 50", [row.id]);
  const shares = await listShares(user, row.id);
  return {
    document: toDoc(row),
    versions: versions.map((v) => ({ version: v.version, size: Number(v.size), pages: v.pages, note: v.note, createdAt: ms(v.created_at)! })),
    events: events.map((e) => ({ kind: e.kind, detail: e.detail, at: ms(e.at)! })),
    shares,
  };
}

// ------------------------------------------------------------------ changes

export async function updateDocument(user: User, id: unknown, patch: { name?: unknown; folderId?: unknown; favorite?: unknown }): Promise<CloudDoc> {
  const d = await db();
  return d.tx(async (q) => {
    const doc = await ownDoc(q, user, id);
    if (patch.name !== undefined) {
      const name = cleanName(patch.name, doc.format, doc.name);
      if (name !== doc.name) {
        await q.query("update documents set name = $2, updated_at = now() where id = $1", [doc.id, name]);
        await event(q, user.id, doc.id, "renamed", { from: doc.name, to: name });
      }
    }
    if (patch.folderId !== undefined) {
      const folder = await ownFolder(q, user, patch.folderId);
      if (folder !== doc.folder_id) {
        await q.query("update documents set folder_id = $2, updated_at = now() where id = $1", [doc.id, folder]);
        await event(q, user.id, doc.id, "moved", { folderId: folder });
      }
    }
    if (typeof patch.favorite === "boolean") await q.query("update documents set favorite = $2, updated_at = now() where id = $1", [doc.id, patch.favorite]);
    const [row] = await q.query<DocRow>("select * from documents where id = $1", [doc.id]);
    return toDoc(row);
  });
}

/** Moves to the trash (kept TRASH_DAYS days). Share links stop working at once. */
export async function trashDocument(user: User, id: unknown) {
  const d = await db();
  await d.tx(async (q) => {
    const doc = await ownDoc(q, user, id);
    await q.query("update documents set deleted_at = now(), favorite = false, updated_at = now() where id = $1", [doc.id]);
    await q.query("update shares set revoked_at = now() where document_id = $1 and revoked_at is null", [doc.id]);
    await event(q, user.id, doc.id, "trashed");
  });
}

export async function restoreDocument(user: User, id: unknown) {
  const d = await db();
  await d.tx(async (q) => {
    const doc = await ownDoc(q, user, id, { trashed: true });
    await q.query("update documents set deleted_at = null, updated_at = now() where id = $1", [doc.id]);
    await event(q, user.id, doc.id, "untrashed");
  });
}

/** Deletes for good: the document, all its versions and their files. */
export async function purgeDocument(user: User, id: unknown) {
  const d = await db();
  const keys = await d.tx(async (q) => {
    const doc = await ownDoc(q, user, id, { trashed: true });
    const vs = await q.query<{ blob_key: string }>("select blob_key from versions where document_id = $1", [doc.id]);
    await q.query("delete from documents where id = $1", [doc.id]);
    for (const k of new Set([doc.blob_key, ...vs.map((v) => v.blob_key)])) await releaseBlob(q, k);
    return vs.length;
  });
  await sweepBlobs();
  return keys;
}

export async function emptyTrash(user: User) {
  const d = await db();
  const ids = await d.query<{ id: string }>("select id from documents where user_id = $1 and deleted_at is not null", [user.id]);
  for (const r of ids) await purgeDocument(user, r.id);
  return ids.length;
}

// ------------------------------------------------------------------ opening and downloading

/** Copies a document into the current browser session so any tool or the editor can work on it. */
export async function openInSession(user: User, sid: string, id: unknown, version?: unknown): Promise<StoredFile> {
  const d = await db();
  const doc = await ownDoc(d, user, id);
  let key = doc.blob_key;
  if (version !== undefined && Number(version) !== doc.version) {
    const [v] = await d.query<{ blob_key: string }>("select blob_key from versions where document_id = $1 and version = $2", [doc.id, Number(version)]);
    if (!v) throw new UserError("That version doesn't exist any more.", "not_found", 404);
    key = v.blob_key;
  }
  const bytes = await blobs().read(key);
  const tmp = path.join(env.dataDir, "incoming", `${newId()}.part`);
  await fsp.mkdir(path.dirname(tmp), { recursive: true });
  await fsp.writeFile(tmp, bytes);
  const file = await registerUpload(sid, tmp, doc.name);
  await d.query("update documents set opened_at = now() where id = $1", [doc.id]);
  return file;
}

export async function downloadUrl(user: User, id: unknown, o: { inline?: boolean; version?: unknown } = {}): Promise<string> {
  const d = await db();
  const doc = await ownDoc(d, user, id);
  let key = doc.blob_key;
  let name = doc.name;
  if (o.version !== undefined && Number(o.version) !== doc.version) {
    const [v] = await d.query<{ blob_key: string; version: number }>("select blob_key, version from versions where document_id = $1 and version = $2", [doc.id, Number(o.version)]);
    if (!v) throw new UserError("That version doesn't exist any more.", "not_found", 404);
    key = v.blob_key;
    name = name.replace(/(\.[^.]+)$/, ` (version ${v.version})$1`);
  }
  if (o.inline) await d.query("update documents set opened_at = now() where id = $1", [doc.id]);
  else await event(d, user.id, doc.id, "downloaded", o.version !== undefined ? { version: Number(o.version) } : {});
  return blobs().signedUrl(key, { filename: name, mime: doc.mime, inline: o.inline });
}

// ------------------------------------------------------------------ folders

export async function createFolder(user: User, name: unknown, parentId?: unknown): Promise<Folder> {
  const d = await db();
  const parent = await ownFolder(d, user, parentId);
  const n = safeFilename(typeof name === "string" ? name : "", "").slice(0, 80);
  if (!n) throw new UserError("Give the folder a name.");
  const [{ count }] = await d.query<{ count: number }>("select count(*)::int as count from folders where user_id = $1", [user.id]);
  if (count >= 500) throw new UserError("You can have up to 500 folders.");
  const [r] = await d.query<{ id: string; name: string; parent_id: string | null; created_at: Date }>("insert into folders (id, user_id, parent_id, name) values ($1, $2, $3, $4) returning *", [newId(), user.id, parent, n]);
  return { id: r.id, name: r.name, parentId: r.parent_id, createdAt: ms(r.created_at)! };
}

export async function updateFolder(user: User, id: unknown, patch: { name?: unknown; parentId?: unknown }) {
  const d = await db();
  await d.tx(async (q) => {
    const fid = await ownFolder(q, user, id);
    if (!fid) throw new UserError("That folder doesn't exist.", "not_found", 404);
    if (patch.name !== undefined) {
      const n = safeFilename(typeof patch.name === "string" ? patch.name : "", "").slice(0, 80);
      if (!n) throw new UserError("Give the folder a name.");
      await q.query("update folders set name = $2 where id = $1", [fid, n]);
    }
    if (patch.parentId !== undefined) {
      const parent = await ownFolder(q, user, patch.parentId);
      // a folder can't go inside itself or one of its own subfolders
      for (let p = parent; p; ) {
        if (p === fid) throw new UserError("A folder can't be moved into itself.");
        const [up] = await q.query<{ parent_id: string | null }>("select parent_id from folders where id = $1", [p]);
        p = up?.parent_id ?? null;
      }
      await q.query("update folders set parent_id = $2 where id = $1", [fid, parent]);
    }
    await event(q, user.id, null, "folder", { id: fid });
  });
}

/** Deletes a folder; what was inside moves up one level (nothing is deleted with it). */
export async function deleteFolder(user: User, id: unknown) {
  const d = await db();
  await d.tx(async (q) => {
    const fid = await ownFolder(q, user, id);
    if (!fid) throw new UserError("That folder doesn't exist.", "not_found", 404);
    const [f] = await q.query<{ parent_id: string | null }>("select parent_id from folders where id = $1", [fid]);
    await q.query("update documents set folder_id = $2, updated_at = now() where folder_id = $1", [fid, f.parent_id]);
    await q.query("update folders set parent_id = $2 where parent_id = $1", [fid, f.parent_id]);
    await q.query("delete from folders where id = $1", [fid]);
    await event(q, user.id, null, "folder_deleted", { id: fid });
  });
}

// ------------------------------------------------------------------ sharing

export interface Share {
  id: string;
  access: "link" | "private";
  emails: string[];
  hasPassword: boolean;
  allowDownload: boolean;
  expiresAt: number | null;
  revokedAt: number | null;
  views: number;
  lastViewedAt: number | null;
  createdAt: number;
  active: boolean;
}

interface ShareRow {
  id: string;
  document_id: string;
  user_id: string;
  access: "link" | "private";
  emails: string[];
  password_hash: string | null;
  allow_download: boolean;
  expires_at: Date | null;
  revoked_at: Date | null;
  views: number;
  last_viewed_at: Date | null;
  created_at: Date;
}

const toShare = (r: ShareRow): Share => ({
  id: r.id,
  access: r.access,
  emails: r.emails ?? [],
  hasPassword: !!r.password_hash,
  allowDownload: r.allow_download,
  expiresAt: ms(r.expires_at),
  revokedAt: ms(r.revoked_at),
  views: r.views,
  lastViewedAt: ms(r.last_viewed_at),
  createdAt: ms(r.created_at)!,
  active: !r.revoked_at && (!r.expires_at || new Date(r.expires_at).getTime() > Date.now()),
});

export async function listShares(user: User, docId: string): Promise<Share[]> {
  return (await (await db()).query<ShareRow>("select * from shares where document_id = $1 and user_id = $2 order by created_at desc", [docId, user.id])).map(toShare);
}

interface ShareInput {
  access?: unknown;
  emails?: unknown;
  password?: unknown;
  allowDownload?: unknown;
  expiresAt?: unknown;
}

function parseShare(input: ShareInput) {
  const access = input.access === "private" ? "private" : "link";
  const emails = access === "private" ? [...new Set((Array.isArray(input.emails) ? input.emails : []).map(validateEmail))].slice(0, 50) : [];
  if (access === "private" && !emails.length) throw new UserError("Add the email address of at least one person who may open it.");
  let expires: Date | null = null;
  if (input.expiresAt !== null && input.expiresAt !== undefined && input.expiresAt !== "") {
    expires = new Date(typeof input.expiresAt === "number" ? input.expiresAt : String(input.expiresAt));
    if (Number.isNaN(expires.getTime())) throw new UserError("That expiry date isn't valid.");
    if (expires.getTime() <= Date.now()) throw new UserError("Choose an expiry date in the future.");
    if (expires.getTime() > Date.now() + 366 * 86400_000) throw new UserError("Links can last up to a year.");
  }
  const password = typeof input.password === "string" && input.password ? input.password : null;
  if (password && (password.length < 6 || password.length > 200)) throw new UserError("Use a link password of 6 to 200 characters.");
  return { access, emails, expires, password, allowDownload: input.allowDownload !== false };
}

export async function createShare(user: User, docId: unknown, input: ShareInput): Promise<Share> {
  const d = await db();
  const doc = await ownDoc(d, user, docId);
  const p = parseShare(input);
  const [{ n }] = await d.query<{ n: number }>("select count(*)::int as n from shares where user_id = $1 and revoked_at is null", [user.id]);
  if (n >= 200) throw new UserError("You have 200 active links. Revoke some first.");
  // 128 random bits: links can't be guessed
  const id = newId();
  const [row] = await d.query<ShareRow>(
    "insert into shares (id, document_id, user_id, access, emails, password_hash, allow_download, expires_at) values ($1, $2, $3, $4, $5, $6, $7, $8) returning *",
    [id, doc.id, user.id, p.access, p.emails, p.password ? await hashPassword(p.password) : null, p.allowDownload, p.expires],
  );
  await event(d, user.id, doc.id, "shared", { access: p.access, expires: p.expires ? p.expires.getTime() : null, password: !!p.password, download: p.allowDownload });
  return toShare(row);
}

export async function updateShare(user: User, shareId: unknown, input: ShareInput & { revoke?: unknown }): Promise<Share> {
  const d = await db();
  if (!isId(shareId)) throw NOT_FOUND();
  const [s] = await d.query<ShareRow>("select * from shares where id = $1 and user_id = $2", [shareId, user.id]);
  if (!s) throw NOT_FOUND();
  if (input.revoke === true) {
    const [row] = await d.query<ShareRow>("update shares set revoked_at = coalesce(revoked_at, now()) where id = $1 returning *", [s.id]);
    await event(d, user.id, s.document_id, "share_revoked", {});
    return toShare(row);
  }
  if (s.revoked_at) throw new UserError("This link was revoked. Create a new one instead.");
  const set: string[] = [];
  const params: unknown[] = [s.id];
  if (typeof input.allowDownload === "boolean") set.push(`allow_download = $${params.push(input.allowDownload)}`);
  if (input.expiresAt !== undefined) set.push(`expires_at = $${params.push(parseShare({ ...input, access: "link" }).expires)}`);
  if (input.password !== undefined) set.push(`password_hash = $${params.push(typeof input.password === "string" && input.password ? await hashPassword(parseShare({ password: input.password }).password!) : null)}`);
  if (!set.length) return toShare(s);
  const [row] = await d.query<ShareRow>(`update shares set ${set.join(", ")} where id = $1 returning *`, params);
  return toShare(row);
}

// --- the other side: someone opening a link

const PROOF_HOURS = 12;
/** Cookie value proving the visitor typed the link's password; changes if the password changes. */
export function shareProof(s: { id: string; password_hash: string | null }) {
  return crypto.createHmac("sha256", authSecret()).update(`share:${s.id}:${s.password_hash}`).digest("base64url");
}
export const proofCookie = (id: string) => `pf_share_${id}`;
export const proofMaxAge = PROOF_HOURS * 3600;

export type ShareGate = "ok" | "password" | "signin" | "forbidden";

export interface ShareView {
  gate: ShareGate;
  share: { id: string; allowDownload: boolean; expiresAt: number | null; access: "link" | "private" };
  document?: { name: string; format: FormatId; size: number; pages: number | null; mime: string; owner: string };
}

const SHARE_GONE = () => new UserError("This link doesn't work any more. It may have expired or been turned off by its owner.", "share_gone", 404);

async function liveShare(id: unknown): Promise<ShareRow & { doc: DocRow; owner_name: string; owner_email: string }> {
  if (!isId(id)) throw SHARE_GONE();
  const d = await db();
  const [s] = await d.query<ShareRow>("select * from shares where id = $1 and revoked_at is null and (expires_at is null or expires_at > now())", [id]);
  if (!s) throw SHARE_GONE();
  const [doc] = await d.query<DocRow>("select * from documents where id = $1 and deleted_at is null", [s.document_id]);
  if (!doc) throw SHARE_GONE();
  const [owner] = await d.query<{ name: string; email: string }>("select name, email from users where id = $1", [s.user_id]);
  return { ...s, doc, owner_name: owner.name, owner_email: owner.email };
}

/** Decides what a visitor to a share link may do. Only "ok" reveals anything about the document. */
export async function openShare(id: unknown, viewer: User | null, proof: string | undefined, o: { count?: boolean } = {}): Promise<ShareView & { blobKey?: string }> {
  const s = await liveShare(id);
  const base = { share: { id: s.id, allowDownload: s.allow_download, expiresAt: ms(s.expires_at), access: s.access } };
  const isOwner = viewer?.id === s.user_id;
  if (s.access === "private" && !isOwner) {
    if (!viewer || !viewer.verified) return { gate: "signin", ...base };
    if (!s.emails.includes(viewer.email)) return { gate: "forbidden", ...base };
  }
  if (s.password_hash && !isOwner) {
    const want = Buffer.from(shareProof(s));
    const got = Buffer.from(proof ?? "");
    if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return { gate: "password", ...base };
  }
  if (o.count && !isOwner) await (await db()).query("update shares set views = views + 1, last_viewed_at = now() where id = $1", [s.id]);
  return {
    gate: "ok",
    ...base,
    document: { name: s.doc.name, format: s.doc.format, size: Number(s.doc.size), pages: s.doc.pages, mime: s.doc.mime, owner: s.owner_name || s.owner_email.replace(/@.*/, "") },
    blobKey: s.doc.blob_key,
  };
}

export async function unlockShare(id: unknown, password: unknown): Promise<string> {
  const s = await liveShare(id);
  if (!s.password_hash) return shareProof(s);
  if (!(await checkPassword(typeof password === "string" ? password : "", s.password_hash))) throw new UserError("That password isn't right.", "bad_password", 401);
  return shareProof(s);
}

export async function shareFileUrl(id: unknown, viewer: User | null, proof: string | undefined, download: boolean): Promise<string> {
  const v = await openShare(id, viewer, proof);
  if (v.gate !== "ok") throw new UserError("You don't have access to this document.", "forbidden", 403);
  if (download && !v.share.allowDownload) throw new UserError("The owner turned off downloading for this link.", "no_download", 403);
  return blobs().signedUrl(v.blobKey!, { filename: v.document!.name, mime: v.document!.mime, inline: !download, seconds: download ? cloud.signedUrlSeconds : 120 });
}

// ------------------------------------------------------------------ account deletion and cleanup

/** Deletes the account and everything in it: documents, versions, files, folders, links, sessions. */
export async function deleteAccount(user: User) {
  const d = await db();
  await d.tx(async (q) => {
    const keys = await q.query<{ blob_key: string }>("select v.blob_key from versions v join documents x on x.id = v.document_id where x.user_id = $1 union select blob_key from documents where user_id = $1", [user.id]);
    await q.query("delete from users where id = $1", [user.id]);
    for (const k of keys) await releaseBlob(q, k.blob_key);
  });
  await sweepBlobs();
}

/** Removes queued files that no document or version refers to any more. */
export async function sweepBlobs() {
  const d = await db();
  const queued = await d.query<{ key: string }>(
    "select t.key from blob_trash t where not exists (select 1 from versions v where v.blob_key = t.key) and not exists (select 1 from documents x where x.blob_key = t.key) limit 500",
  );
  for (const { key } of queued) {
    try {
      await blobs().remove(key);
      await d.query("delete from blob_trash where key = $1", [key]);
    } catch {
      // stays queued and is retried next time
    }
  }
  // queued keys that are in use again (a restored version) are simply dropped from the queue
  await d.query("delete from blob_trash t where exists (select 1 from versions v where v.blob_key = t.key)");
}

/** Housekeeping, run periodically: expired sessions and tokens, old trash, stale accounts, dead links. */
export async function cleanup() {
  const d = await db();
  await d.query("delete from sessions where expires_at < now()");
  await d.query("delete from tokens where expires_at < now()");
  await d.query("delete from users where email_verified_at is null and created_at < now() - make_interval(days => $1)", [cloud.unverifiedDays]);
  await d.query("delete from shares where (revoked_at is not null and revoked_at < now() - interval '30 days') or (expires_at is not null and expires_at < now() - interval '30 days')");
  await d.query("delete from events where at < now() - interval '365 days'");
  await d.query("delete from dev_mail where created_at < now() - interval '7 days'");
  const old = await d.query<{ id: string; user_id: string }>("select id, user_id from documents where deleted_at < now() - make_interval(days => $1)", [cloud.trashDays]);
  for (const r of old) {
    await d.tx(async (q) => {
      const vs = await q.query<{ blob_key: string }>("select blob_key from versions where document_id = $1", [r.id]);
      await q.query("delete from documents where id = $1", [r.id]);
      for (const v of vs) await releaseBlob(q, v.blob_key);
    });
  }
  await sweepBlobs();
}

const g = globalThis as unknown as { __pfCloudSweep?: NodeJS.Timeout };
/** Starts the hourly cleanup once per process. */
export function startCleanup() {
  if (g.__pfCloudSweep) return;
  g.__pfCloudSweep = setInterval(() => cleanup().catch((e) => console.error(`[cleanup] ${(e as Error).message}`)), 3600_000);
  g.__pfCloudSweep.unref?.();
}
