"use client";
import * as React from "react";
import type { Extraction } from "./types";

export type AiEvent =
  | { t: "text"; v: string }
  | { t: "progress"; v: string }
  | { t: "notice"; v: string }
  | { t: "data"; v: Extraction }
  | { t: "error"; v: string }
  | { t: "done"; stop: string | null; model: string; usage: { requests: number; tokens: number } };

/** POSTs to /api/ai and calls onEvent for each streamed NDJSON event. */
export async function streamAi(body: Record<string, unknown>, signal: AbortSignal, onEvent: (e: AiEvent) => void) {
  const res = await fetch("/api/ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `The AI request failed (${res.status}).`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) onEvent(JSON.parse(line) as AiEvent);
    }
  }
}

export interface RunState {
  text: string;
  progress: string;
  notices: string[];
  error: string | null;
  data: Extraction | null;
  busy: boolean;
  /** finished without an error */
  done: boolean;
}

const EMPTY: RunState = { text: "", progress: "", notices: [], error: null, data: null, busy: false, done: false };

/** One AI request at a time with its streamed result; `onDone` gets the new usage numbers. */
export function useAiRun(onDone?: (usage: { requests: number; tokens: number }) => void) {
  const [state, setState] = React.useState<RunState>(EMPTY);
  const ctl = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => ctl.current?.abort(), []);

  const run = React.useCallback(
    async (body: Record<string, unknown>) => {
      ctl.current?.abort();
      const c = new AbortController();
      ctl.current = c;
      setState({ ...EMPTY, busy: true });
      let failed = false;
      try {
        await streamAi(body, c.signal, (e) => {
          if (e.t === "text") setState((s) => ({ ...s, text: s.text + e.v, progress: "" }));
          else if (e.t === "progress") setState((s) => ({ ...s, progress: e.v }));
          else if (e.t === "notice") setState((s) => ({ ...s, notices: [...s.notices, e.v] }));
          else if (e.t === "data") setState((s) => ({ ...s, data: e.v }));
          else if (e.t === "error") {
            failed = true;
            setState((s) => ({ ...s, error: e.v }));
          } else if (e.t === "done") onDone?.(e.usage);
        });
      } catch (e) {
        if (!c.signal.aborted) {
          failed = true;
          setState((s) => ({ ...s, error: (e as Error).message }));
        }
      } finally {
        if (ctl.current === c) setState((s) => ({ ...s, busy: false, progress: "", done: !failed && !c.signal.aborted }));
      }
    },
    [onDone],
  );
  const stop = React.useCallback(() => {
    ctl.current?.abort();
    setState((s) => ({ ...s, busy: false, progress: "" }));
  }, []);
  const reset = React.useCallback(() => {
    ctl.current?.abort();
    setState(EMPTY);
  }, []);
  return { state, run, stop, reset };
}

/** Saves text as a file in the browser. */
export function saveFile(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
