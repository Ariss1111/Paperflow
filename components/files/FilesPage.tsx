"use client";
import * as React from "react";
import Link from "next/link";
import { FolderOpen, History, Trash2, Download, RotateCcw, X, FileArchive, Clock } from "lucide-react";
import { Container, PageHeader } from "@/components/shell/AppShell";
import { Segmented } from "@/components/ui/controls";
import { Button, IconButton } from "@/components/ui/button";
import { Badge, EmptyState, toast, Progress } from "@/components/ui/feedback";
import { useConfirm } from "@/components/ui/dialog";
import { FileThumb } from "./Thumb";
import { DropZone } from "./DropZone";
import { useUploader } from "./useUploader";
import { UploadErrors } from "@/components/tool/ToolWorkspace";
import { ToolGlyph } from "@/components/ToolIcon";
import { api, download } from "@/lib/client/api";
import { TOOLS, toolHref } from "@/lib/tools/catalog";
import { FORMATS, UPLOADABLE } from "@/lib/formats";
import { formatBytes, formatRelative } from "@/lib/utils";
import type { Job, StoredFile } from "@/types";

function expiresIn(ts: number) {
  const m = Math.max(0, Math.round((ts - Date.now()) / 60000));
  return m < 1 ? "expires soon" : `deleted in ${m} min`;
}

