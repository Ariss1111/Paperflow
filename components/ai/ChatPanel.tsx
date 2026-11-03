"use client";
import * as React from "react";
import { ArrowUp, Copy, Download, Loader2, Quote, RotateCcw, Square, X } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Notice, toast } from "@/components/ui/feedback";
import { baseName, cn } from "@/lib/utils";
import type { StoredFile } from "@/types";
import { Answer } from "./Answer";
import { saveFile, streamAi } from "./stream";

interface Turn {
  role: "user" | "assistant";
  content: string;
  notices?: string[];
  error?: string;
}

export const SUGGESTIONS = [
  "Summarize this document.",
  "Explain this paragraph.",
  "Find the important dates.",
  "What are the main conclusions?",
  "Extract all names and addresses.",
  "Explain this contract in simple language.",
];

const key = (id: string) => `pf-ai-chat:${id}`;
function loadTurns(id: string): Turn[] {
  try {
    return JSON.parse(sessionStorage.getItem(key(id)) ?? "[]") as Turn[];
  } catch {
    return [];
  }
}

export function ChatPanel({
  file,
  ready,
  selection,
  onClearSelection,
  onPage,
  onUsage,
  consent,
}: {
  file: StoredFile;
  /** AI is configured and the document can be used */
  ready: boolean;
  selection: { text: string; page: number } | null;
  onClearSelection: () => void;
  onPage: (page: number) => void;
  onUsage: (u: { requests: number; tokens: number }) => void;
  consent: () => Promise<boolean>;
}) {
  // the conversation survives switching tabs and reloading, for this browser tab only
  const [turns, setTurns] = React.useState<Turn[]>(() => loadTurns(file.id));
  const [question, setQuestion] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [hint, setHint] = React.useState<string | null>(null);
  const abort = React.useRef<AbortController | null>(null);
  const bottom = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    try {
      sessionStorage.setItem(key(file.id), JSON.stringify(turns.slice(-60)));
    } catch {
      // storage full or blocked: the chat just isn't kept
    }
  }, [turns, file.id]);
  React.useEffect(() => bottom.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }), [turns]);
  React.useEffect(() => () => abort.current?.abort(), []);

  const send = async (raw: string) => {
    let q = raw.trim();
    if (!q || busy || !ready) return;
    // questions about "this paragraph" use the text selected in the viewer
    if (/\bthis (paragraph|section|clause|part)\b/i.test(q) && !selection) {
      setHint("Select the paragraph in the document on the left first, then ask again.");
      return;
    }
    if (selection) q = `${q}\n\nThe passage I mean (p. ${selection.page}):\n> ${selection.text.replace(/\n/g, "\n> ")}`;
    if (!(await consent())) return;
    setHint(null);
    setQuestion("");
    onClearSelection();
    const history: Turn[] = [...turns.filter((t) => !t.error && t.content), { role: "user", content: q }];
    setTurns([...history, { role: "assistant", content: "" }]);
    const update = (fn: (t: Turn) => Turn) => setTurns((all) => all.map((t, i) => (i === all.length - 1 ? fn(t) : t)));
    const ctl = new AbortController();
    abort.current = ctl;
    setBusy(true);
    try {
      await streamAi({ fileId: file.id, task: "ask", conversation: history.map(({ role, content }) => ({ role, content })) }, ctl.signal, (e) => {
        if (e.t === "text") update((t) => ({ ...t, content: t.content + e.v }));
        else if (e.t === "notice") update((t) => ({ ...t, notices: [...(t.notices ?? []), e.v] }));
        else if (e.t === "error") update((t) => ({ ...t, error: e.v }));
        else if (e.t === "done") onUsage(e.usage);
      });
    } catch (e) {
      if (!ctl.signal.aborted) update((t) => ({ ...t, error: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  };

  const transcript = () => turns.map((t) => `${t.role === "user" ? "**You:**" : "**Pagelyt AI:**"} ${t.content}`).join("\n\n");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-end gap-1 border-b px-3 py-1.5">
        {busy && (
          <Button size="sm" variant="ghost" icon={<Square className="size-3" />} onClick={() => abort.current?.abort()}>
            Stop
          </Button>
        )}
        <IconButton size="sm" label="Copy conversation" disabled={!turns.length || busy} onClick={() => navigator.clipboard.writeText(transcript()).then(() => toast("Conversation copied.", "success"), () => toast("Copy isn't allowed in this browser.", "danger"))}>
          <Copy className="size-3.5" />
        </IconButton>
        <IconButton size="sm" label="Download conversation" disabled={!turns.length || busy} onClick={() => saveFile(`${baseName(file.name)}-chat.md`, transcript(), "text/markdown;charset=utf-8")}>
          <Download className="size-3.5" />
        </IconButton>
        <IconButton size="sm" label="Clear conversation" disabled={!turns.length || busy} onClick={() => setTurns([])}>
          <RotateCcw className="size-3.5" />
        </IconButton>
      </div>

      <div className="scroll-thin min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-6" data-testid="ai-chat" aria-live="polite">
        {turns.length === 0 && (
          <div className="py-6">
            <p className="mb-3 text-sm text-ink-2">Ask anything about this document. Answers point to the pages they come from. Click a page to see it.</p>
            <p className="eyebrow mb-2">Try</p>
            <div className="flex flex-wrap gap-2" data-testid="suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" disabled={!ready || busy} onClick={() => send(s)} className="rounded-full bg-surface-2 px-3 py-1.5 text-left text-sm text-ink shadow-hairline transition-colors hover:bg-accent/10 hover:text-accent disabled:opacity-50">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) =>
          t.role === "user" ? (
            <div key={i} className="ml-auto max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-[15px] text-white">
              {t.content}
            </div>
          ) : (
            <div key={i} className="space-y-2">
              {t.content ? (
                <Answer text={t.content} streaming={busy && i === turns.length - 1} pages={file.pages ?? 1} onPage={onPage} />
              ) : (
                !t.error && (
                  <p className="flex items-center gap-2 text-sm text-ink-3">
                    <Loader2 className="size-4 animate-spin" /> Reading the document…
                  </p>
                )
              )}
              {t.notices?.map((n) => (
                <Notice key={n} tone="info">
                  {n}
                </Notice>
              ))}
              {t.error && (
                <Notice tone="danger" title="That didn't work">
                  {t.error}
                </Notice>
              )}
            </div>
          ),
        )}
        <div ref={bottom} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(question);
        }}
        className="space-y-2 border-t p-3"
      >
        {selection && (
          <div className="flex items-start gap-2 rounded-xl bg-accent/[0.07] px-3 py-2 text-sm text-ink" data-testid="chat-selection">
            <Quote className="mt-0.5 size-3.5 shrink-0 text-accent" />
            <span className="line-clamp-2 flex-1">
              <span className="font-medium">p. {selection.page}:</span> {selection.text}
            </span>
            <IconButton size="sm" label="Don't use the selection" onClick={onClearSelection}>
              <X className="size-3.5" />
            </IconButton>
          </div>
        )}
        {selection && !question && (
          <div className="flex flex-wrap gap-1.5">
            {["Explain this paragraph.", "Explain this in simple language.", "What does this mean for me?"].map((s) => (
              <button key={s} type="button" onClick={() => send(s)} disabled={!ready || busy} className="rounded-full bg-surface-2 px-2.5 py-1 text-xs text-ink shadow-hairline hover:bg-accent/10 hover:text-accent">
                {s}
              </button>
            ))}
          </div>
        )}
        {hint && <p className="text-xs text-warning" role="status">{hint}</p>}
        <div className="flex items-end gap-2">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(question);
              }
            }}
            rows={1}
            maxLength={4000}
            aria-label="Your question"
            placeholder={selection ? "Ask about the selected text…" : "Ask about this document…"}
            disabled={!ready}
            className={cn("max-h-40 min-h-11 flex-1 resize-none rounded-xl bg-surface-2 px-3.5 py-2.5 text-[15px] text-ink placeholder:text-ink-3 focus:outline-none focus:ring-[3px] focus:ring-accent/25 disabled:opacity-50")}
          />
          <Button type="submit" variant="primary" aria-label="Send question" className="size-11 !px-0" disabled={!question.trim() || busy || !ready}>
            {busy ? <Loader2 className="size-5 animate-spin" /> : <ArrowUp className="size-5" />}
          </Button>
        </div>
      </form>
    </div>
  );
}
