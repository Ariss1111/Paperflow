"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight, Search, ShieldCheck, Timer, HardDrive, EyeOff, Type, Highlighter, Signature, Image as ImageIcon, Shapes, Layers,
  ChevronDown,
} from "lucide-react";
import { APP_NAME, APP_TAGLINE, APP_DESCRIPTION } from "@/lib/brand";
import { TOOLS, CATEGORIES, toolHref } from "@/lib/tools/catalog";
import { FORMATS, UPLOADABLE, type FormatId } from "@/lib/formats";
import { ToolCard } from "@/components/tool/ToolCard";
import { ToolGlyph } from "@/components/ToolIcon";
import { DropZone } from "@/components/files/DropZone";
import { FileThumb } from "@/components/files/Thumb";
import { useUploader } from "@/components/files/useUploader";
import { UploadErrors } from "@/components/tool/ToolWorkspace";
import { ConvertMatrix } from "@/components/convert/ConvertWorkspace";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/feedback";
import { HeroPreview } from "./HeroPreview";
import { api } from "@/lib/client/api";
import { useCapabilities } from "@/lib/client/capabilities";
import { formatBytes, formatRelative, cn } from "@/lib/utils";
import type { Job, StoredFile } from "@/types";

const QUICK = ["merge", "convert", "edit", "compress", "sign"];

