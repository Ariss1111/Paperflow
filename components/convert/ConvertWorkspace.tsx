"use client";
import * as React from "react";
import { ArrowRight, Check, Trash2 } from "lucide-react";
import { getTool } from "@/lib/tools/catalog";
import { CONVERSIONS, findConversion, type ConversionDef } from "@/lib/conversion/catalog";
import { FORMATS, type FormatId } from "@/lib/formats";
import { Container } from "@/components/shell/AppShell";
import { ToolHeader, UploadErrors } from "@/components/tool/ToolWorkspace";
import { DropZone } from "@/components/files/DropZone";
import { FileList } from "@/components/files/FileList";
import { useUploader } from "@/components/files/useUploader";
import { Button } from "@/components/ui/button";
import { Field, Input, Segmented, Select } from "@/components/ui/controls";
import { Badge, Notice } from "@/components/ui/feedback";
import { Processing, Result, Failure } from "@/components/tool/JobPanel";
import { useJob } from "@/components/tool/useJob";
import { useSelectedFiles } from "@/components/tool/useSelectedFiles";
import { useCapabilities } from "@/lib/client/capabilities";
import { getSettings } from "@/lib/client/settings";
import { parseRanges } from "@/lib/pdf/pages";
import { cn } from "@/lib/utils";

const tool = getTool("convert")!;

/** Targets every selected file can be converted to. */
function commonTargets(formats: FormatId[]): FormatId[] {
  if (!formats.length) return [];
  const sets = formats.map((f) => new Set(CONVERSIONS.filter((c) => c.from.includes(f)).map((c) => c.to)));
  return [...sets[0]].filter((t) => sets.every((s) => s.has(t)));
}