export function FilesPage() {
  const [tab, setTab] = React.useState<"files" | "history">("files");
  const [files, setFiles] = React.useState<StoredFile[] | null>(null);
  const [jobs, setJobs] = React.useState<Job[] | null>(null);
  const uploader = useUploader();
  const { confirm, element } = useConfirm();

  const refresh = React.useCallback(() => {
    api.listFiles().then((r) => setFiles(r.files)).catch(() => setFiles([]));
    api.listJobs().then((r) => setJobs(r.jobs)).catch(() => setJobs([]));
  }, []);
  React.useEffect(refresh, [refresh]);
  // keep running jobs fresh
  React.useEffect(() => {
    if (!jobs?.some((j) => j.status === "queued" || j.status === "processing")) return;
    const t = setTimeout(refresh, 1000);
    return () => clearTimeout(t);
  }, [jobs, refresh]);

  const remove = async (f: StoredFile) => {
    if (!(await confirm(`Delete “${f.name}”?`, "Delete", "The file is removed from the server immediately."))) return;
    try {
      await api.deleteFile(f.id);
      setFiles((p) => p?.filter((x) => x.id !== f.id) ?? null);
    } catch (e) {
      toast((e as Error).message, "danger");
    }
  };
  const removeAll = async () => {
    if (!files?.length || !(await confirm(`Delete all ${files.length} files?`, "Delete all", "Uploaded files are removed from the server immediately. Results of finished jobs expire on their own."))) return;
    await Promise.allSettled(files.map((f) => api.deleteFile(f.id)));
    refresh();
  };

  return (
    <Container>
      {element}
      <PageHeader
        title="My Files"
        subtitle="Everything in this browser session. Files are deleted automatically — nothing here is kept long-term."
        actions={
          tab === "files" && files?.length ? (
            <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={removeAll}>
              Delete all
            </Button>
          ) : undefined
        }
      />
      <Segmented
        label="View"
        value={tab}
        onChange={setTab}
        className="mb-6 max-w-xs"
        options={[
          { value: "files", label: `Files${files ? ` (${files.length})` : ""}` },
          { value: "history", label: `History${jobs ? ` (${jobs.length})` : ""}` },
        ]}
      />

      {tab === "files" ? (
        <>
          <DropZone
            size="sm"
            accepts={UPLOADABLE}
            onFiles={async (l) => {
              const up = await uploader.upload(l);
              if (up.length) setFiles((p) => [...up, ...(p ?? [])]);
            }}
            uploading={uploader.uploading}
            progress={uploader.progress}
            onCancel={uploader.cancel}
            title="Add files"
          />
          <UploadErrors errors={uploader.errors} onDismiss={uploader.clearErrors} />
          {files === null ? (
            <div className="mt-6 space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-xl bg-surface shadow-card" />
              ))}
            </div>
          ) : files.length === 0 ? (
            <EmptyState icon={<FolderOpen className="size-5" />} title="No files yet">
              Files you upload in any tool appear here until they expire.
            </EmptyState>
          ) : (
            <ul className="mt-6 grid gap-3 sm:grid-cols-2">
              {files.map((f) => {
                const tools = TOOLS.filter((t) => t.accepts.includes(f.format)).slice(0, 3);
                return (
                  <li key={f.id} className="flex gap-3.5 rounded-[16px] bg-surface p-3.5 shadow-card">
                    <FileThumb file={f} width={52} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink" title={f.name}>
                        {f.name}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-3">
                        {FORMATS[f.format].label} · {formatBytes(f.size)}
                        {f.pages ? ` · ${f.pages} pages` : ""}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-ink-3">
                        <Clock className="size-3" aria-hidden /> {expiresIn(f.expiresAt)}
                        {f.sourceJobId && <Badge className="ml-1">Result</Badge>}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {tools.map((t) => (
                          <Link key={t.id} href={`${toolHref(t)}?files=${f.id}`} className="inline-flex h-6 items-center rounded-md bg-ink/[0.05] px-2 text-xs font-medium text-ink-2 hover:bg-ink/[0.08] hover:text-ink">
                            {t.name}
                          </Link>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <IconButton size="sm" label={`Download ${f.name}`} onClick={() => download(api.fileUrl(f.id))}>
                        <Download className="size-3.5" />
                      </IconButton>
                      <IconButton size="sm" label={`Delete ${f.name}`} onClick={() => remove(f)} className="hover:text-danger">
                        <Trash2 className="size-3.5" />
                      </IconButton>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : jobs === null ? null : jobs.length === 0 ? (
        <EmptyState icon={<History className="size-5" />} title="Nothing processed yet">
          Jobs you run appear here with their status and downloads.
        </EmptyState>
      ) : (
        <ul className="divide-y overflow-hidden rounded-[16px] bg-surface shadow-card">
          {jobs.map((j) => {
            const t = TOOLS.find((x) => x.id === j.tool);
            const running = j.status === "queued" || j.status === "processing";
            return (
              <li key={j.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                {t && <ToolGlyph icon={t.icon} category={t.category} size="sm" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">
                    {j.toolName} <span className="font-normal text-ink-3">· {j.inputs.map((i) => i.name).join(", ")}</span>
                  </p>
                  <p className="text-xs text-ink-3">
                    {formatRelative(j.createdAt)}
                    {j.status === "completed" && ` · ${j.outputs.length} result${j.outputs.length === 1 ? "" : "s"} · ${formatBytes(j.outputs.reduce((s, o) => s + o.size, 0))}`}
                    {j.status === "failed" && j.error && ` · ${j.error}`}
                  </p>
                  {running && <Progress className="mt-2 max-w-xs" value={j.progress} />}
                </div>
                <Badge tone={j.status === "completed" ? "success" : j.status === "failed" ? "danger" : running ? "accent" : "neutral"}>{j.status}</Badge>
                {j.status === "completed" &&
                  (j.outputs.length > 1 ? (
                    <Button size="sm" icon={<FileArchive className="size-3.5" />} onClick={() => download(api.downloadAllUrl(j.id))}>
                      ZIP
                    </Button>
                  ) : (
                    <Button size="sm" icon={<Download className="size-3.5" />} onClick={() => download(api.downloadUrl(j.id, 0))}>
                      Download
                    </Button>
                  ))}
                {running && (
                  <IconButton size="sm" label="Cancel job" onClick={() => api.cancelJob(j.id).then(refresh)}>
                    <X className="size-4" />
                  </IconButton>
                )}
                {(j.status === "failed" || j.status === "cancelled") && !["protect", "unlock"].includes(j.tool) && (
                  <IconButton
                    size="sm"
                    label="Retry job"
                    onClick={() =>
                      api
                        .retryJob(j.id)
                        .then(refresh)
                        .catch((e) => toast((e as Error).message, "danger"))
                    }
                  >
                    <RotateCcw className="size-3.5" />
                  </IconButton>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Container>
  );
}
