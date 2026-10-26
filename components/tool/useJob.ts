"use client";
import * as React from "react";
import { api, watchJob, ApiError } from "@/lib/client/api";
import type { Job } from "@/types";

export type RunState =
  | { phase: "idle" }
  | { phase: "starting" }
  | { phase: "running"; job: Job }
  | { phase: "done"; job: Job }
  | { phase: "failed"; job?: Job; error: string };

/** Starts a job, follows it to completion and exposes cancel / retry. */
export function useJob() {
  const [state, setState] = React.useState<RunState>({ phase: "idle" });
  const watching = React.useRef<AbortController | null>(null);

  const follow = React.useCallback(async (job: Job) => {
    watching.current?.abort();
    const ctl = new AbortController();
    watching.current = ctl;
    setState({ phase: "running", job });
    try {
      const final = await watchJob(job.id, (j) => !ctl.signal.aborted && setState({ phase: "running", job: j }), ctl.signal);
      if (ctl.signal.aborted) return;
      if (final.status === "completed") setState({ phase: "done", job: final });
      else if (final.status === "cancelled") setState({ phase: "idle" });
      else setState({ phase: "failed", job: final, error: final.error ?? "Processing failed." });
    } catch (e) {
      if (!(e instanceof ApiError && e.code === "aborted")) setState({ phase: "failed", error: (e as Error).message });
    }
  }, []);

  const start = React.useCallback(
    async (tool: string, files: string[], options: Record<string, unknown>) => {
      setState({ phase: "starting" });
      try {
        const { job } = await api.createJob(tool, files, options);
        await follow(job);
      } catch (e) {
        setState({ phase: "failed", error: (e as Error).message });
      }
    },
    [follow],
  );

  const cancel = React.useCallback(async () => {
    if (state.phase !== "running") return;
    try {
      await api.cancelJob(state.job.id);
    } catch {
      /* finished meanwhile */
    }
  }, [state]);

  const retry = React.useCallback(
    async (options?: Record<string, unknown>) => {
      if (state.phase !== "failed" || !state.job) return false;
      setState({ phase: "starting" });
      try {
        const { job } = await api.retryJob(state.job.id, options);
        await follow(job);
        return true;
      } catch (e) {
        setState({ phase: "failed", error: (e as Error).message });
        return true;
      }
    },
    [state, follow],
  );

  const reset = React.useCallback(() => {
    watching.current?.abort();
    setState({ phase: "idle" });
  }, []);

  React.useEffect(() => () => watching.current?.abort(), []);
  return { state, start, cancel, retry, reset };
}