export function ConvertMatrix() {
  const caps = useCapabilities();
  const groups: { label: string; defs: ConversionDef[] }[] = [
    { label: "To PDF", defs: CONVERSIONS.filter((c) => c.to === "pdf") },
    { label: "From PDF", defs: CONVERSIONS.filter((c) => c.from.includes("pdf")) },
    { label: "Between images", defs: CONVERSIONS.filter((c) => c.id.startsWith("image-to-") && c.to !== "pdf") },
  ];
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {groups.map((g) => (
        <section key={g.label} className="rounded-[16px] bg-surface p-4 shadow-card">
          <h3 className="eyebrow mb-3">{g.label}</h3>
          <ul className="space-y-2">
            {g.defs.map((c) => {
              const ok = caps?.conversions.find((x) => x.id === c.id)?.available ?? true;
              return (
                <li key={c.id} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate text-ink">
                    {[...new Set(c.from.map((f) => FORMATS[f].label.replace(/ 97$/, "")))].join(", ")}
                    <ArrowRight className="mx-1.5 inline size-3 text-ink-3" aria-label="to" />
                    {FORMATS[c.to].label}
                  </span>
                  {!ok && <Badge tone="warning">Needs LibreOffice</Badge>}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function ConvertWorkspace() {
  const { files, setFiles } = useSelectedFiles();
  const uploader = useUploader(tool.accepts);
  const caps = useCapabilities();
  const { state, start, cancel, retry, reset } = useJob();
  const [to, setTo] = React.useState<FormatId | null>(null);
  const [dpi, setDpi] = React.useState(() => getSettings().imageDpi as string);
  const [pages, setPages] = React.useState("");
  const [docxMode, setDocxMode] = React.useState("flow");
  const [error, setError] = React.useState<string | null>(null);

  const formats = [...new Set(files.map((f) => f.format))];
  const targets = commonTargets(formats);
  React.useEffect(() => {
    if (to && !targets.includes(to)) setTo(null);
    if (!to && targets.length === 1) setTo(targets[0]);
  }, [targets.join(), to]); // eslint-disable-line react-hooks/exhaustive-deps

  const defs = to ? formats.map((f) => findConversion(f, to)!).filter(Boolean) : [];
  const unavailable = defs.filter((d) => caps && !caps.conversions.find((c) => c.id === d.id)?.available);
  const fromPdf = formats.length === 1 && formats[0] === "pdf";
  const rasterOut = fromPdf && to && ["jpg", "png", "webp", "tiff", "svg"].includes(to);

  const run = () => {
    if (!to) return;
    if (rasterOut && pages.trim() && files.length === 1 && files[0].pages) {
      try {
        parseRanges(pages, files[0].pages);
      } catch (e) {
        setError((e as Error).message);
        return;
      }
    }
    setError(null);
    start("convert", files.map((f) => f.id), { to, dpi: Number(dpi), pages, docxMode });
  };

  if (state.phase === "running" || state.phase === "starting")
    return (
      <Container>
        <ToolHeader tool={tool} />
        <Processing state={state} onCancel={cancel} />
      </Container>
    );
  if (state.phase === "done")
    return (
      <Container>
        <ToolHeader tool={tool} />
        <Result job={state.job} onStartOver={() => { reset(); setFiles([]); setTo(null); }} />
      </Container>
    );
  if (state.phase === "failed")
    return (
      <Container>
        <ToolHeader tool={tool} />
        <Failure error={state.error} onRetry={state.job ? () => retry() : undefined} onEdit={reset} />
      </Container>
    );

  return (
    <Container wide>
      <ToolHeader tool={tool} />
      {files.length === 0 ? (
        <div className="space-y-10">
          <div>
            <DropZone onFiles={async (l) => setFiles(await uploader.upload(l))} accepts={tool.accepts} uploading={uploader.uploading} progress={uploader.progress} onCancel={uploader.cancel} hint="PDF, Word, PowerPoint, Excel, OpenDocument, images, HTML, Markdown, CSV and text" />
            <UploadErrors errors={uploader.errors} onDismiss={uploader.clearErrors} />
          </div>
          <section>
            <h2 className="mb-3 text-lg font-semibold text-ink">Supported conversions</h2>
            <ConvertMatrix />
          </section>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="min-w-0 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-ink-2">
                {files.length} file{files.length === 1 ? "" : "s"} · {formats.map((f) => FORMATS[f].label).join(", ")}
              </p>
              <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => setFiles([])}>
                Clear all
              </Button>
            </div>
            <FileList files={files} onChange={setFiles} />
            <DropZone size="sm" title="Add more files" onFiles={async (l) => { const up = await uploader.upload(l); setFiles((p) => [...p, ...up]); }} accepts={tool.accepts} uploading={uploader.uploading} progress={uploader.progress} />
            <UploadErrors errors={uploader.errors} onDismiss={uploader.clearErrors} />
          </section>
          <aside className="lg:sticky lg:top-6 lg:self-start">
            <div className="space-y-5 rounded-[18px] bg-surface p-5 shadow-card">
              <div>
                <p className="mb-2 text-sm font-medium text-ink">Convert to</p>
                {targets.length === 0 ? (
                  <Notice tone="warning">These files have no conversion target in common. Convert them in separate batches.</Notice>
                ) : (
                  <div role="radiogroup" aria-label="Target format" className="grid grid-cols-3 gap-2">
                    {targets.map((t) => (
                      <button
                        key={t}
                        type="button"
                        role="radio"
                        aria-checked={to === t}
                        onClick={() => setTo(t)}
                        className={cn(
                          "relative flex h-14 flex-col items-center justify-center rounded-xl text-sm font-semibold transition-all duration-150",
                          to === t ? "bg-accent text-white shadow-raised" : "bg-surface-2 text-ink hover:bg-surface-3",
                        )}
                      >
                        {FORMATS[t].label}
                        <span className={cn("text-2xs font-normal uppercase", to === t ? "text-white/75" : "text-ink-3")}>.{FORMATS[t].ext}</span>
                        {to === t && <Check className="absolute right-1.5 top-1.5 size-3" aria-hidden />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {rasterOut && to !== "svg" && (
                <Field label="Resolution" htmlFor="dpi">
                  <Select id="dpi" value={dpi} onChange={(e) => setDpi(e.target.value)}>
                    <option value="72">72 dpi · screen</option>
                    <option value="150">150 dpi · standard</option>
                    <option value="300">300 dpi · print</option>
                  </Select>
                </Field>
              )}
              {rasterOut && (
                <Field label="Pages" htmlFor="pages" hint="Leave empty for all pages. Example: 1-3, 5" error={error}>
                  <Input id="pages" value={pages} onChange={(e) => setPages(e.target.value)} placeholder="All pages" />
                </Field>
              )}
              {fromPdf && to === "docx" && (
                <Field label="Layout" hint="Editable text: clean paragraphs. Exact layout: positioned text boxes and images (LibreOffice).">
                  <Segmented label="Layout" value={docxMode} onChange={setDocxMode} options={[{ value: "flow", label: "Editable text" }, { value: "layout", label: "Exact layout" }]} />
                </Field>
              )}
              {defs.map((d) => d.note).filter(Boolean).length > 0 && (
                <ul className="space-y-1.5 text-xs leading-4 text-ink-3">
                  {[...new Set(defs.map((d) => d.note))].map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
              {unavailable.length > 0 && (
                <Notice tone="warning" title="Needs LibreOffice">
                  This conversion runs on LibreOffice, which isn&apos;t configured on this server.
                </Notice>
              )}
              <Button variant="primary" size="lg" className="w-full" disabled={!to || unavailable.length > 0 || files.some((f) => f.encrypted)} onClick={run}>
                Start conversion
              </Button>
              {files.some((f) => f.encrypted) && <p className="text-center text-xs text-warning">Unlock password-protected PDFs first.</p>}
            </div>
          </aside>
        </div>
      )}
    </Container>
  );
}
