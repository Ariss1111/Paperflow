import "server-only";
import os from "node:os";
import path from "node:path";

function int(name: string, fallback: number, min = 1): number {
  const v = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(v) && v >= min ? v : fallback;
}

export const env = {
  dataDir: path.resolve(process.env.DATA_DIR || path.join(os.tmpdir(), "paperflow")),
  retentionMs: int("RETENTION_MINUTES", 60) * 60_000,
  maxUploadBytes: int("MAX_UPLOAD_MB", 200) * 1024 * 1024,
  maxFilesPerRequest: int("MAX_FILES_PER_REQUEST", 30),
  jobConcurrency: int("JOB_CONCURRENCY", 2),
  jobTimeoutMs: int("JOB_TIMEOUT_SECONDS", 300) * 1000,
  conversionTimeoutMs: int("CONVERSION_TIMEOUT_SECONDS", 180) * 1000,
  uploadsPerMin: int("RATE_LIMIT_UPLOADS_PER_MIN", 60),
  jobsPerMin: int("RATE_LIMIT_JOBS_PER_MIN", 40),
  sofficePath: process.env.SOFFICE_PATH || "",
  ocrLangPath: process.env.OCR_LANG_PATH || "",
  ocrLanguages: (process.env.OCR_LANGUAGES || "eng").split(",").map((s) => s.trim()).filter(Boolean),
  clamavAddress: process.env.CLAMAV_ADDRESS || "",
  projectRoot: process.cwd(),
};
