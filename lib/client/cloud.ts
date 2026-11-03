"use client";
import type { FormatId } from "@/lib/formats";
import type { StoredFile } from "@/types";
import { call } from "./account";

// The signed-in user's library, as the browser sees it.

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
export interface StorageStats {
  used: number;
  quota: number;
  available: number;
  documents: number;
  versions: number;
  trash: number;
  largest: Pick<CloudDoc, "id" | "name" | "size" | "format">[];
  recent: (Pick<CloudDoc, "id" | "name" | "size" | "format"> & { createdAt: number })[];
}
export interface Detail {
  document: CloudDoc;
  versions: { version: number; size: number; pages: number | null; note: string; createdAt: number }[];
  events: { kind: string; detail: Record<string, unknown>; at: number }[];
  shares: Share[];
}

export type View = "all" | "recent" | "favorites" | "shared" | "trash";
export type Sort = "updated" | "name" | "size" | "created";

const q = (o: Record<string, string | null | undefined>) =>
  new URLSearchParams(Object.entries(o).filter((e): e is [string, string] => !!e[1])).toString();

export const cloudApi = {
  list: (o: { view: View; folder?: string | null; q?: string; sort: Sort; dir: "asc" | "desc" }) =>
    call<{ documents: CloudDoc[]; folders: Folder[]; folderId: string | null; rev: string }>(`/api/docs?${q({ view: o.view, folder: o.folder, q: o.q, sort: o.sort, dir: o.dir })}`, "GET"),
  rev: () => call<{ rev: string }>("/api/docs?rev=1", "GET"),
  save: (fileId: string, folderId?: string | null) => call<{ document: CloudDoc }>("/api/docs", "POST", { fileId, folderId }),
  detail: (id: string) => call<Detail>(`/api/docs/${id}`, "GET"),
  update: (id: string, patch: { name?: string; folderId?: string | null; favorite?: boolean }) => call<{ document: CloudDoc }>(`/api/docs/${id}`, "PATCH", patch),
  trash: (id: string) => call(`/api/docs/${id}`, "DELETE"),
  restore: (id: string) => call(`/api/docs/${id}`, "PATCH", { restore: true }),
  purge: (id: string) => call(`/api/docs/${id}?forever=1`, "DELETE"),
  emptyTrash: () => call<{ deleted: number }>("/api/trash", "DELETE"),
  open: (id: string, version?: number) => call<{ file: StoredFile }>(`/api/docs/${id}/open`, "POST", { version }),
  /** a short-lived signed link, issued after the access check */
  link: (id: string, o: { inline?: boolean; version?: number } = {}) => call<{ url: string }>(`/api/docs/${id}/file?${q({ json: "1", inline: o.inline ? "1" : null, version: o.version ? String(o.version) : null })}`, "GET").then((r) => r.url),
  downloadHref: (id: string, version?: number) => `/api/docs/${id}/file${version ? `?version=${version}` : ""}`,
  restoreVersion: (id: string, version: number) => call<{ document: CloudDoc }>(`/api/docs/${id}/versions`, "POST", { restore: version }),
  shares: (id: string) => call<{ shares: Share[] }>(`/api/docs/${id}/shares`, "GET"),
  share: (id: string, body: { access: "link" | "private"; emails?: string[]; password?: string; allowDownload: boolean; expiresAt: number | null }) => call<{ share: Share }>(`/api/docs/${id}/shares`, "POST", body),
  revokeShare: (shareId: string) => call<{ share: Share }>(`/api/shares/${shareId}`, "PATCH", { revoke: true }),
  createFolder: (name: string, parentId: string | null) => call<{ folder: Folder }>("/api/folders", "POST", { name, parentId }),
  renameFolder: (id: string, name: string) => call(`/api/folders/${id}`, "PATCH", { name }),
  moveFolder: (id: string, parentId: string | null) => call(`/api/folders/${id}`, "PATCH", { parentId }),
  deleteFolder: (id: string) => call(`/api/folders/${id}`, "DELETE"),
  storage: () => call<StorageStats>("/api/storage", "GET"),
};

export const shareUrl = (id: string) => `${window.location.origin}/s/${id}`;
