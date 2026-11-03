import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { authSecret, cloud, useS3 } from "./config";
import { contentDisposition } from "../http";

// Where document bytes live: a private S3-compatible bucket in production (e.g. Cloudflare R2),
// or a private folder in DATA_DIR. Keys are random and never come from user input. Downloads go
// through short-lived signed URLs, issued only after the access check.

export interface SignedOpts {
  filename: string;
  mime: string;
  inline?: boolean;
  seconds?: number;
}

export interface BlobStore {
  kind: "s3" | "disk";
  put(key: string, file: string, mime: string): Promise<void>;
  read(key: string): Promise<Uint8Array>;
  remove(key: string): Promise<void>;
  signedUrl(key: string, o: SignedOpts): Promise<string>;
}

export const newBlobKey = () => `d/${crypto.randomBytes(24).toString("base64url")}`;
const validKey = (key: string) => /^d\/[A-Za-z0-9_-]{32}$/.test(key);

// ------------------------------------------------------------------ S3 / R2

let s3Client: { id: string; client: import("@aws-sdk/client-s3").S3Client } | null = null;
async function s3() {
  const { S3Client } = await import("@aws-sdk/client-s3");
  const id = JSON.stringify(cloud.s3);
  if (s3Client?.id === id) return s3Client.client;
  const client = new S3Client({
    region: cloud.s3.region,
    endpoint: cloud.s3.endpoint || undefined,
    forcePathStyle: cloud.s3.forcePathStyle,
    credentials: { accessKeyId: cloud.s3.accessKeyId, secretAccessKey: cloud.s3.secretAccessKey },
    // newer SDKs add checksums by default that Cloudflare R2 and other S3-compatible stores reject
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  s3Client = { id, client };
  return client;
}

const s3Store: BlobStore = {
  kind: "s3",
  async put(key, file, mime) {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const body = await fsp.readFile(file);
    await (await s3()).send(new PutObjectCommand({ Bucket: cloud.s3.bucket, Key: key, Body: body, ContentType: mime, ContentLength: body.length }));
  },
  async read(key) {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const r = await (await s3()).send(new GetObjectCommand({ Bucket: cloud.s3.bucket, Key: key }));
    return new Uint8Array(await r.Body!.transformToByteArray());
  },
  async remove(key) {
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    await (await s3()).send(new DeleteObjectCommand({ Bucket: cloud.s3.bucket, Key: key }));
  },
  async signedUrl(key, o) {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    return getSignedUrl(
      await s3(),
      new GetObjectCommand({ Bucket: cloud.s3.bucket, Key: key, ResponseContentType: o.mime, ResponseContentDisposition: contentDisposition(o.filename, o.inline), ResponseCacheControl: "private, no-store" }),
      { expiresIn: o.seconds ?? cloud.signedUrlSeconds },
    );
  },
};

// ------------------------------------------------------------------ local disk

const diskPath = (key: string) => {
  if (!validKey(key)) throw new Error("bad blob key");
  return path.join(cloud.localBlobDir, key.slice(2, 4), key.slice(2));
};

/** HMAC over everything the link grants, so none of it can be changed. */
export function signDisk(key: string, exp: number, filename: string, mime: string, inline: boolean): string {
  return crypto.createHmac("sha256", authSecret()).update(JSON.stringify([key, exp, filename, mime, inline])).digest("base64url");
}

export function verifyDisk(key: string, exp: number, filename: string, mime: string, inline: boolean, sig: string): boolean {
  if (!validKey(key) || !Number.isFinite(exp) || exp < Date.now() / 1000) return false;
  const want = Buffer.from(signDisk(key, exp, filename, mime, inline));
  const got = Buffer.from(sig);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

const diskStore: BlobStore = {
  kind: "disk",
  async put(key, file) {
    const dest = diskPath(key);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.copyFile(file, dest);
  },
  async read(key) {
    return new Uint8Array(await fsp.readFile(diskPath(key)));
  },
  async remove(key) {
    await fsp.rm(diskPath(key), { force: true });
  },
  async signedUrl(key, o) {
    const exp = Math.floor(Date.now() / 1000) + (o.seconds ?? cloud.signedUrlSeconds);
    const inline = !!o.inline;
    const q = new URLSearchParams({ k: key, e: String(exp), n: o.filename, m: o.mime, i: inline ? "1" : "0", s: signDisk(key, exp, o.filename, o.mime, inline) });
    return `/api/blob?${q}`;
  },
};

export const diskFile = (key: string) => {
  const p = diskPath(key);
  return fs.existsSync(p) ? p : null;
};

export function blobs(): BlobStore {
  return useS3() ? s3Store : diskStore;
}
