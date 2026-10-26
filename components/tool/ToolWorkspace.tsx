"use client";
import * as React from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import type { ToolDef } from "@/lib/tools/catalog";
import { ToolGlyph } from "@/components/ToolIcon";
import { Container } from "@/components/shell/AppShell";
import { DropZone } from "@/components/files/DropZone";
import { FileList } from "@/components/files/FileList";
import { useUploader } from "@/components/files/useUploader";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { useConfirm } from "@/components/ui/dialog";
import { OptionsForm, defaultOptions, validateOptions, type OptionValues } from "./OptionsForm";
import { Processing, Result, Failure } from "./JobPanel";
import { useJob } from "./useJob";
import { useSelectedFiles } from "./useSelectedFiles";
import { useCapabilities } from "@/lib/client/capabilities";
import { getSettings } from "@/lib/client/settings";
import type { StoredFile } from "@/types";

export function ToolHeader({ tool, compact }: { tool: ToolDef; compact?: boolean }) {
  return (
    <header className={compact ? "flex items-center gap-3 pb-5 pt-8" : "flex items-start gap-4 pb-7 pt-8 sm:pt-10"}>
      <ToolGlyph icon={tool.icon} category={tool.category} size="lg" />
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-[-0.022em] text-ink sm:text-[28px] sm:leading-9">{tool.name}</h1>
        <p className="mt-1 max-w-2xl text-base text-ink-2">{tool.description}</p>
      </div>
    </header>
  );
}

function settingsDefaults(tool: ToolDef): Partial<OptionValues> {
  const s = getSettings();
  return { level: s.compression, lang: s.ocrLang, dpi: s.imageDpi };
}

