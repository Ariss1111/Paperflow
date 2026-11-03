"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Search, ShieldCheck, Timer, HardDrive, EyeOff, Zap, UserX, Sparkles, ChevronDown, FileText, Clock } from "lucide-react";
import { APP_NAME, APP_TAGLINE, APP_HEADLINE, APP_DESCRIPTION } from "@/lib/brand";
import { TOOLS, CATEGORIES, toolHref, type ToolCategory } from "@/lib/tools/catalog";
import { UPLOADABLE } from "@/lib/formats";
import { ToolCard } from "@/components/tool/ToolCard";
import { ToolGlyph } from "@/components/ToolIcon";
import { DropZone } from "@/components/files/DropZone";
import { FileThumb } from "@/components/files/Thumb";
import { useUploader } from "@/components/files/useUploader";
import { UploadErrors } from "@/components/tool/ToolWorkspace";
import { Segmented } from "@/components/ui/controls";
import { Badge } from "@/components/ui/feedback";
import { Mark } from "@/components/brand/Logo";
import { PricingPlans } from "./Pricing";
import { api } from "@/lib/client/api";
import { useCapabilities } from "@/lib/client/capabilities";
import { formatBytes, formatRelative, cn, withQuery } from "@/lib/utils";
import { FORMATS } from "@/lib/formats";
import type { Job, StoredFile } from "@/types";

const QUICK = ["scan", "edit", "merge", "compress", "word-to-pdf", "sign"];
const DROPPED_KEY = "pf-home-dropped";

