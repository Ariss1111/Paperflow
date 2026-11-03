"use client";
import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Sparkles, MessagesSquare, Languages, ListChecks, GitCompare, FileText, KeyRound, X, ShieldCheck } from "lucide-react";
import { Container } from "@/components/shell/AppShell";
import { DropZone } from "@/components/files/DropZone";
import { useUploader } from "@/components/files/useUploader";
import { UploadErrors } from "@/components/tool/ToolWorkspace";
import { Button, IconButton } from "@/components/ui/button";
import { Segmented } from "@/components/ui/controls";
import { Sheet } from "@/components/ui/dialog";
import { Notice, toast } from "@/components/ui/feedback";
import { api } from "@/lib/client/api";
import { cn, formatBytes } from "@/lib/utils";
import type { StoredFile } from "@/types";
import { ChatPanel } from "./ChatPanel";
import { ComparePanel } from "./ComparePanel";
import { DocViewer, type DocViewerHandle } from "./DocViewer";
import { ExtractPanel } from "./ExtractPanel";
import { RunPanel } from "./RunPanel";
import type { AiUsage } from "./types";

type Tab = "ask" | "summarize" | "translate" | "extract" | "compare";
const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "ask", label: "Chat", icon: MessagesSquare },
  { id: "summarize", label: "Summary", icon: Sparkles },
  { id: "translate", label: "Translate", icon: Languages },
  { id: "extract", label: "Extract", icon: ListChecks },
  { id: "compare", label: "Compare", icon: GitCompare },
];
const ACCEPTS = ["pdf", "jpg", "png", "webp", "gif"] as const;
const CONSENT = "pf-ai-consent";

function UsageMeter({ u }: { u: AiUsage }) {
  const { requests, tokens, plan, resetsAt } = u.usage;
  const share = Math.min(1, Math.max(requests / plan.dailyRequests, tokens / plan.dailyTokens));
  const reset = new Date(resetsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="min-w-[180px] space-y-1" data-testid="ai-usage" title={`${tokens.toLocaleString()} of ${plan.dailyTokens.toLocaleString()} tokens today · resets at ${reset}`}>
      <p className="flex justify-between gap-3 text-xs text-ink-2">
        <span>
          AI today: <b className="tabular-nums text-ink">{requests}</b> of {plan.dailyRequests} requests
        </span>
        <span className="text-ink-3">{plan.label} plan</span>
      </p>
      <div className="h-1 overflow-hidden rounded-full bg-ink/10">
        <div className={cn("h-full rounded-full transition-[width]", share > 0.9 ? "bg-danger" : share > 0.7 ? "bg-warning" : "bg-accent")} style={{ width: `${share * 100}%` }} />
      </div>
    </div>
  );
}