function Section({ id, eyebrow, title, subtitle, children, className }: { id?: string; eyebrow?: string; title: string; subtitle?: string; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className={cn("scroll-mt-16 py-14 sm:py-20", className)}>
      <div className="mb-8 max-w-2xl">
        {eyebrow && <p className="eyebrow mb-2 !text-accent">{eyebrow}</p>}
        <h2 id={id ? `${id}-title` : undefined} className="text-2xl font-semibold tracking-[-0.022em] text-ink sm:text-[32px] sm:leading-10">
          {title}
        </h2>
        {subtitle && <p className="mt-2 text-base text-ink-2 sm:text-lg">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function Suggestions({ files, onClear }: { files: StoredFile[]; onClear: () => void }) {
  const formats = [...new Set(files.map((f) => f.format))];
  const fits = TOOLS.filter((t) => formats.every((f) => t.accepts.includes(f)) && files.length <= t.maxFiles);
  const q = `?files=${files.map((f) => f.id).join(",")}`;
  return (
    <div className="animate-rise-in rounded-[18px] bg-surface p-5 shadow-card sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex -space-x-3">
          {files.slice(0, 4).map((f) => (
            <FileThumb key={f.id} file={f} width={34} className="ring-2 ring-surface" />
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">
            {files.length === 1 ? files[0].name : `${files.length} files ready`}
          </p>
          <p className="text-sm text-ink-2">
            {formats.map((f) => FORMATS[f].label).join(", ")} · {formatBytes(files.reduce((s, f) => s + f.size, 0))}
            {files.length === 1 && files[0].pages ? ` · ${files[0].pages} pages` : ""}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClear}>
          Clear
        </Button>
      </div>
      <p className="mb-2 mt-5 text-sm font-medium text-ink-2">What would you like to do?</p>
      {fits.length === 0 ? (
        <p className="text-sm text-ink-3">No single tool accepts this mix of files. Try fewer or similar files.</p>
      ) : (
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
          {fits.slice(0, 12).map((t) => (
            <ToolCard key={t.id} tool={t} query={q} compact />
          ))}
        </div>
      )}
    </div>
  );
}

function Recent() {
  const [jobs, setJobs] = React.useState<Job[] | null>(null);
  React.useEffect(() => {
    api.listJobs().then((r) => setJobs(r.jobs.slice(0, 6))).catch(() => setJobs([]));
  }, []);
  if (!jobs?.length) return null;
  return (
    <section aria-labelledby="recent-title" className="mt-10">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="recent-title" className="text-lg font-semibold text-ink">
          Recently processed
        </h2>
        <Link href="/files" className="text-sm font-medium text-accent hover:underline">
          View all
        </Link>
      </div>
      <ul className="divide-y overflow-hidden rounded-[16px] bg-surface shadow-card">
        {jobs.map((j) => {
          const t = TOOLS.find((x) => x.id === j.tool);
          return (
            <li key={j.id} className="flex items-center gap-3 px-4 py-3">
              {t && <ToolGlyph icon={t.icon} category={t.category} size="sm" />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{j.outputs[0]?.name ?? j.inputs.map((i) => i.name).join(", ")}</p>
                <p className="text-xs text-ink-3">
                  {j.toolName} · {formatRelative(j.createdAt)}
                </p>
              </div>
              {j.status === "completed" ? (
                <a href={j.outputs.length > 1 ? api.downloadAllUrl(j.id) : api.downloadUrl(j.id, 0)} className="text-sm font-medium text-accent hover:underline" download>
                  Download
                </a>
              ) : (
                <Badge tone={j.status === "failed" ? "danger" : j.status === "processing" || j.status === "queued" ? "accent" : "neutral"}>{j.status}</Badge>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const FAQ: [string, string][] = [
  ["Do I need an account?", `No. ${APP_NAME} works immediately. Your files are tied to an anonymous browser session and deleted automatically.`],
  ["How long are my files kept?", "Uploads and results are deleted automatically after the retention period configured on this server (shown in Settings). You can delete them sooner from My Files."],
  ["Can I edit the existing text in a PDF?", "Yes, by replacing it: the editor genuinely removes the original text from the page (redaction) and places new text in its spot. PDFs don't store paragraphs like a Word file, so the new text uses a substitute font and won't reflow surrounding lines. Scanned pages need OCR first."],
  ["Is a drawn signature legally binding?", "The Sign tool places a visual signature on the page. It is not a cryptographic digital signature (PAdES / certificate-based), and Paperflow doesn't claim it is. Whether a visual signature is sufficient depends on your jurisdiction and use case."],
  ["Which Office formats are supported?", "Word (DOCX, DOC), PowerPoint (PPTX, PPT), Excel (XLSX, XLS), OpenDocument (ODT, ODS, ODP) and RTF convert to PDF using LibreOffice on the server. If LibreOffice isn't configured, those conversions are clearly marked unavailable."],
  ["What does compression actually do?", "It re-encodes large embedded images at a lower resolution, deduplicates objects and compresses streams. You always see the exact before and after sizes. If a file can't be made smaller, you get the original back and we tell you."],
];

export function HomePage() {
  const router = useRouter();
  const uploader = useUploader();
  const caps = useCapabilities();
  const [files, setFiles] = React.useState<StoredFile[]>([]);
  const [q, setQ] = React.useState("");
  const popular = TOOLS.filter((t) => t.popular);
  const searchResults = q.trim() ? TOOLS.filter((t) => `${t.name} ${t.tagline}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 6) : [];

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 sm:px-8">
      {/* ---------------------------------------------------------------- hero */}
      <section className="grid items-center gap-12 pb-12 pt-12 sm:pt-16 lg:grid-cols-[1.05fr_1fr] lg:pb-16 lg:pt-20">
        <div className="animate-rise-in">
          <h1 className="text-[40px] font-semibold leading-[1.05] tracking-[-0.035em] text-ink sm:text-5xl lg:text-[58px]">{APP_TAGLINE}</h1>
          <p className="mt-5 max-w-lg text-lg text-ink-2 sm:text-xl sm:leading-8">{APP_DESCRIPTION}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button variant="primary" size="lg" onClick={() => document.getElementById("start")?.scrollIntoView({ behavior: "smooth", block: "center" })}>
              Open PDF Tools
            </Button>
            <Button size="lg" onClick={() => router.push("/tools")} icon={<ArrowRight className="size-4" />} className="flex-row-reverse">
              Explore All Tools
            </Button>
          </div>
          <p className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-3">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="size-4" aria-hidden /> No account needed
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Timer className="size-4" aria-hidden /> Auto-deleted after {caps?.limits.retentionMinutes ?? 60} min
            </span>
          </p>
        </div>
        <div className="hidden pb-6 sm:block">
          <HeroPreview />
        </div>
      </section>

      {/* ---------------------------------------------------------------- dashboard */}
      <section id="start" aria-label="Start working" className="scroll-mt-20">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && searchResults[0] && router.push(toolHref(searchResults[0]))}
              placeholder="Search tools — compress, sign, PowerPoint to PDF…"
              aria-label="Search tools"
              className="h-11 w-full rounded-xl bg-surface pl-10 pr-4 text-base text-ink shadow-card placeholder:text-ink-3 focus:outline-none focus:ring-[3px] focus:ring-accent/25"
            />
            {searchResults.length > 0 && (
              <div className="glass absolute inset-x-0 top-12 z-20 animate-rise-in rounded-xl p-1.5 shadow-overlay">
                {searchResults.map((t) => (
                  <ToolCard key={t.id} tool={t} compact />
                ))}
              </div>
            )}
          </div>
          <div className="scroll-thin -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            {QUICK.map((id) => {
              const t = TOOLS.find((x) => x.id === id)!;
              return (
                <Link key={id} href={toolHref(t)} className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl bg-surface pl-2 pr-3.5 text-sm font-medium text-ink shadow-card transition-shadow hover:shadow-raised">
                  <ToolGlyph icon={t.icon} category={t.category} size="sm" />
                  {t.name.replace(" PDF", "").replace("PDF ", "")}
                </Link>
              );
            })}
          </div>
        </div>
        {files.length ? (
          <Suggestions files={files} onClear={() => setFiles([])} />
        ) : (
          <DropZone onFiles={async (l) => setFiles(await uploader.upload(l))} accepts={UPLOADABLE} uploading={uploader.uploading} progress={uploader.progress} onCancel={uploader.cancel} title="Drop files to get started" hint="We'll suggest tools that fit — PDF, Office, images, HTML, Markdown, CSV and text" />
        )}
        <UploadErrors errors={uploader.errors} onDismiss={uploader.clearErrors} />
        <Recent />
      </section>

      {/* ---------------------------------------------------------------- popular */}
      <Section id="popular" eyebrow="Popular" title="The tools people reach for most" subtitle="Each one performs a real operation on your file and gives you the result to download.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {popular.map((t) => (
            <ToolCard key={t.id} tool={t} />
          ))}
        </div>
        <div className="mt-10 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {CATEGORIES.map((c) => {
            const list = TOOLS.filter((t) => t.category === c.id);
            return (
              <Link key={c.id} href="/tools" className="rounded-[14px] p-3 transition-colors hover:bg-ink/[0.04]">
                <ToolGlyph icon={list[0].icon} category={c.id} size="sm" />
                <p className="mt-2 text-sm font-semibold text-ink">{c.label}</p>
                <p className="text-xs text-ink-3">{list.length} tools</p>
              </Link>
            );
          })}
        </div>
      </Section>

      {/* ---------------------------------------------------------------- formats */}
      <Section id="formats" eyebrow="Convert" title="Formats in, formats out" subtitle="Office documents are rendered by LibreOffice; PDF pages by MuPDF; images by libvips. Only conversions that pass end-to-end tests are listed.">
        <ConvertMatrix />
      </Section>

      {/* ---------------------------------------------------------------- editor showcase */}
      <Section id="editor" eyebrow="PDF Editor" title="An editor that tells you what it changes" subtitle="Every object in the editor is labelled: overlays sit on top of the page, annotations stay editable in other viewers, and content edits genuinely remove what was there.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            [Type, "Text & replace", "Add text boxes, or click existing text to remove it and type a replacement in its place."],
            [Highlighter, "Markup", "Highlight, underline and strike through text as real PDF annotations, plus sticky-note comments."],
            [Signature, "Signatures", "Draw with mouse, trackpad or stylus, type it, or upload an image — then position, resize and rotate."],
            [ImageIcon, "Images", "Drop in logos, stamps and photos. Resize with handles; images keep their aspect ratio."],
            [Shapes, "Shapes & ink", "Rectangles, ellipses, lines, arrows and freehand drawing with color, width and opacity."],
            [Layers, "Pages", "Rotate, reorder, duplicate and delete pages from the thumbnail rail. Undo and redo everything."],
          ].map(([I, title, body]) => {
            const Ico = I as typeof Type;
            return (
              <div key={title as string} className="rounded-[16px] bg-surface p-5 shadow-card">
                <Ico className="size-5 text-accent" strokeWidth={1.75} aria-hidden />
                <p className="mt-3 font-semibold text-ink">{title as string}</p>
                <p className="mt-1 text-sm text-ink-2">{body as string}</p>
              </div>
            );
          })}
        </div>
        <div className="mt-6">
          <Button variant="primary" onClick={() => router.push("/editor")}>
            Open the editor
          </Button>
        </div>
      </Section>

      {/* ---------------------------------------------------------------- privacy */}
      <Section id="privacy" eyebrow="Privacy & security" title="Your documents are treated as sensitive" subtitle="Precise about what happens to your files — no vague promises.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            [HardDrive, "Processed on this server", "Files are uploaded over your connection to this server, processed in an isolated job folder, and never sent to third parties."],
            [Timer, "Deleted automatically", `Uploads and results are deleted after ${caps?.limits.retentionMinutes ?? 60} minutes, or immediately when you remove them.`],
            [ShieldCheck, "Only your session", "Files and downloads are bound to your anonymous browser session. Links don't work from another browser."],
            [EyeOff, "Nothing in the logs", "Document contents and passwords are never written to logs. Passwords are discarded once a job finishes."],
          ].map(([I, title, body]) => {
            const Ico = I as typeof Timer;
            return (
              <div key={title as string} className="rounded-[16px] bg-surface p-5 shadow-card">
                <Ico className="size-5 text-success" strokeWidth={1.75} aria-hidden />
                <p className="mt-3 font-semibold text-ink">{title as string}</p>
                <p className="mt-1 text-sm text-ink-2">{body as string}</p>
              </div>
            );
          })}
        </div>
        <p className="mt-5 text-sm text-ink-3">
          {APP_NAME} does not claim end-to-end encryption or zero-knowledge processing: the server must read a file to transform it.{" "}
          <Link href="/privacy" className="font-medium text-accent hover:underline">
            Read the full privacy details
          </Link>
        </p>
      </Section>

      {/* ---------------------------------------------------------------- supported formats */}
      <Section id="supported" eyebrow="Supported files" title="What you can upload">
        <div className="flex flex-wrap gap-2">
          {UPLOADABLE.map((f: FormatId) => (
            <span key={f} className="inline-flex h-8 items-center gap-2 rounded-lg bg-surface px-3 text-sm text-ink shadow-card">
              <span className="font-mono text-xs uppercase text-ink-3">.{FORMATS[f].ext}</span>
              {FORMATS[f].label}
            </span>
          ))}
        </div>
        <p className="mt-4 text-sm text-ink-3">
          Files are identified by their content, not just their extension. Maximum size per file: {caps ? formatBytes(caps.limits.maxUploadBytes, 0) : "—"}.
        </p>
      </Section>

      {/* ---------------------------------------------------------------- FAQ */}
      <Section id="faq" eyebrow="FAQ" title="Questions, answered plainly">
        <div className="divide-y overflow-hidden rounded-[16px] bg-surface shadow-card">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group px-5 py-4 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-ink">
                {q}
                <ChevronDown className="size-4 shrink-0 text-ink-3 transition-transform duration-200 group-open:rotate-180" aria-hidden />
              </summary>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-2">{a}</p>
            </details>
          ))}
        </div>
      </Section>

      <footer className="flex flex-col gap-4 border-t py-10 text-sm text-ink-3 sm:flex-row sm:items-center sm:justify-between">
        <p>
          © {new Date().getFullYear()} {APP_NAME}. Built for precise document work.
        </p>
        <nav aria-label="Footer" className="flex gap-5">
          <Link href="/privacy" className="hover:text-ink">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-ink">
            Terms
          </Link>
          <Link href="/terms#contact" className="hover:text-ink">
            Contact
          </Link>
        </nav>
      </footer>
    </div>
  );
}