function Section({ id, eyebrow, title, subtitle, children, className, action }: { id: string; eyebrow?: string; title: string; subtitle?: string; children: React.ReactNode; className?: string; action?: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn("scroll-mt-20 py-14 sm:py-20", className)}>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          {eyebrow && <p className="eyebrow mb-2 !text-accent">{eyebrow}</p>}
          <h2 id={`${id}-title`} className="text-[26px] font-semibold leading-8 tracking-[-0.024em] text-ink sm:text-[34px] sm:leading-[42px]">
            {title}
          </h2>
          {subtitle && <p className="mt-2 text-base text-ink-2 sm:text-lg">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** After a drop: the tools that accept these files, each opening with the files already loaded. */
function Suggestions({ files, onClear }: { files: StoredFile[]; onClear: () => void }) {
  const formats = [...new Set(files.map((f) => f.format))];
  const [all, setAll] = React.useState(false);
  // popular tools first, then AI, then everything else that accepts these files
  const rank = (t: (typeof TOOLS)[number]) => (t.popular ? 0 : t.category === "ai" ? 1 : 2);
  const fits = TOOLS.filter((t) => formats.every((f) => t.accepts.includes(f)) && files.length <= t.maxFiles).sort((a, b) => rank(a) - rank(b));
  const shown = all ? fits : fits.slice(0, 12);
  const q = `files=${files.map((f) => f.id).join(",")}`;
  return (
    <div data-testid="suggestions" className="animate-rise-in rounded-[22px] bg-surface p-5 text-left shadow-raised sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex -space-x-3">
          {files.slice(0, 4).map((f) => (
            <FileThumb key={f.id} file={f} width={34} className="ring-2 ring-surface" />
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-ink">{files.length === 1 ? files[0].name : `${files.length} files ready`}</p>
          <p className="text-sm text-ink-2">
            {formats.map((f) => FORMATS[f].label).join(", ")} · {formatBytes(files.reduce((s, f) => s + f.size, 0))}
            {files.length === 1 && files[0].pages ? ` · ${files[0].pages} pages` : ""}
          </p>
        </div>
        <button type="button" onClick={onClear} className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-ink-2 hover:bg-ink/[0.05]">
          Clear
        </button>
      </div>
      <p className="mb-2 mt-5 text-sm font-medium text-ink-2">What would you like to do?</p>
      {fits.length === 0 ? (
        <p className="text-sm text-ink-3">No single tool accepts this mix of files. Try fewer or similar files.</p>
      ) : (
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((t) => (
            <ToolCard key={t.id} tool={t} query={q} compact />
          ))}
        </div>
      )}
      {fits.length > shown.length && (
        <button type="button" onClick={() => setAll(true)} className="mt-2 text-sm font-medium text-accent hover:underline">
          Show all {fits.length} tools
        </button>
      )}
    </div>
  );
}

function RecentDocuments() {
  const [files, setFiles] = React.useState<StoredFile[] | null>(null);
  const [jobs, setJobs] = React.useState<Job[]>([]);
  React.useEffect(() => {
    api.listFiles().then((r) => setFiles(r.files.slice(0, 6))).catch(() => setFiles([]));
    api.listJobs().then((r) => setJobs(r.jobs.filter((j) => j.status === "completed").slice(0, 4))).catch(() => undefined);
  }, []);
  if (!files?.length && !jobs.length) return null;
  return (
    <Section id="recent" eyebrow="Pick up where you left off" title="Recently opened documents" className="!pb-4" action={<Link href="/files" className="text-sm font-medium text-accent hover:underline">My Documents</Link>}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {files?.map((f) => {
          const open = f.format === "pdf" ? "/editor" : TOOLS.find((t) => t.accepts.includes(f.format)) ? toolHref(TOOLS.find((t) => t.accepts.includes(f.format))!) : "/files";
          return (
            <Link key={f.id} href={withQuery(open, `files=${f.id}`)} className="group flex items-center gap-3.5 rounded-[16px] bg-surface p-3.5 shadow-card transition-all duration-200 hover:-translate-y-px hover:shadow-raised">
              <FileThumb file={f} width={40} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink" title={f.name}>
                  {f.name}
                </p>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-ink-3">
                  <Clock className="size-3" aria-hidden /> {formatRelative(f.createdAt)} · {FORMATS[f.format].label}
                </p>
              </div>
              <span className="text-xs font-medium text-accent opacity-0 transition-opacity group-hover:opacity-100">Open</span>
            </Link>
          );
        })}
        {jobs.map((j) => (
          <a key={j.id} href={j.outputs.length > 1 ? api.downloadAllUrl(j.id) : api.downloadUrl(j.id, 0)} download className="flex items-center gap-3.5 rounded-[16px] bg-surface p-3.5 shadow-card transition-all duration-200 hover:-translate-y-px hover:shadow-raised">
            <span className="flex size-10 items-center justify-center rounded-lg bg-success/[0.1] text-success">
              <FileText className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{j.outputs[0]?.name}</p>
              <p className="mt-0.5 text-xs text-ink-3">
                {j.toolName} · {formatRelative(j.finishedAt ?? j.createdAt)}
              </p>
            </div>
            <span className="text-xs font-medium text-accent">Download</span>
          </a>
        ))}
      </div>
    </Section>
  );
}

function AllToolsSection() {
  const [cat, setCat] = React.useState<ToolCategory>("organize");
  const list = TOOLS.filter((t) => t.category === cat);
  return (
    <Section id="all-tools" eyebrow="All tools" title="Every tool, organized" subtitle={`${TOOLS.length} tools across ${CATEGORIES.length} categories.`} action={<Link href="/tools" className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">Browse all <ArrowRight className="size-3.5" /></Link>}>
      <div className="scroll-thin -mx-4 mb-5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <Segmented label="Tool category" value={cat} onChange={setCat} className="w-auto min-w-max" options={CATEGORIES.map((c) => ({ value: c.id, label: c.label }))} />
      </div>
      <p className="mb-4 text-sm text-ink-3">{CATEGORIES.find((c) => c.id === cat)!.blurb}</p>
      <div key={cat} className="grid animate-rise-in grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {list.map((t) => (
          <ToolCard key={t.id} tool={t} />
        ))}
      </div>
    </Section>
  );
}

const FAQ: [string, string][] = [
  ["Do I need an account?", `No. ${APP_NAME} works immediately. Your files are tied to an anonymous browser session and deleted automatically.`],
  ["How long are my files kept?", "Uploads and results are deleted automatically after the retention period shown in Settings. You can delete them sooner from My Documents."],
  ["Can I edit the existing text in a PDF?", "Yes. The editor genuinely removes the original text and places your replacement in its spot. The new text uses a substitute font and won't reflow surrounding lines. Scanned pages need OCR first."],
  ["What happens to documents I use with AI tools?", "They're sent to Anthropic's Claude API to produce the answer, and only when you run an AI tool. Every other tool processes files on this server or in your browser."],
  ["Is a drawn signature legally binding?", "Sign PDF places a visual signature. It isn't a certificate-based digital signature. Whether a visual signature is enough depends on your jurisdiction and use case."],
];

export function HomePage() {
  const router = useRouter();
  const uploader = useUploader();
  const caps = useCapabilities();
  const [files, setFiles] = React.useState<StoredFile[]>([]);
  const [q, setQ] = React.useState("");
  const [active, setActive] = React.useState(0);
  const popular = TOOLS.filter((t) => t.popular).slice(0, 8);
  const aiTools = TOOLS.filter((t) => t.category === "ai");
  const s = q.trim().toLowerCase();
  const results = s ? TOOLS.filter((t) => `${t.name} ${t.tagline} ${CATEGORIES.find((c) => c.id === t.category)?.label}`.toLowerCase().includes(s)).slice(0, 7) : [];

  // dropped files survive going into a tool and coming back
  React.useEffect(() => {
    try {
      const ids: string[] = JSON.parse(sessionStorage.getItem(DROPPED_KEY) || "[]");
      if (ids.length) Promise.all(ids.map((id) => api.getFile(id).then((r) => r.file).catch(() => null))).then((fs) => setFiles(fs.filter((f): f is StoredFile => !!f)));
    } catch {
      /* storage unavailable */
    }
  }, []);
  const keep = (list: StoredFile[]) => {
    setFiles(list);
    try {
      sessionStorage.setItem(DROPPED_KEY, JSON.stringify(list.map((f) => f.id)));
    } catch {
      /* storage unavailable */
    }
  };

  return (
    <div>
      {/* ---------------------------------------------------------------- hero */}
      <section className="relative overflow-hidden border-b bg-gradient-to-b from-accent/[0.06] via-canvas to-canvas">
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-[-280px] h-[520px] w-[920px] -translate-x-1/2 rounded-full bg-accent/[0.08] blur-3xl" />
        <div className="relative mx-auto max-w-[920px] px-4 pb-14 pt-14 text-center sm:px-8 sm:pb-20 sm:pt-20">
          <p className="mx-auto mb-5 inline-flex animate-rise-in items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-sm font-medium text-ink-2 shadow-card">
            <Mark className="size-4" /> {APP_TAGLINE}
          </p>
          <h1 className="animate-rise-in text-[38px] font-semibold leading-[1.06] tracking-[-0.035em] text-ink sm:text-[56px] lg:text-[64px]">{APP_HEADLINE}</h1>
          <p className="mx-auto mt-5 max-w-xl animate-rise-in text-lg text-ink-2 sm:text-xl sm:leading-8">{APP_DESCRIPTION}</p>

          {/* search */}
          <div className="relative mx-auto mt-9 max-w-xl text-left">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-ink-3" aria-hidden />
            <input
              type="search"
              role="combobox"
              aria-expanded={results.length > 0}
              aria-controls="home-search-results"
              aria-label="Search PDF tools"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => Math.min(results.length - 1, a + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => Math.max(0, a - 1));
                } else if (e.key === "Enter" && results[active]) router.push(toolHref(results[active]));
                else if (e.key === "Escape") setQ("");
              }}
              placeholder="Search tools: compress, sign, Word to PDF…"
              className="h-[52px] w-full rounded-2xl bg-surface pl-11 pr-4 text-base text-ink shadow-raised placeholder:text-ink-3 focus:outline-none focus:ring-[3px] focus:ring-accent/25"
            />
            {s && (
              <ul id="home-search-results" role="listbox" className="glass absolute inset-x-0 top-[60px] z-20 animate-rise-in rounded-2xl p-1.5 shadow-overlay">
                {results.length === 0 && <li className="px-3 py-4 text-center text-sm text-ink-3">No tools match “{q}”.</li>}
                {results.map((t, i) => (
                  <li key={t.id} role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)}>
                    <Link href={toolHref(t)} className={cn("flex items-center gap-3 rounded-xl px-2.5 py-2", i === active && "bg-ink/[0.05]")}>
                      <ToolGlyph icon={t.icon} category={t.category} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">{t.name}</span>
                        <span className="block truncate text-xs text-ink-3">{t.tagline}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* upload */}
          <div id="start" className="mx-auto mt-6 max-w-[760px] scroll-mt-24">
            {files.length ? (
              <Suggestions files={files} onClear={() => keep([])} />
            ) : (
              <DropZone
                onFiles={async (l) => keep(await uploader.upload(l))}
                accepts={UPLOADABLE}
                uploading={uploader.uploading}
                progress={uploader.progress}
                onCancel={uploader.cancel}
                title="Drop your documents here"
                hint="PDF, Word, PowerPoint, Excel, images and more. We'll suggest the right tools."
                className="min-h-[240px] shadow-raised"
              />
            )}
            <UploadErrors errors={uploader.errors} onDismiss={uploader.clearErrors} />
          </div>

          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {QUICK.map((id) => {
              const t = TOOLS.find((x) => x.id === id)!;
              const href = files.length && files.every((f) => t.accepts.includes(f.format)) ? withQuery(toolHref(t), `files=${files.map((f) => f.id).join(",")}`) : toolHref(t);
              return (
                <Link key={id} href={href} className="inline-flex h-10 items-center gap-2 rounded-full bg-surface pl-1.5 pr-3.5 text-sm font-medium text-ink shadow-card transition-all duration-200 hover:-translate-y-px hover:shadow-raised">
                  <ToolGlyph icon={t.icon} category={t.category} size="sm" className="!size-7 !rounded-full" />
                  {t.name}
                </Link>
              );
            })}
          </div>
          <p className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-sm text-ink-3">
            <span className="inline-flex items-center gap-1.5"><UserX className="size-4" aria-hidden /> No account needed</span>
            <span className="inline-flex items-center gap-1.5"><Timer className="size-4" aria-hidden /> Files deleted after {caps?.limits.retentionMinutes ?? 60} min</span>
            <span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-4" aria-hidden /> No watermarks</span>
          </p>
        </div>
      </section>

      <div className="mx-auto w-full max-w-[1180px] px-4 sm:px-8">
        <RecentDocuments />

        {/* ---------------------------------------------------------------- popular */}
        <Section id="popular" eyebrow="Popular" title="The tools people reach for most" subtitle="Each one does the real work on your file and hands you the result.">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {popular.map((t) => (
              <ToolCard key={t.id} tool={t} />
            ))}
          </div>
        </Section>

        <AllToolsSection />

        {/* ---------------------------------------------------------------- AI */}
        <Section id="ai" eyebrow="AI document tools" title="Let AI do the reading" subtitle="Summaries, answers, translations and key facts from any PDF or scan, with page references you can check.">
          <div className="relative overflow-hidden rounded-[24px] bg-gradient-to-br from-[#5b4cf0]/[0.08] via-accent/[0.06] to-transparent p-4 sm:p-6">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {aiTools.map((t) => (
                <ToolCard key={t.id} tool={t} />
              ))}
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-sm text-ink-2">
                <Sparkles className="size-4 text-[#5b4cf0]" aria-hidden />
                Powered by Claude.{" "}
                {caps && !caps.ai.available ? <Badge tone="warning">Needs setup on this server</Badge> : "Documents are sent to Anthropic only when you run an AI tool."}
              </p>
              <Link href="/ai" className="inline-flex h-10 items-center gap-1.5 rounded-full bg-accent px-4 text-sm font-medium text-white transition-[filter] hover:brightness-110">
                Open AI Workspace <ArrowRight className="size-4" />
              </Link>
            </div>
          </div>
        </Section>

        {/* ---------------------------------------------------------------- benefits & security */}
        <Section id="security" eyebrow="Why Pagelyt" title="Precise, fast, and careful with your files">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              [Zap, "Real results, fast", "Every tool performs the actual operation, with honest progress and exact before-and-after details."],
              [UserX, "No account, no watermark", "Open the site and start. Nothing to sign up for, nothing stamped on your documents."],
              [HardDrive, "Processed, then deleted", `Files are processed in an isolated job folder and deleted automatically after ${caps?.limits.retentionMinutes ?? 60} minutes, or as soon as you delete them.`],
              [ShieldCheck, "Only your session", "Your files and downloads are tied to your browser session. Links don't work for anyone else."],
              [EyeOff, "Nothing in the logs", "Document contents and passwords are never written to logs. Passwords are discarded when a job ends."],
              [Sparkles, "AI only when you ask", "Documents go to Anthropic's Claude API only when you run an AI tool. Scans are processed entirely on your device."],
            ].map(([I, title, body]) => {
              const Ico = I as typeof Zap;
              return (
                <div key={title as string} className="rounded-[18px] bg-surface p-5 shadow-card">
                  <span className="flex size-9 items-center justify-center rounded-xl bg-accent/[0.1] text-accent">
                    <Ico className="size-[18px]" strokeWidth={1.75} aria-hidden />
                  </span>
                  <p className="mt-3.5 font-semibold text-ink">{title as string}</p>
                  <p className="mt-1 text-sm leading-6 text-ink-2">{body as string}</p>
                </div>
              );
            })}
          </div>
          <p className="mt-5 text-sm text-ink-3">
            {APP_NAME} doesn&apos;t claim end-to-end encryption: the server has to read a file to transform it.{" "}
            <Link href="/privacy" className="font-medium text-accent hover:underline">
              Read exactly what happens to your files
            </Link>
          </p>
        </Section>

        {/* ---------------------------------------------------------------- pricing */}
        <Section id="pricing" eyebrow="Pricing" title="Simple, transparent pricing" subtitle="Everything in Pagelyt is free to use today.">
          <PricingPlans />
        </Section>

        {/* ---------------------------------------------------------------- FAQ */}
        <Section id="faq" eyebrow="FAQ" title="Questions, answered plainly">
          <div className="divide-y overflow-hidden rounded-[18px] bg-surface shadow-card">
            {FAQ.map(([question, a]) => (
              <details key={question} className="group px-5 py-4 [&_summary::-webkit-details-marker]:hidden">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-ink">
                  {question}
                  <ChevronDown className="size-4 shrink-0 text-ink-3 transition-transform duration-200 group-open:rotate-180" aria-hidden />
                </summary>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-2">{a}</p>
              </details>
            ))}
          </div>
        </Section>
      </div>

      <SiteFooter />
    </div>
  );
}