export function ToolWorkspace({ tool }: { tool: ToolDef }) {
  const { files, setFiles, loading, missing } = useSelectedFiles();
  const uploader = useUploader(tool.ui === "editor" ? ["pdf"] : tool.accepts);
  const caps = useCapabilities();
  const { state, start, cancel, retry, reset } = useJob();
  const [values, setValues] = React.useState<OptionValues>(() => defaultOptions(tool));
  const [confirm, setConfirm] = React.useState<Record<string, string>>({});
  const [errors, setErrors] = React.useState<Record<string, string> | null>(null);
  const { confirm: ask, element: confirmEl } = useConfirm();

  React.useEffect(() => setValues(defaultOptions(tool, settingsDefaults(tool))), [tool]);

  const add = async (list: File[]) => {
    const uploaded = await uploader.upload(list);
    if (!uploaded.length) return;
    setFiles((prev) => {
      const merged = [...prev, ...uploaded];
      return tool.maxFiles === 1 ? merged.slice(-1) : merged.slice(0, tool.maxFiles);
    });
  };

  const engineMissing = tool.requires === "libreoffice" && caps && !caps.libreoffice.available;
  const singlePdf = files.length === 1 && files[0].format === "pdf" ? files[0].pages : undefined;
  const tooFew = files.length < tool.minFiles;
  const busy = state.phase === "starting" || state.phase === "running";
  const encrypted = tool.id !== "unlock" ? files.filter((f) => f.encrypted) : [];
  const scanned = ["extract-text", "pdf-to-word", "convert"].includes(tool.id) ? files.filter((f) => f.scanned) : [];
  const ocrLangs = caps?.ocr.languages.map((l) => ({ value: l.code, label: l.name }));

  const run = () => {
    const errs = validateOptions(tool, values, singlePdf, confirm);
    setErrors(errs);
    if (errs) return;
    start(tool.id, files.map((f) => f.id), values);
  };

  const clear = async () => {
    if (files.length > 1 && getSettings().confirmClear && !(await ask("Clear all files?", "Clear", "The files stay in My Files until they expire."))) return;
    setFiles([]);
    reset();
  };

  const startOver = () => {
    reset();
    setFiles([]);
    setConfirm({});
  };

  const onFiles = (fs: StoredFile[]) => {
    setFiles(fs);
    setErrors(null);
  };

  return (
    <Container>
      <ToolHeader tool={tool} />
      {confirmEl}

      {engineMissing && (
        <Notice tone="warning" title="Unavailable on this server" className="mb-5">
          {tool.name} uses LibreOffice, which isn&apos;t installed or configured here. An administrator can enable it — see the README section “LibreOffice”.
        </Notice>
      )}
      {missing > 0 && (
        <Notice tone="warning" className="mb-5" title={`${missing} file${missing > 1 ? "s have" : " has"} expired`}>
          Files are deleted automatically after the retention period. Upload them again to continue.
        </Notice>
      )}

      {state.phase === "running" || state.phase === "starting" ? (
        <Processing state={state} onCancel={cancel} />
      ) : state.phase === "done" ? (
        <Result job={state.job} onStartOver={startOver} />
      ) : state.phase === "failed" ? (
        <Failure error={state.error} onRetry={state.job ? () => retry(values.password ? { password: values.password } : undefined) : run} onEdit={reset} />
      ) : files.length === 0 ? (
        <>
          <DropZone onFiles={add} accepts={tool.ui === "editor" ? ["pdf"] : tool.accepts} multiple={tool.maxFiles > 1} uploading={uploader.uploading || loading} progress={loading ? null : uploader.progress} onCancel={uploader.cancel} />
          <UploadErrors errors={uploader.errors} onDismiss={uploader.clearErrors} />
          {tool.limitations && (
            <ul className="mt-6 space-y-1 text-sm text-ink-3">
              {tool.limitations.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section aria-label="Files" className="min-w-0 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-ink-2">
                {files.length} file{files.length === 1 ? "" : "s"}
                {tool.ordered && files.length > 1 && <span className="text-ink-3"> · drag to reorder</span>}
              </p>
              <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={clear} disabled={busy}>
                Clear all
              </Button>
            </div>
            <FileList files={files} onChange={onFiles} ordered={!!tool.ordered} disabled={busy} />
            {files.length < tool.maxFiles && (
              <DropZone
                size="sm"
                onFiles={add}
                accepts={tool.accepts}
                multiple={tool.maxFiles > 1}
                uploading={uploader.uploading}
                progress={uploader.progress}
                onCancel={uploader.cancel}
                title={tool.maxFiles === 1 ? "Replace file" : "Add more files"}
                hint={tool.maxFiles > 1 ? `Up to ${tool.maxFiles} files` : undefined}
              />
            )}
            <UploadErrors errors={uploader.errors} onDismiss={uploader.clearErrors} />
            {encrypted.length > 0 && (
              <Notice tone="warning" title="Password-protected files">
                {encrypted.map((f) => f.name).join(", ")} must be unlocked first.{" "}
                <Link className="font-medium text-accent hover:underline" href={`/tools/unlock?files=${encrypted[0].id}`}>
                  Open Unlock PDF
                </Link>
              </Notice>
            )}
            {scanned.length > 0 && (
              <Notice title="This looks like a scanned document">
                It has no text layer, so text-based results will be empty.{" "}
                <Link className="font-medium text-accent hover:underline" href={`/tools/ocr?files=${scanned.map((f) => f.id).join(",")}`}>
                  Run OCR first
                </Link>
              </Notice>
            )}
          </section>

          <aside aria-label="Options" className="lg:sticky lg:top-6 lg:self-start">
            <div className="space-y-5 rounded-[18px] bg-surface p-5 shadow-card">
              {tool.options?.length ? (
                <OptionsForm tool={tool} values={values} onChange={setValues} errors={errors} confirm={confirm} onConfirmChange={setConfirm} optionOverrides={ocrLangs?.length ? { lang: ocrLangs } : undefined} />
              ) : (
                <p className="text-sm text-ink-2">No options needed.</p>
              )}
              <Button
                variant="primary"
                size="lg"
                className="w-full"
                onClick={run}
                disabled={tooFew || !!engineMissing || encrypted.length > 0 || uploader.uploading}
              >
                {tool.action}
              </Button>
              {tooFew && <p className="text-center text-xs text-ink-3">Add at least {tool.minFiles} files.</p>}
            </div>
          </aside>
        </div>
      )}
    </Container>
  );
}

export function UploadErrors({ errors, onDismiss }: { errors: string[]; onDismiss: () => void }) {
  if (!errors.length) return null;
  return (
    <Notice tone="danger" title={errors.length === 1 ? "A file couldn't be added" : `${errors.length} files couldn't be added`} className="mt-4">
      <ul className="space-y-0.5">
        {errors.map((e, i) => (
          <li key={i}>{e}</li>
        ))}
      </ul>
      <button type="button" className="mt-1.5 text-xs font-medium text-accent hover:underline" onClick={onDismiss}>
        Dismiss
      </button>
    </Notice>
  );
}
