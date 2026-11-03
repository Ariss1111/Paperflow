"use client";
import * as React from "react";
import { Copy, FileDown, FileText, Languages, Loader2, Sparkles, Square } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Select } from "@/components/ui/controls";
import { Notice, toast } from "@/components/ui/feedback";
import { markdownToDocx } from "@/lib/client/md-docx";
import { baseName, cn } from "@/lib/utils";
import type { StoredFile } from "@/types";
import { Answer } from "./Answer";
import { saveFile, useAiRun } from "./stream";

export const LANGUAGES = ["English", "Romanian", "French", "German", "Spanish", "Italian"];

const STYLES = [
  { id: "short", label: "Short", blurb: "A few sentences and the essentials" },
  { id: "detailed", label: "Detailed", blurb: "Every part, with figures, names and obligations" },
  { id: "sections", label: "By section", blurb: "Following the document's own structure" },
  { id: "keypoints", label: "Key points", blurb: "Bullet points grouped by topic" },
  { id: "dates", label: "Important dates", blurb: "A timeline of dates and deadlines" },
  { id: "actions", label: "Action items", blurb: "Who has to do what, by when" },
] as const;

export function RunPanel({
  mode,
  file,
  ready,
  onPage,
  onUsage,
  consent,
}: {
  mode: "summarize" | "translate";
  file: StoredFile;
  ready: boolean;
  onPage: (page: number) => void;
  onUsage: (u: { requests: number; tokens: number }) => void;
  consent: () => Promise<boolean>;
}) {
  const [style, setStyle] = React.useState<(typeof STYLES)[number]["id"]>("short");
  const [language, setLanguage] = React.useState(mode === "translate" ? "Romanian" : "");
  const { state, run, stop } = useAiRun(onUsage);
  const [ran, setRan] = React.useState<string>("");

  const start = async () => {
    if (!(await consent())) return;
    setRan(mode === "translate" ? `Translation into ${language}` : `${STYLES.find((s) => s.id === style)!.label} summary${language ? ` in ${language}` : ""}`);
    run({ fileId: file.id, task: mode, style, language });
  };
  const stem = `${baseName(file.name)}-${mode === "translate" ? language.toLowerCase() : style}`;
  const docx = async () => {
    try {
      saveFile(`${stem}.docx`, await markdownToDocx(state.text, ran), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    } catch {
      toast("The Word file couldn't be created.", "danger");
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-3 border-b p-4">
        {mode === "summarize" ? (
          <div role="radiogroup" aria-label="Summary type" className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {STYLES.map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={style === s.id}
                title={s.blurb}
                onClick={() => setStyle(s.id)}
                className={cn("rounded-lg px-2.5 py-2 text-left text-sm font-medium transition-colors", style === s.id ? "bg-accent text-white shadow-raised" : "bg-surface-2 text-ink hover:bg-surface-3")}
              >
                {s.label}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-ink-2">The whole document, in order, keeping headings, lists, tables and emphasis. Long documents are translated a few pages at a time.</p>
        )}
        <div className="flex items-end gap-2">
          <label className="min-w-0 flex-1 space-y-1">
            <span className="text-xs font-medium text-ink-2">{mode === "translate" ? "Translate into" : "Language"}</span>
            <Select value={language} onChange={(e) => setLanguage(e.target.value)} aria-label={mode === "translate" ? "Translate into" : "Summary language"}>
              {mode === "summarize" && <option value="">Same as the document</option>}
              {LANGUAGES.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </Select>
          </label>
          {state.busy ? (
            <Button icon={<Square className="size-3" />} onClick={stop}>
              Stop
            </Button>
          ) : (
            <Button variant="primary" icon={mode === "translate" ? <Languages className="size-4" /> : <Sparkles className="size-4" />} disabled={!ready} onClick={start}>
              {mode === "translate" ? "Translate" : "Summarize"}
            </Button>
          )}
        </div>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6" aria-live="polite" data-testid={`ai-${mode}`}>
        {!state.text && !state.busy && !state.error && (
          <p className="py-10 text-center text-sm text-ink-3">{mode === "translate" ? "Choose a language and press Translate." : "Choose a summary type and press Summarize."}</p>
        )}
        {state.busy && !state.text && (
          <p className="flex items-center gap-2 text-sm text-ink-3">
            <Loader2 className="size-4 animate-spin" /> {state.progress || "Reading the document…"}
          </p>
        )}
        {state.text && (
          <>
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-ink-2">{ran}</p>
              <div className="flex gap-0.5">
                <IconButton size="sm" label="Copy" disabled={state.busy} onClick={() => navigator.clipboard.writeText(state.text).then(() => toast("Copied.", "success"), () => toast("Copy isn't allowed in this browser.", "danger"))}>
                  <Copy className="size-3.5" />
                </IconButton>
                <IconButton size="sm" label="Download as Word" disabled={state.busy} onClick={docx}>
                  <FileDown className="size-3.5" />
                </IconButton>
                <IconButton size="sm" label="Download as Markdown" disabled={state.busy} onClick={() => saveFile(`${stem}.md`, state.text, "text/markdown;charset=utf-8")}>
                  <FileText className="size-3.5" />
                </IconButton>
              </div>
            </div>
            <Answer text={state.text} streaming={state.busy} pages={file.pages ?? 1} onPage={mode === "summarize" ? onPage : undefined} />
            {state.busy && state.progress && (
              <p className="mt-3 flex items-center gap-2 text-sm text-ink-3">
                <Loader2 className="size-4 animate-spin" /> {state.progress}
              </p>
            )}
          </>
        )}
        <div className="mt-3 space-y-2">
          {state.notices.map((n) => (
            <Notice key={n} tone="info">
              {n}
            </Notice>
          ))}
          {state.error && (
            <Notice tone="danger" title="That didn't work">
              {state.error}
            </Notice>
          )}
        </div>
      </div>
    </div>
  );
}
