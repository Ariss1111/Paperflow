import type { FormatId } from "@/lib/formats";

export type JobStatus = "queued" | "processing" | "completed" | "failed" | "cancelled";

/** A file uploaded into the current browser session (server-side copy). */
export interface StoredFile {
  id: string;
  name: string;
  size: number;
  format: FormatId;
  mime: string;
  pages?: number;
  encrypted?: boolean;
  /** PDF without a text layer on its first pages: probably a scan, OCR recommended. */
  scanned?: boolean;
  /** Set when the file is the output of a job ("Continue with result"). */
  sourceJobId?: string;
  createdAt: number;
  expiresAt: number;
}

export interface JobOutput {
  index: number;
  name: string;
  mime: string;
  size: number;
}

export interface Job {
  id: string;
  tool: string;
  toolName: string;
  status: JobStatus;
  /** 0..1 when measurable, null when the step cannot report real progress. */
  progress: number | null;
  message?: string;
  error?: string;
  inputs: { id: string; name: string; size: number }[];
  outputs: JobOutput[];
  /** Tool-specific facts about the result, e.g. original/compressed size. */
  summary?: Record<string, string | number | boolean>;
  notes?: string[];
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  expiresAt: number;
}

export interface ApiError {
  error: string;
  code?: string;
}
