import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { env } from "../env";

// Accounts and cloud storage settings. Production uses Postgres (DATABASE_URL) and S3-compatible
// storage (S3_BUCKET, e.g. Cloudflare R2); without them, everything runs locally inside DATA_DIR.

const num = (name: string, d: number) => {
  const raw = process.env[name]?.trim();
  if (!raw) return d;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : d;
};

const isProd = () => process.env.NODE_ENV === "production";

export const cloud = {
  get databaseUrl() {
    return process.env.DATABASE_URL || "";
  },
  /** where the built-in database lives when DATABASE_URL isn't set */
  get localDbDir() {
    return path.join(env.dataDir, "db");
  },
  get s3() {
    return {
      bucket: process.env.S3_BUCKET || "",
      region: process.env.S3_REGION || "auto",
      endpoint: process.env.S3_ENDPOINT || "",
      accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "1",
    };
  },
  get localBlobDir() {
    return path.join(env.dataDir, "blobs");
  },
  /** per account */
  get quotaBytes() {
    return num("STORAGE_QUOTA_MB", 1024) * 1024 * 1024;
  },
  get maxDocumentBytes() {
    return num("MAX_DOCUMENT_MB", 100) * 1024 * 1024;
  },
  get versionsKept() {
    return num("VERSIONS_KEPT", 10);
  },
  get sessionDays() {
    return num("SESSION_DAYS", 30);
  },
  /** unverified accounts are deleted after this many days */
  get unverifiedDays() {
    return num("UNVERIFIED_ACCOUNT_DAYS", 7);
  },
  /** deleted documents stay in the trash this long */
  get trashDays() {
    return num("TRASH_DAYS", 30);
  },
  /** signed download links work for this long */
  get signedUrlSeconds() {
    return num("SIGNED_URL_SECONDS", 300);
  },
  get smtp() {
    return {
      url: process.env.SMTP_URL || "",
      host: process.env.SMTP_HOST || "",
      port: num("SMTP_PORT", 587),
      user: process.env.SMTP_USER || "",
      pass: process.env.SMTP_PASSWORD || "",
      from: process.env.MAIL_FROM || "Pagelyt <no-reply@pagelyt.local>",
    };
  },
  get google() {
    return { clientId: process.env.GOOGLE_CLIENT_ID || "", clientSecret: process.env.GOOGLE_CLIENT_SECRET || "" };
  },
  /** public address, used in emails and for Google's redirect */
  get appUrl() {
    return (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/+$/, "");
  },
};

export const useS3 = () => !!(cloud.s3.bucket && cloud.s3.accessKeyId && cloud.s3.secretAccessKey);
export const smtpConfigured = () => !!(cloud.smtp.url || cloud.smtp.host);
/** Emails go to the built-in dev inbox when no SMTP server is set, but never in production unless asked for. */
export const devMailbox = () => !smtpConfigured() && (!isProd() || process.env.DEV_MAILBOX === "1");
export const googleConfigured = () => !!(cloud.google.clientId && cloud.google.clientSecret);

let secret: Buffer | null = null;
/**
 * Key for signing download links and other short-lived tokens. Set AUTH_SECRET in production;
 * locally one is generated once and kept in DATA_DIR.
 */
export function authSecret(): Buffer {
  if (secret) return secret;
  const fromEnv = process.env.AUTH_SECRET?.trim();
  if (fromEnv) return (secret = crypto.createHash("sha256").update(fromEnv).digest());
  if (isProd() && process.env.ALLOW_GENERATED_SECRET !== "1") {
    throw new Error("AUTH_SECRET must be set in production (at least 32 random characters).");
  }
  const file = path.join(env.dataDir, "auth-secret");
  try {
    secret = Buffer.from(fs.readFileSync(file, "utf8").trim(), "hex");
    if (secret.length === 32) return secret;
  } catch {
    // first run
  }
  secret = crypto.randomBytes(32);
  fs.mkdirSync(env.dataDir, { recursive: true });
  fs.writeFileSync(file, secret.toString("hex"), { mode: 0o600 });
  return secret;
}
