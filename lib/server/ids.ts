import crypto from "node:crypto";

const ID_RE = /^[A-Za-z0-9_-]{22}$/;

export function newId(): string {
  return crypto.randomBytes(16).toString("base64url");
}

export function isId(v: unknown): v is string {
  return typeof v === "string" && ID_RE.test(v);
}

/** Session ids never touch the filesystem directly; directories use a hash. */
export function ownerKey(sessionId: string): string {
  return crypto.createHash("sha256").update(sessionId).digest("hex").slice(0, 32);
}

/** Makes a user-supplied filename safe for Content-Disposition and ZIP entries. */
export function safeFilename(name: string, fallback = "document"): string {
  const cleaned = name
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\.{2,}/g, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/^\.+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return cleaned || fallback;
}
