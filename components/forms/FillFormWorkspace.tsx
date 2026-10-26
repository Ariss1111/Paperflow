"use client";
import * as React from "react";
import { ClipboardX } from "lucide-react";
import type { ToolDef } from "@/lib/tools/catalog";
import type { FormFieldInfo } from "@/lib/pdf/ops";
import { Container } from "@/components/shell/AppShell";
import { ToolHeader, UploadErrors } from "@/components/tool/ToolWorkspace";
import { DropZone } from "@/components/files/DropZone";
import { FileList } from "@/components/files/FileList";
import { useUploader } from "@/components/files/useUploader";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/controls";
import { Notice, EmptyState } from "@/components/ui/feedback";
import { Processing, Result, Failure } from "@/components/tool/JobPanel";
import { useJob } from "@/components/tool/useJob";
import { useSelectedFiles } from "@/components/tool/useSelectedFiles";
import { api } from "@/lib/client/api";

type Values = Record<string, string | boolean | string[]>;

export function FillFormWorkspace({ tool }: { tool: ToolDef }) {
  const { files, setFiles } = useSelectedFiles();
  const uploader = useUploader(["pdf"]);
  const { state, start, cancel, retry, reset } = useJob();
  const [fields, setFields] = React.useState<FormFieldInfo[] | null>(null);
  const [xfa, setXfa] = React.useState(false);
  const [values, setValues] = React.useState<Values>({});
  const [flatten, setFlatten] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const file = files[0];

  React.useEffect(() => {
    if (!file || file.encrypted) return;
    setFields(null);
    setLoadError(null);
    api
      .form(file.id)
      .then((r) => {
        setFields(r.fields);
        setXfa(r.xfa);
        setValues(Object.fromEntries(r.fields.filter((f) => !["button", "signature", "unknown"].includes(f.type)).map((f) => [f.name, f.value])));
      })
      .catch((e) => setLoadError((e as Error).message));
  }, [file]);

  const editable = (fields ?? []).filter((f) => !["button", "signature", "unknown"].includes(f.type));
  const set = (k: string, v: string | boolean | string[]) => setValues((p) => ({ ...p, [k]: v }));

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
        <Result job={state.job} onStartOver={() => { reset(); setFiles([]); setFields(null); }} />
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
    <Container>
      <ToolHeader tool={tool} />
      {!file ? (
        <>
          <DropZone multiple={false} accepts={["pdf"]} onFiles={async (l) => setFiles((await uploader.upload(l)).slice(0, 1))} uploading={uploader.uploading} progress={uploader.progress} onCancel={uploader.cancel} />
          <UploadErrors errors={uploader.errors} onDismiss={uploader.clearErrors} />
        </>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <section className="min-w-0 space-y-4">
            <FileList files={files} onChange={(f) => { setFiles(f); setFields(null); }} />
            {file.encrypted && <Notice tone="warning" title="Password-protected">Unlock this PDF first with Unlock PDF.</Notice>}
            {loadError && <Notice tone="danger" title="Couldn't read the form">{loadError}</Notice>}
            {xfa && (
              <Notice tone="warning" title="XFA form detected">
                This PDF uses an XFA (LiveCycle) form. Only its AcroForm fallback fields can be filled; dynamic XFA content isn&apos;t supported.
              </Notice>
            )}
            {fields && editable.length === 0 && (
              <div className="rounded-[18px] bg-surface shadow-card">
                <EmptyState icon={<ClipboardX className="size-5" />} title="No fillable fields">
                  This PDF has no interactive form fields. To write on it anyway, use the PDF Editor to add text boxes.
                </EmptyState>
              </div>
            )}
            {editable.length > 0 && (
              <div className="space-y-5 rounded-[18px] bg-surface p-5 shadow-card">
                {editable.map((f) => {
                  const id = `f-${f.name}`;
                  const label = (
                    <>
                      {f.name}
                      {f.required && <span className="text-danger"> *</span>}
                      {f.readOnly && <span className="ml-1 text-xs font-normal text-ink-3">(read-only)</span>}
                    </>
                  );
                  switch (f.type) {
                    case "text":
                      return (
                        <Field key={f.name} label={label} htmlFor={id}>
                          {f.multiline ? (
                            <Textarea id={id} value={String(values[f.name] ?? "")} maxLength={f.maxLength} disabled={f.readOnly} onChange={(e) => set(f.name, e.target.value)} />
                          ) : (
                            <Input id={id} value={String(values[f.name] ?? "")} maxLength={f.maxLength} disabled={f.readOnly} onChange={(e) => set(f.name, e.target.value)} />
                          )}
                        </Field>
                      );
                    case "checkbox":
                      return (
                        <div key={f.name} className="flex items-center justify-between">
                          <label htmlFor={id} className="text-sm font-medium text-ink">
                            {label}
                          </label>
                          <Switch id={id} checked={!!values[f.name]} onCheckedChange={(v) => set(f.name, v)} />
                        </div>
                      );
                    case "radio":
                    case "dropdown":
                      return (
                        <Field key={f.name} label={label} htmlFor={id}>
                          <Select id={id} value={String(values[f.name] ?? "")} disabled={f.readOnly} onChange={(e) => set(f.name, e.target.value)}>
                            <option value="">—</option>
                            {f.options?.map((o) => (
                              <option key={o} value={o}>
                                {o}
                              </option>
                            ))}
                          </Select>
                        </Field>
                      );
                    case "optionlist":
                      return (
                        <Field key={f.name} label={label} htmlFor={id} hint="Hold ⌘/Ctrl to select several.">
                          <select
                            id={id}
                            multiple
                            value={(values[f.name] as string[]) ?? []}
                            onChange={(e) => set(f.name, Array.from(e.target.selectedOptions).map((o) => o.value))}
                            className="w-full rounded-lg bg-surface p-1.5 text-sm shadow-[inset_0_0_0_0.5px_rgb(var(--line)/0.16)]"
                          >
                            {f.options?.map((o) => (
                              <option key={o}>{o}</option>
                            ))}
                          </select>
                        </Field>
                      );
                  }
                })}
              </div>
            )}
          </section>
          <aside className="lg:sticky lg:top-6 lg:self-start">
            <div className="space-y-5 rounded-[18px] bg-surface p-5 shadow-card">
              <div className="flex items-start justify-between gap-4">
                <label htmlFor="flatten" className="text-sm text-ink">
                  Flatten after filling
                  <span className="mt-0.5 block text-xs text-ink-3">Values become part of the page and can no longer be changed.</span>
                </label>
                <Switch id="flatten" checked={flatten} onCheckedChange={setFlatten} />
              </div>
              <Button variant="primary" size="lg" className="w-full" disabled={!editable.length || file.encrypted} onClick={() => start(tool.id, [file.id], { values, flatten })}>
                {tool.action}
              </Button>
            </div>
          </aside>
        </div>
      )}
    </Container>
  );
}
