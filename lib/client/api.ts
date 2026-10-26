"use client";
import type { Job, StoredFile } from "@/types";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!res.ok) throw new ApiError(body.error || `Request failed (${res.status})`, res.status, body.code);
  return body;
}

export interface UploadResult {
  files: StoredFile[];
  errors: { name: string; error: string; code?: string }[];
}

/** Uploads with XMLHttpRequest so we can report real byte progress. */
export function uploadFiles(files: File[], onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    for (const f of files) fd.append("file", f, f.name);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/files");
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      const body = (xhr.response ?? {}) as UploadResult & { error?: string; code?: string };
      if (xhr.status >= 200 && xhr.status < 300) resolve({ files: body.files ?? [], errors: body.errors ?? [] });
      else if (body.errors) resolve({ files: body.files ?? [], errors: body.errors });
      else reject(new ApiError(body.error || `Upload failed (${xhr.status})`, xhr.status, body.code));
    };
    xhr.onerror = () => reject(new ApiError("The upload failed. Check your connection and try again.", 0, "network"));
    xhr.onabort = () => reject(new ApiError("Upload cancelled.", 0, "aborted"));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(fd);
  });
}

export const api = {
  listFiles: () => fetch("/api/files", { cache: "no-store" }).then((r) => json<{ files: StoredFile[] }>(r)),
  getFile: (id: string) => fetch(`/api/files/${id}`, { cache: "no-store" }).then((r) => json<{ file: StoredFile }>(r)),
  renameFile: (id: string, name: string) =>
    fetch(`/api/files/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) }).then((r) => json<{ file: StoredFile }>(r)),
  deleteFile: (id: string) => fetch(`/api/files/${id}`, { method: "DELETE" }).then((r) => json<{ ok: true }>(r)),
  fileUrl: (id: string) => `/api/files/${id}/content`,
  form: (id: string) => fetch(`/api/files/${id}/form`, { cache: "no-store" }).then((r) => json<{ fields: import("@/lib/pdf/ops").FormFieldInfo[]; xfa: boolean }>(r)),

  createJob: (tool: string, files: string[], options: Record<string, unknown>) =>
    fetch("/api/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tool, files, options }) }).then((r) => json<{ job: Job }>(r)),
  getJob: (id: string) => fetch(`/api/jobs/${id}`, { cache: "no-store" }).then((r) => json<{ job: Job }>(r)),
  listJobs: () => fetch("/api/jobs", { cache: "no-store" }).then((r) => json<{ jobs: Job[] }>(r)),
  cancelJob: (id: string) => fetch(`/api/jobs/${id}`, { method: "DELETE" }).then((r) => json<{ job: Job }>(r)),
  retryJob: (id: string, options?: Record<string, unknown>) =>
    fetch(`/api/jobs/${id}/retry`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ options }) }).then((r) => json<{ job: Job }>(r)),
  useOutput: (id: string, index: number) =>
    fetch(`/api/jobs/${id}/use`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ index }) }).then((r) => json<{ file: StoredFile }>(r)),
  downloadUrl: (id: string, index: number) => `/api/jobs/${id}/download?i=${index}`,
  downloadAllUrl: (id: string) => `/api/jobs/${id}/download?all=1`,
};

/** Polls a job until it leaves queued/processing. Interval backs off gently for long jobs. */
export async function watchJob(id: string, onUpdate: (j: Job) => void, signal?: AbortSignal): Promise<Job> {
  let delay = 300;
  for (;;) {
    if (signal?.aborted) throw new ApiError("Stopped watching.", 0, "aborted");
    const { job } = await api.getJob(id);
    onUpdate(job);
    if (job.status !== "queued" && job.status !== "processing") return job;
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(1200, delay * 1.25);
  }
}

/** Triggers a browser download without navigating away. */
export function download(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
