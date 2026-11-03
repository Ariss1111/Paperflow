"use client";
import * as React from "react";
import { FileText, GitCompare, Loader2, Sparkles, Square, X } from "lucide-react";
import { DropZone } from "@/components/files/DropZone";
import { useUploader } from "@/components/files/useUploader";
import { UploadErrors } from "@/components/tool/ToolWorkspace";
import { Button, IconButton } from "@/components/ui/button";
import { Segmented } from "@/components/ui/controls";
import { Notice } from "@/components/ui/feedback";
import { cn } from "@/lib/utils";
import type { StoredFile } from "@/types";
import { Answer } from "./Answer";
import { useAiRun } from "./stream";
import type { CompareItem, CompareResult } from "./types";

type Filter = "changes" | "all" | "changed" | "added" | "removed" | "format";

const KIND: Record<CompareItem["kind"], { label: string; cls: string }> = {
  changed: { label: "Changed", cls: "bg-[#ff9f0a]/15 text-[#b25000] dark:text-[#ffb340]" },
  added: { label: "Added", cls: "bg-success/15 text-success" },
  removed: { label: "Removed", cls: "bg-danger/15 text-danger" },
  format: { label: "Formatting", cls: "bg-[#5b4cf0]/12 text-[#5b4cf0] dark:text-[#9d93ff]" },
  same: { label: "Unchanged", cls: "bg-surface-2 text-ink-3" },
};

function Item({ item, onPage }: { item: CompareItem; onPage: (side: "a" | "b", page: number) => void }) {
  const k = KIND[item.kind];
  return (
    <li className={cn("space-y-2 rounded-xl p-3 text-sm", item.kind === "same" ? "text-ink-3" : "bg-surface shadow-hairline")} data-kind={item.kind}>
      {item.kind !== "same" && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className={cn("rounded-md px-1.5 py-0.5 font-semibold", k.cls)}>{k.label}</span>
          {item.a && (
            <button type="button" className="text-ink-3 hover:text-accent" onClick={() => onPage("a", item.a!.page)}>
              Original p. {item.a.page}
            </button>
          )}
          {item.a && item.b && <span className="text-ink-3">→</span>}
          {item.b && (
            <button type="button" className="text-ink-3 hover:text-accent" onClick={() => onPage("b", item.b!.page)}>
              Revised p. {item.b.page}
            </button>
          )}
        </div>
      )}
      {item.kind === "changed" ? (
        <p className="leading-6 text-ink">
          {item.words!.map((s, i) => (
            <React.Fragment key={i}>
              {i > 0 && " "}
              {s.op === "same" ? s.text : s.op === "del" ? <del className="rounded bg-danger/15 px-0.5 text-danger decoration-danger/60">{s.text}</del> : <ins className="rounded bg-success/15 px-0.5 text-success no-underline">{s.text}</ins>}
            </React.Fragment>
          ))}
        </p>
      ) : item.kind === "removed" ? (
        <p className="leading-6 text-danger line-through decoration-danger/50">{item.a!.text}</p>
      ) : item.kind === "added" ? (
        <p className="leading-6 text-success">{item.b!.text}</p>
      ) : (
        <p className={cn("leading-6", item.kind === "same" ? "line-clamp-2" : "text-ink")}>{(item.b ?? item.a)!.text}</p>
      )}
      {(item.dates?.length || item.numbers?.length || item.format?.length) ? (
        <div className="flex flex-wrap gap-1.5">
          {item.dates?.map((d, i) => (
            <span key={`d${i}`} className="rounded-md bg-accent/10 px-1.5 py-0.5 text-xs text-ink" data-testid="changed-date">
              Date: <b>{d.from}</b> → <b>{d.to}</b>
            </span>
          ))}
          {item.numbers?.map((d, i) => (
            <span key={`n${i}`} className="rounded-md bg-accent/10 px-1.5 py-0.5 text-xs text-ink" data-testid="changed-number">
              Number: <b>{d.from}</b> → <b>{d.to}</b>
            </span>
          ))}
          {item.format?.map((f) => (
            <span key={f} className="rounded-md bg-[#5b4cf0]/10 px-1.5 py-0.5 text-xs text-ink">
              {f}
            </span>
          ))}
        </div>
      ) : null}
    </li>
  );
}