export function AiWorkspace() {
  const params = useSearchParams();
  const uploader = useUploader([...ACCEPTS]);
  const [file, setFile] = React.useState<StoredFile | null>(null);
  const [other, setOther] = React.useState<StoredFile | null>(null);
  const [recent, setRecent] = React.useState<StoredFile[]>([]);
  const [usage, setUsage] = React.useState<AiUsage | null>(null);
  const [tab, setTab] = React.useState<Tab>(() => {
    const t = params.get("task");
    return TABS.some((x) => x.id === t) ? (t as Tab) : "ask";
  });
  const [mobileView, setMobileView] = React.useState<"doc" | "ai">("ai");
  const [side, setSide] = React.useState<"a" | "b">("a");
  const [selection, setSelection] = React.useState<{ text: string; page: number } | null>(null);
  const [consentOpen, setConsentOpen] = React.useState(false);
  const consentResolve = React.useRef<((ok: boolean) => void) | null>(null);
  const viewer = React.useRef<DocViewerHandle>(null);
  const pendingPage = React.useRef<number | null>(null);

  const available = usage?.available ?? false;
  const ready = available && !!file && !file.encrypted;

  React.useEffect(() => {
    fetch("/api/ai/usage")
      .then((r) => r.json())
      .then((u: AiUsage) => setUsage(u))
      .catch(() => undefined);
  }, []);

  React.useEffect(() => {
    const ids = (params.get("files") ?? "").split(",").filter(Boolean);
    if (ids[0]) api.getFile(ids[0]).then((r) => setFile(r.file)).catch(() => toast("That document is no longer available.", "danger"));
    if (ids[1]) api.getFile(ids[1]).then((r) => setOther(r.file)).catch(() => undefined);
    api.listFiles().then((r) => setRecent(r.files.filter((f) => (ACCEPTS as readonly string[]).includes(f.format)).slice(0, 8))).catch(() => undefined);
  }, [params]);

  const onUsage = React.useCallback((u: { requests: number; tokens: number }) => setUsage((x) => (x ? { ...x, usage: { ...x.usage, requests: u.requests, tokens: u.tokens } } : x)), []);

  /** The first time, ask before any document is sent to the AI provider. */
  const consent = React.useCallback(() => {
    try {
      if (localStorage.getItem(CONSENT) === "1") return Promise.resolve(true);
    } catch {
      // storage blocked: ask every time
    }
    setConsentOpen(true);
    return new Promise<boolean>((resolve) => (consentResolve.current = resolve));
  }, []);
  const answerConsent = (ok: boolean) => {
    if (ok) {
      try {
        localStorage.setItem(CONSENT, "1");
      } catch {
        // remembered for this page only
      }
    }
    setConsentOpen(false);
    consentResolve.current?.(ok);
    consentResolve.current = null;
  };

  const showPage = React.useCallback(
    (page: number, which: "a" | "b" = "a") => {
      setMobileView("doc");
      if (which !== side) {
        pendingPage.current = page;
        setSide(which);
        return;
      }
      viewer.current?.goTo(page);
    },
    [side],
  );
  // after switching documents, wait for the viewer to lay out its pages, then jump
  React.useEffect(() => {
    const p = pendingPage.current;
    if (p == null) return;
    pendingPage.current = null;
    const t = setTimeout(() => viewer.current?.goTo(p), 700);
    return () => clearTimeout(t);
  }, [side]);

  const choose = (f: StoredFile) => {
    setFile(f);
    setOther(null);
    setSide("a");
    setSelection(null);
  };

  const shown = side === "b" && other ? other : file;
  const disclosure = usage?.provider ?? "the AI provider";

  return (
    <>
      <Sheet
        open={consentOpen}
        onOpenChange={(o) => !o && answerConsent(false)}
        title="Send this document to the AI?"
        description={`To answer, Pagelyt sends the document's contents to ${disclosure}, which processes them and returns the result. Nothing else in Pagelyt sends your files anywhere, and comparing documents works without AI.`}
        footer={
          <>
            <Button onClick={() => answerConsent(false)}>Not now</Button>
            <Button variant="primary" onClick={() => answerConsent(true)} autoFocus>
              Continue
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-2">AI can make mistakes. Check important details against the pages it cites.</p>
      </Sheet>

      {!file ? (
        <Container>
          <header className="pb-6 pt-8 sm:pt-10">
            <p className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[#5b4cf0]/10 to-accent/10 px-2.5 py-1 text-xs font-semibold text-[#5b4cf0] dark:text-[#9d93ff]">
              <Sparkles className="size-3.5" /> AI Workspace
            </p>
            <h1 className="text-2xl font-semibold tracking-[-0.022em] text-ink sm:text-3xl">Understand any document in seconds</h1>
            <p className="mt-1.5 max-w-2xl text-base text-ink-2">Chat with a PDF, summarize it, translate it, pull out its data, or compare two versions. Answers cite the pages they come from.</p>
          </header>
          {usage && !usage.available && <SetupNotice />}
          <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_300px]">
            <section className="rounded-[18px] bg-surface p-5 shadow-card">
              <DropZone multiple={false} accepts={[...ACCEPTS]} title="Drop a PDF or image" hint={`PDF, JPG, PNG, WebP${usage ? ` · AI reads up to ${usage.usage.plan.maxPages} pages and ${formatBytes(usage.usage.plan.maxFileBytes)}` : ""}`} onFiles={async (l) => { const [f] = await uploader.upload(l); if (f) choose(f); }} uploading={uploader.uploading} progress={uploader.progress} onCancel={uploader.cancel} />
              <UploadErrors errors={uploader.errors} onDismiss={uploader.clearErrors} />
            </section>
            <aside className="space-y-4">
              {recent.length > 0 && (
                <section className="rounded-[18px] bg-surface p-4 shadow-card">
                  <p className="eyebrow mb-2">Recent documents</p>
                  <ul className="space-y-1">
                    {recent.map((f) => (
                      <li key={f.id}>
                        <button type="button" onClick={() => choose(f)} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm text-ink hover:bg-ink/[0.04]">
                          <FileText className="size-4 shrink-0 text-ink-3" />
                          <span className="truncate">{f.name}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <Privacy provider={usage?.provider ?? null} />
              {usage?.available && (
                <section className="rounded-[18px] bg-surface p-4 shadow-card">
                  <UsageMeter u={usage} />
                </section>
              )}
            </aside>
          </div>
        </Container>
      ) : (
        <div className="flex h-[calc(100dvh-56px)] min-h-0 flex-col">
          <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-surface/80 px-4 py-2 backdrop-blur">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <FileText className="size-4 shrink-0 text-ink-3" />
              <p className="min-w-0 truncate text-sm font-medium text-ink" title={file.name}>
                {file.name}
              </p>
              <span className="shrink-0 text-xs text-ink-3">
                {file.pages ? `${file.pages} pages · ` : ""}
                {formatBytes(file.size)}
              </span>
              <IconButton size="sm" label="Choose another document" onClick={() => { setFile(null); setOther(null); }}>
                <X className="size-4" />
              </IconButton>
            </div>
            {usage?.available && <UsageMeter u={usage} />}
            <Segmented<"doc" | "ai"> size="sm" label="View" className="lg:hidden" value={mobileView} onChange={setMobileView} options={[{ value: "doc", label: "Document" }, { value: "ai", label: "Assistant" }]} />
          </header>
          {usage && !usage.available && (
            <div className="px-4 pt-3">
              <SetupNotice compact />
            </div>
          )}
          {file.encrypted && (
            <div className="px-4 pt-3">
              <Notice tone="warning">
                This PDF is password-protected. <Link className="font-medium text-accent hover:underline" href={`/tools/unlock?files=${file.id}`}>Unlock it first</Link>.
              </Notice>
            </div>
          )}
          <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(400px,540px)]">
            {/* ---------------------------------------------------------------- document */}
            <section aria-label="Document" className={cn("min-h-0 flex-col border-r", mobileView === "doc" ? "flex" : "hidden lg:flex")}>
              {other && tab === "compare" && (
                <div className="border-b px-3 py-1.5">
                  <Segmented<"a" | "b"> size="sm" label="Show" value={side} onChange={setSide} options={[{ value: "a", label: "Original" }, { value: "b", label: "Revised" }]} />
                </div>
              )}
              <div className="min-h-0 flex-1">{shown && <DocViewer key={shown.id} ref={viewer} file={shown} onSelect={side === "a" ? setSelection : undefined} />}</div>
            </section>

            {/* ---------------------------------------------------------------- assistant */}
            <section aria-label="Assistant" className={cn("min-h-0 flex-col bg-surface", mobileView === "ai" ? "flex" : "hidden lg:flex")}>
              <div role="tablist" aria-label="AI tools" className="scroll-thin flex shrink-0 gap-1 overflow-x-auto border-b px-2 py-1.5">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={tab === t.id}
                    onClick={() => setTab(t.id)}
                    className={cn("flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors", tab === t.id ? "bg-accent/10 text-accent" : "text-ink-2 hover:bg-ink/[0.05] hover:text-ink")}
                  >
                    <t.icon className="size-4" />
                    {t.label}
                  </button>
                ))}
              </div>
              {/* panels stay mounted so switching tabs keeps their results */}
              <div className="min-h-0 flex-1">
                <div role="tabpanel" aria-label="Chat" hidden={tab !== "ask"} className="h-full">
                  <ChatPanel key={file.id} file={file} ready={ready} selection={selection} onClearSelection={() => { setSelection(null); window.getSelection()?.removeAllRanges(); }} onPage={(p) => showPage(p)} onUsage={onUsage} consent={consent} />
                </div>
                <div role="tabpanel" aria-label="Summary" hidden={tab !== "summarize"} className="h-full">
                  <RunPanel key={file.id} mode="summarize" file={file} ready={ready} onPage={(p) => showPage(p)} onUsage={onUsage} consent={consent} />
                </div>
                <div role="tabpanel" aria-label="Translate" hidden={tab !== "translate"} className="h-full">
                  <RunPanel key={file.id} mode="translate" file={file} ready={ready} onPage={(p) => showPage(p)} onUsage={onUsage} consent={consent} />
                </div>
                <div role="tabpanel" aria-label="Extract" hidden={tab !== "extract"} className="h-full">
                  <ExtractPanel key={file.id} file={file} ready={ready} onPage={(p) => showPage(p)} onUsage={onUsage} consent={consent} />
                </div>
                <div role="tabpanel" aria-label="Compare" hidden={tab !== "compare"} className="h-full">
                  <ComparePanel key={file.id} file={file} other={other} onOther={(f) => { setOther(f); setSide("a"); }} recent={recent} aiReady={available} onPage={(s, p) => showPage(p, s)} onUsage={onUsage} consent={consent} />
                </div>
              </div>
              <p className="flex items-start gap-1.5 border-t px-4 py-2 text-[11px] leading-4 text-ink-3">
                <ShieldCheck className="mt-px size-3.5 shrink-0" />
                {usage?.available ? `AI features send this document's contents to ${disclosure}. AI can make mistakes: check important details against the pages cited.` : "AI isn't set up on this server, so nothing is sent anywhere. Comparing documents still works."}
              </p>
            </section>
          </div>
        </div>
      )}
    </>
  );
}

function SetupNotice({ compact }: { compact?: boolean }) {
  return (
    <Notice tone="warning" title={compact ? undefined : "AI features need setup on this server"} className={compact ? "" : "mb-6"}>
      <span className="flex items-start gap-2">
        <KeyRound className="mt-0.5 size-4 shrink-0" />
        <span>
          Chat, summaries, translation and extraction need an AI provider key. The site administrator adds it to the server settings (see README → AI tools). Until then, nothing is sent anywhere. Document comparison works without it.
        </span>
      </span>
    </Notice>
  );
}

function Privacy({ provider }: { provider: string | null }) {
  return (
    <section className="space-y-1.5 rounded-[18px] bg-surface p-4 text-xs leading-5 text-ink-2 shadow-card">
      <p className="flex items-center gap-1.5 font-semibold text-ink">
        <ShieldCheck className="size-4 text-success" /> Where your document goes
      </p>
      <p>
        When you use Chat, Summary, Translate or Extract, the document&apos;s contents are sent to {provider ?? "the configured AI provider"} to produce the answer. Pagelyt asks before the first time. Comparison runs on this server and never uses AI unless you ask it to explain the changes.
      </p>
    </section>
  );
}