export function SiteFooter() {
  const cols: [string, [string, string][]][] = [
    ["Product", [["All Tools", "/tools"], ["PDF Editor", "/editor"], ["Smart Scanner", "/scan"], ["AI Workspace", "/ai"], ["Convert", "/convert"]]],
    ["Popular", [["Merge PDF", "/tools/merge"], ["Compress PDF", "/tools/compress"], ["Sign PDF", "/tools/sign"], ["Word to PDF", "/tools/word-to-pdf"], ["OCR PDF", "/tools/ocr"]]],
    ["Company", [["Pricing", "/pricing"], ["Privacy & Security", "/privacy"], ["Terms", "/terms"], ["Contact", "/contact"]]],
  ];
  return (
    <footer className="mt-8 border-t bg-surface">
      <div className="mx-auto grid max-w-[1180px] gap-10 px-4 py-12 sm:px-8 md:grid-cols-[1.3fr_repeat(3,1fr)]">
        <div>
          <Link href="/" className="inline-flex items-center gap-2.5" aria-label={`${APP_NAME} home`}>
            <Mark className="size-8" />
            <span className="text-lg font-semibold tracking-[-0.02em] text-ink">{APP_NAME}</span>
          </Link>
          <p className="mt-3 max-w-xs text-sm text-ink-2">{APP_TAGLINE}</p>
        </div>
        {cols.map(([title, links]) => (
          <nav key={title} aria-label={title}>
            <p className="text-sm font-semibold text-ink">{title}</p>
            <ul className="mt-3 space-y-2">
              {links.map(([label, href]) => (
                <li key={href + label}>
                  <Link href={href} className="text-sm text-ink-2 transition-colors hover:text-ink">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t">
        <p className="mx-auto max-w-[1180px] px-4 py-5 text-xs text-ink-3 sm:px-8">
          © {new Date().getFullYear()} {APP_NAME}. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