export function ComparePanel({
  file,
  other,
  onOther,
  recent,
  aiReady,
  onPage,
  onUsage,
  consent,
}: {
  file: StoredFile;
  other: StoredFile | null;
  onOther: (f: StoredFile | null) => void;
  recent: StoredFile[];
  aiReady: boolean;
  onPage: (side: "a" | "b", page: number) => void;
  onUsage: (u: { requests: number; tokens: number }) => void;
  consent: () => Promise<boolean>;
}) {
  const uploader = useUploader(["pdf"]);
  const [result, setResult] = React.useState<CompareResult | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<Filter>("changes");
  const explain = useAiRun(onUsage);

  React.useEffect(() => {
    setResult(null);
    explain.reset();
    if (!other) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch("/api/compare", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fileId: file.id, otherId: other.id }) })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "The comparison failed.");
        if (!cancelled) setResult(j as CompareResult);
      })
      .catch((e) => !cancelled && setError((e as Error).message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [file.id, other]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = (result?.items ?? []).filter((i) => (filter === "all" ? true : filter === "changes" ? i.kind !== "same" : i.kind === filter));
  const s = result?.summary;

  if (!other) {
    const choices = recent.filter((f) => f.id !== file.id && f.format === "pdf");
    return (
      <div className="scroll-thin h-full space-y-4 overflow-y-auto p-4">
        <p className="text-sm text-ink-2">
          Compare <b className="text-ink">{file.name}</b> with another version. Changed wording, added and removed paragraphs, dates, numbers and formatting are highlighted. The comparison itself runs on this server without AI.
        </p>
        <DropZone size="sm" multiple={false} accepts={["pdf"]} title="Drop the revised PDF" hint="The document to compare against" onFiles={async (l) => { const [f] = await uploader.upload(l); if (f) onOther(f); }} uploading={uploader.uploading} progress={uploader.progress} onCancel={uploader.cancel} />
        <UploadErrors errors={uploader.errors} onDismiss={uploader.clearErrors} />
        {choices.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-ink-3">Or pick a recent PDF</p>
            <ul className="space-y-1">
              {choices.map((f) => (
                <li key={f.id}>
                  <button type="button" onClick={() => onOther(f)} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm text-ink hover:bg-ink/[0.04]">
                    <FileText className="size-4 shrink-0 text-ink-3" />
                    <span className="truncate">{f.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-3 border-b p-4">
        <div className="flex items-center gap-2 text-sm">
          <GitCompare className="size-4 shrink-0 text-ink-3" />
          <p className="min-w-0 flex-1 truncate text-ink">
            <span className="text-ink-3">Revised:</span> <b>{other.name}</b>
          </p>
          <IconButton size="sm" label="Compare with another document" onClick={() => onOther(null)}>
            <X className="size-3.5" />
          </IconButton>
        </div>
        {s && (
          <div className="flex flex-wrap gap-1.5 text-xs" data-testid="compare-summary">
            <span className={cn("rounded-md px-2 py-1 font-medium", KIND.changed.cls)}>{s.changed} changed</span>
            <span className={cn("rounded-md px-2 py-1 font-medium", KIND.added.cls)}>{s.added} added</span>
            <span className={cn("rounded-md px-2 py-1 font-medium", KIND.removed.cls)}>{s.removed} removed</span>
            <span className={cn("rounded-md px-2 py-1 font-medium", KIND.format.cls)}>{s.formatting} formatting</span>
            <span className="rounded-md bg-accent/10 px-2 py-1 font-medium text-accent">
              {s.dates} date{s.dates === 1 ? "" : "s"}, {s.numbers} number{s.numbers === 1 ? "" : "s"} changed
            </span>
          </div>
        )}
        {s && (
          <div className="flex flex-wrap items-center gap-2">
            <Segmented<Filter>
              size="sm"
              label="Show"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "changes", label: "All changes" },
                { value: "changed", label: "Changed" },
                { value: "added", label: "Added" },
                { value: "removed", label: "Removed" },
                { value: "format", label: "Formatting" },
                { value: "all", label: "Everything" },
              ]}
            />
            {explain.state.busy ? (
              <Button size="sm" className="ml-auto" icon={<Square className="size-3" />} onClick={explain.stop}>
                Stop
              </Button>
            ) : (
              <Button size="sm" className="ml-auto" icon={<Sparkles className="size-3.5" />} disabled={!aiReady || s.changed + s.added + s.removed + s.formatting === 0} onClick={async () => (await consent()) && explain.run({ fileId: file.id, otherId: other.id, task: "compare" })} title={aiReady ? "Have the AI explain what the changes mean" : "AI isn't set up on this server"}>
                Explain with AI
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="scroll-thin min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4" data-testid="compare-results">
        {loading && (
          <p className="flex items-center gap-2 text-sm text-ink-3">
            <Loader2 className="size-4 animate-spin" /> Comparing…
          </p>
        )}
        {error && <Notice tone="danger" title="Couldn't compare">{error}</Notice>}
        {(explain.state.text || explain.state.busy || explain.state.error) && (
          <div className="rounded-xl bg-accent/[0.05] p-4" aria-live="polite" data-testid="compare-explanation">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-accent">
              <Sparkles className="size-3.5" /> What changed, explained
            </p>
            {explain.state.busy && !explain.state.text && (
              <p className="flex items-center gap-2 text-sm text-ink-3">
                <Loader2 className="size-4 animate-spin" /> Reading the changes…
              </p>
            )}
            {explain.state.text && <Answer text={explain.state.text} streaming={explain.state.busy} />}
            {explain.state.error && <Notice tone="danger">{explain.state.error}</Notice>}
          </div>
        )}
        {result && items.length === 0 && <p className="py-6 text-center text-sm text-ink-3">{s && s.changed + s.added + s.removed + s.formatting === 0 ? "The text of both documents is identical." : "Nothing of this kind."}</p>}
        <ul className="space-y-2">
          {items.slice(0, 1500).map((i, k) => (
            <Item key={k} item={i} onPage={onPage} />
          ))}
        </ul>
      </div>
    </div>
  );
}
