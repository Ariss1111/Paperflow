"use client";
import * as React from "react";
import { Sun, Moon, Monitor, CheckCircle2, AlertTriangle } from "lucide-react";
import { Container, PageHeader } from "@/components/shell/AppShell";
import { Segmented, Select, Switch } from "@/components/ui/controls";
import { useSettings, setSettings } from "@/lib/client/settings";
import { useCapabilities } from "@/lib/client/capabilities";
import { formatBytes } from "@/lib/utils";

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="eyebrow mb-2 px-1">{title}</h2>
      <div className="divide-y overflow-hidden rounded-[14px] bg-surface shadow-card">{children}</div>
    </section>
  );
}

function Row({ label, hint, children, htmlFor }: { label: string; hint?: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
      <label htmlFor={htmlFor} className="min-w-0">
        <span className="block text-sm font-medium text-ink">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-ink-3">{hint}</span>}
      </label>
      <div className="shrink-0 sm:w-64">{children}</div>
    </div>
  );
}

function Status({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm ${ok ? "text-success" : "text-warning"}`}>
      {ok ? <CheckCircle2 className="size-4" /> : <AlertTriangle className="size-4" />}
      <span className="text-ink">{children}</span>
    </span>
  );
}

export function SettingsPage() {
  const s = useSettings();
  const caps = useCapabilities();
  return (
    <Container className="max-w-[760px]">
      <PageHeader title="Settings" subtitle="Preferences are saved in this browser only." />
      <Group title="Appearance">
        <Row label="Theme">
          <Segmented
            label="Theme"
            value={s.theme}
            onChange={(theme) => setSettings({ theme })}
            options={[
              { value: "system", label: <span className="inline-flex items-center gap-1.5"><Monitor className="size-3.5" /> Auto</span> },
              { value: "light", label: <span className="inline-flex items-center gap-1.5"><Sun className="size-3.5" /> Light</span> },
              { value: "dark", label: <span className="inline-flex items-center gap-1.5"><Moon className="size-3.5" /> Dark</span> },
            ]}
          />
        </Row>
      </Group>
      <Group title="Defaults">
        <Row label="Compression level" hint="Used when you open Compress PDF.">
          <Segmented label="Compression level" value={s.compression} onChange={(compression) => setSettings({ compression })} options={[{ value: "low", label: "Low" }, { value: "medium", label: "Recommended" }, { value: "high", label: "Strong" }]} />
        </Row>
        <Row label="Image resolution" hint="Default for PDF → image conversions." htmlFor="dpi">
          <Select id="dpi" value={s.imageDpi} onChange={(e) => setSettings({ imageDpi: e.target.value as "72" | "150" | "300" })}>
            <option value="72">72 dpi · screen</option>
            <option value="150">150 dpi · standard</option>
            <option value="300">300 dpi · print</option>
          </Select>
        </Row>
        <Row label="OCR language" hint="Languages installed on this server." htmlFor="ocr">
          <Select id="ocr" value={s.ocrLang} onChange={(e) => setSettings({ ocrLang: e.target.value })}>
            {(caps?.ocr.languages ?? [{ code: "eng", name: "English" }]).map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </Select>
        </Row>
        <Row label="Confirm before clearing files" htmlFor="confirm">
          <div className="flex sm:justify-end">
            <Switch id="confirm" checked={s.confirmClear} onCheckedChange={(confirmClear) => setSettings({ confirmClear })} />
          </div>
        </Row>
      </Group>
      <Group title="This server">
        <Row label="Office conversion engine" hint="Needed for Word, PowerPoint, Excel, OpenDocument, RTF, HTML, Markdown, CSV and text → PDF.">
          {caps ? <Status ok={caps.libreoffice.available}>{caps.libreoffice.available ? `LibreOffice ${caps.libreoffice.version ?? ""}` : "Not configured"}</Status> : "…"}
        </Row>
        <Row label="OCR languages">{caps ? <Status ok={caps.ocr.languages.length > 0}>{caps.ocr.languages.map((l) => l.name).join(", ") || "None"}</Status> : "…"}</Row>
        <Row label="Malware scanning" hint="ClamAV, when configured by the administrator.">
          {caps ? <Status ok={caps.malwareScanning}>{caps.malwareScanning ? "Enabled" : "Not configured"}</Status> : "…"}
        </Row>
        <Row label="File retention">{caps ? <span className="text-sm text-ink">{caps.limits.retentionMinutes} minutes</span> : "…"}</Row>
        <Row label="Upload limit">{caps ? <span className="text-sm text-ink">{formatBytes(caps.limits.maxUploadBytes, 0)} per file, {caps.limits.maxFilesPerRequest} files at once</span> : "…"}</Row>
      </Group>
    </Container>
  );
}
