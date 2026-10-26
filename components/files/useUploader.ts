"use client";
import * as React from "react";
import { uploadFiles, ApiError } from "@/lib/client/api";
import { loadCapabilities } from "@/lib/client/capabilities";
import { formatFromExtension, FORMATS, type FormatId } from "@/lib/formats";
import { formatBytes } from "@/lib/utils";
import type { StoredFile } from "@/types";

export interface UploadState {
  uploading: boolean;
  /** real byte progress 0..1, or null before the browser reports any */
  progress: number | null;
  errors: string[];
}

/** Uploads files with honest progress. Client checks are a courtesy; the server validates content. */
export function useUploader(accepts?: FormatId[]) {
  const [state, setState] = React.useState<UploadState>({ uploading: false, progress: null, errors: [] });
  const abort = React.useRef<AbortController | null>(null);

  const upload = React.useCallback(
    async (list: File[]): Promise<StoredFile[]> => {
      const errors: string[] = [];
      const caps = await loadCapabilities().catch(() => null);
      const max = caps?.limits.maxUploadBytes ?? Infinity;
      const ok = list.filter((f) => {
        if (f.size === 0) {
          errors.push(`“${f.name}” is empty.`);
          return false;
        }
        if (f.size > max) {
          errors.push(`“${f.name}” is ${formatBytes(f.size)}; the limit is ${formatBytes(max)}.`);
          return false;
        }
        const fmt = formatFromExtension(f.name);
        if (accepts && fmt && !accepts.includes(fmt)) {
          errors.push(`“${f.name}” is a ${FORMATS[fmt].label} file, which this tool doesn't accept.`);
          return false;
        }
        return true;
      });
      if (!ok.length) {
        setState({ uploading: false, progress: null, errors });
        return [];
      }
      abort.current = new AbortController();
      setState({ uploading: true, progress: null, errors });
      try {
        const res = await uploadFiles(ok, (p) => setState((s) => ({ ...s, progress: p })), abort.current.signal);
        const accepted = res.files.filter((f) => {
          if (accepts && !accepts.includes(f.format)) {
            errors.push(`“${f.name}” is actually a ${FORMATS[f.format].label} file, which this tool doesn't accept.`);
            return false;
          }
          return true;
        });
        errors.push(...res.errors.map((e) => e.error));
        setState({ uploading: false, progress: null, errors });
        return accepted;
      } catch (e) {
        if (!(e instanceof ApiError && e.code === "aborted")) errors.push((e as Error).message);
        setState({ uploading: false, progress: null, errors });
        return [];
      }
    },
    [accepts],
  );

  const cancel = React.useCallback(() => abort.current?.abort(), []);
  const clearErrors = React.useCallback(() => setState((s) => ({ ...s, errors: [] })), []);
  return { ...state, upload, cancel, clearErrors };
}
