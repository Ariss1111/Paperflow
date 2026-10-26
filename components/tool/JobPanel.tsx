"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Download, FileDown, ArrowRight, RotateCcw, CheckCircle2, AlertCircle, ChevronDown, FileArchive, X } from "lucide-react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { cn, formatBytes } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Progress, Notice, toast } from "@/components/ui/feedback";
import { api, download } from "@/lib/client/api";
import { TOOLS, toolHref } from "@/lib/tools/catalog";
import { ToolGlyph } from "@/components/ToolIcon";
import { formatFromExtension } from "@/lib/formats";
import type { Job } from "@/types";
import type { RunState } from "./useJob";

function Elapsed({ since }: { since?: number }) {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!since) return null;
  const s = Math.max(0, Math.round((now - since) / 1000));
  return <span className="tabular-nums">{s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`}</span>;
}

export function Processing({ state, onCancel }: { state: RunState; onCancel: () => void }) {
  const job = state.phase === "running" ? state.job : null;
  return (
    <div className="animate-rise-in rounded-[18px] bg-surface p-6 shadow-card sm:p-8" aria-live="polite">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-lg font-semibold text-ink">{job?.status === "queued" ? "Waiting in queue…" : "Processing document…"}</p>
          <p className="mt-1 text-sm text-ink-2">{job?.message ?? "Starting…"}</p>
        </div>
        <span className="text-sm text-ink-3">
          <Elapsed since={job?.startedAt ?? job?.createdAt} />
        </span>
      </div>
      <Progress className="mt-6" value={job?.progress ?? null} label="Processing progress" />
      <div className="mt-2 flex items-center justify-between text-xs text-ink-3">
        <span>{job?.progress != null ? `${Math.round(job.progress * 100)}%` : "This step can't report exact progress"}</span>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={!job || job.message === "Cancelling…"} icon={<X className="size-3.5" />}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

const SUMMARY_LABELS: Record<string, string> = {
  pages: "Pages",
  files: "Files",
  pagesLeft: "Pages left",
  removedPages: "Blank pages removed",
  fieldsFilled: "Fields filled",
  bookmarks: "Bookmarks",
  encryption: "Encryption",
  characters: "Characters",
  images: "Images",
  pagesRecognised: "Pages recognised",
  pagesSkipped: "Pages with existing text",
  pagesCompared: "Pages compared",
  pagesChanged: "Pages changed",
  linesAdded: "Lines added",
  linesRemoved: "Lines removed",
  removed: "Text areas removed",
  annotations: "Annotations",
  overlays: "Overlays",
  title: "Title",
  author: "Author",
  subject: "Subject",
  keywords: "Keywords",
  creator: "Creator",
  producer: "Producer",
  creationDate: "Created",
  modificationDate: "Modified",
  pdfVersion: "PDF version",
  pageSize: "First page size",
  hasXmp: "XMP metadata",
};

function SummaryGrid({ job }: { job: Job }) {
  const s = job.summary ?? {};
  if ("originalSize" in s) {
    const before = Number(s.originalSize);
    const after = Number(s.resultSize);
    const pct = Number(s.reductionPercent);
    return (
      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl bg-ink/[0.06]">
        {[
          ["Original", formatBytes(before)],
          ["Result", formatBytes(after)],
          ["Saved", s.reduced ? `−${pct}%` : "0%"],
        ].map(([k, v], i) => (
          <div key={k} className="bg-surface px-4 py-3">
            <p className="text-xs text-ink-3">{k}</p>
            <p className={cn("mt-0.5 text-lg font-semibold tabular-nums", i === 2 && s.reduced ? "text-success" : "text-ink")}>{v}</p>
          </div>
        ))}
      </div>
    );
  }
  const rows = Object.entries(s).filter(([k]) => SUMMARY_LABELS[k]);
  if (!rows.length) return null;
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 rounded-xl bg-surface-2 px-4 py-3 text-sm sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3">
          <dt className="text-ink-3">{SUMMARY_LABELS[k]}</dt>
          <dd className="truncate text-right font-medium text-ink" title={String(v)}>
            {typeof v === "boolean" ? (v ? "Yes" : "No") : k.endsWith("Date") ? new Date(String(v)).toLocaleString() : String(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ContinueMenu({ job, index }: { job: Job; index: number }) {
  const router = useRouter();
  const out = job.outputs[index];
  const fmt = formatFromExtension(out.name);
  const tools = TOOLS.filter((t) => fmt && t.accepts.includes(fmt) && t.id !== job.tool).slice(0, 12);
  if (!tools.length) return null;
  const go = async (href: string) => {
    try {
      const { file } = await api.useOutput(job.id, index);
      router.push(`${href}?files=${file.id}`);
    } catch (e) {
      toast((e as Error).message, "danger");
    }
  };
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button size="sm" variant="ghost" icon={<ArrowRight className="size-3.5" />}>
          Continue <ChevronDown className="size-3 opacity-60" />
        </Button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" sideOffset={6} className="glass z-50 max-h-[60vh] w-60 animate-rise-in overflow-y-auto rounded-xl p-1.5 shadow-overlay">
          <Menu.Label className="px-2 pb-1 pt-1.5 text-2xs font-semibold uppercase tracking-wide text-ink-3">Use result in</Menu.Label>
          {tools.map((t) => (
            <Menu.Item key={t.id} onSelect={() => go(toolHref(t))} className="flex cursor-default items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-ink outline-none data-[highlighted]:bg-accent data-[highlighted]:text-white">
              <ToolGlyph icon={t.icon} category={t.category} size="sm" className="!size-6" />
              {t.name}
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

export function Result({ job, onStartOver }: { job: Job; onStartOver: () => void }) {
  const many = job.outputs.length > 1;
  const total = job.outputs.reduce((s, o) => s + o.size, 0);
  return (
    <div className="animate-rise-in space-y-5 rounded-[18px] bg-surface p-6 shadow-card sm:p-8">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-success" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-ink">{many ? `${job.outputs.length} files ready` : "Your file is ready"}</h2>
          <p className="text-sm text-ink-2">
            {formatBytes(total)} · finished in {Math.max(1, Math.round(((job.finishedAt ?? 0) - (job.startedAt ?? 0)) / 1000))}s · available for a limited time
          </p>
        </div>
      </div>

      <SummaryGrid job={job} />
      {job.notes?.length ? (
        <ul className="space-y-1 text-sm text-ink-2">
          {job.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {many ? (
          <Button variant="primary" size="lg" icon={<FileArchive className="size-4" />} onClick={() => download(api.downloadAllUrl(job.id))}>
            Download all (ZIP)
          </Button>
        ) : (
          <Button variant="primary" size="lg" icon={<Download className="size-4" />} onClick={() => download(api.downloadUrl(job.id, 0))}>
            Download {job.outputs[0].name.split(".").pop()?.toUpperCase()}
          </Button>
        )}
        <Button size="lg" icon={<RotateCcw className="size-4" />} onClick={onStartOver}>
          Start over
        </Button>
      </div>

      <ul className="divide-y overflow-hidden rounded-xl shadow-[inset_0_0_0_0.5px_rgb(var(--line)/0.12)]">
        {job.outputs.slice(0, 200).map((o) => (
          <li key={o.index} className="flex items-center gap-3 px-3.5 py-2.5">
            <FileDown className="size-4 shrink-0 text-ink-3" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-sm text-ink" title={o.name}>
              {o.name}
            </span>
            <span className="shrink-0 text-xs tabular-nums text-ink-3">{formatBytes(o.size)}</span>
            <ContinueMenu job={job} index={o.index} />
            <Button size="sm" onClick={() => download(api.downloadUrl(job.id, o.index))} aria-label={`Download ${o.name}`}>
              Download
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Failure({ error, onRetry, onEdit }: { error: string; onRetry?: () => void; onEdit: () => void }) {
  return (
    <div className="animate-rise-in space-y-5 rounded-[18px] bg-surface p-6 shadow-card sm:p-8">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 size-6 shrink-0 text-danger" aria-hidden />
        <div>
          <h2 className="text-lg font-semibold text-ink">That didn&apos;t work</h2>
          <p className="mt-1 text-sm text-ink-2" role="alert">
            {error}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {onRetry && (
          <Button variant="primary" icon={<RotateCcw className="size-4" />} onClick={onRetry}>
            Try again
          </Button>
        )}
        <Button onClick={onEdit}>Change files or options</Button>
      </div>
    </div>
  );
}

export { Notice };
