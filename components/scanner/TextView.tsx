"use client";
import * as React from "react";
import { ArrowLeft, ChevronDown, ChevronUp, Copy, FileText, Search } from "lucide-react";
import type { ScanPage } from "@/lib/scanner/client";
import { findInPage, textExport, type OcrWord } from "@/lib/scanner/ocr";
import { Button, IconButton } from "@/components/ui/button";
import { Input } from "@/components/ui/controls";
import { toast } from "@/components/ui/feedback";
import { cn } from "@/lib/utils";

type Hit = { page: number; words: [number, number][] };

let measureCtx: CanvasRenderingContext2D | null = null;
function textWidth(text: string, px: number) {
  measureCtx ??= document.createElement("canvas").getContext("2d");
  if (!measureCtx) return text.length * px * 0.5;
  measureCtx.font = `${px}px sans-serif`;
  return measureCtx.measureText(text).width || 1;
}

/**
 * The page image with its recognised words laid exactly over it as transparent, selectable text:
 * dragging across the picture selects real text that copies cleanly (lines become line breaks).
 */
function PageText({ page, index, hits, active }: { page: ScanPage; index: number; hits: Hit[]; active: Hit | null }) {
  const box = React.useRef<HTMLDivElement>(null);
  const [w, setW] = React.useState(0);
  React.useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const h = page.width && page.height ? (w * page.height) / page.width : 0;
  const lit = new Set(hits.flatMap((x) => x.words.map(([l, i]) => `${l}:${i}`)));
  const on = new Set(active?.page === index ? active.words.map(([l, i]) => `${l}:${i}`) : []);
  const lines = page.ocr?.lines ?? [];
  return (
    <div ref={box} className="relative w-full overflow-hidden rounded-[3px] bg-white shadow-[0_0_0_0.5px_rgb(0_0_0/0.12),0_8px_24px_-8px_rgb(0_0_0/0.25)]" style={{ height: h || undefined }}>
      {page.resultUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={page.resultUrl} alt={`Page ${index + 1}`} draggable={false} className="pointer-events-none absolute inset-0 size-full select-none" />
      )}
      {w > 0 && (
        <div className="absolute inset-0 cursor-text selection:bg-accent/35" data-testid="ocr-layer" aria-label={`Recognised text of page ${index + 1}`}>
          {lines.map((line, li) => (
            <div key={li}>
              {line.map((word: OcrWord, wi) => {
                const [x0, y0, x1, y1] = word.box;
                const px = Math.max(4, (y1 - y0) * h * 0.86);
                const natural = textWidth(word.text, px);
                const key = `${li}:${wi}`;
                return (
                  <React.Fragment key={wi}>
                    {lit.has(key) && (
                      <span
                        aria-hidden
                        data-hit={on.has(key) ? "active" : "match"}
                        className={cn("pointer-events-none absolute rounded-[2px] mix-blend-multiply", on.has(key) ? "bg-[#ff9f0a]/70" : "bg-[#ffd60a]/55")}
                        style={{ left: `${x0 * 100}%`, top: `${y0 * 100}%`, width: `${(x1 - x0) * 100}%`, height: `${(y1 - y0) * 100}%` }}
                      />
                    )}
                    <span
                      className="absolute origin-top-left whitespace-pre leading-none text-transparent"
                      style={{ left: x0 * w, top: y0 * h, fontSize: px, fontFamily: "sans-serif", transform: `scaleX(${((x1 - x0) * w) / natural})` }}
                    >
                      {word.text}
                      {wi < line.length - 1 ? " " : ""}
                    </span>
                  </React.Fragment>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TextView({ pages, title, onBack }: { pages: ScanPage[]; title: string; onBack: () => void }) {
  const [query, setQuery] = React.useState("");
  const [at, setAt] = React.useState(0);
  const hits = React.useMemo<Hit[]>(() => (query.trim() ? pages.flatMap((p, i) => findInPage(p.ocr?.lines ?? [], query).map((words) => ({ page: i, words }))) : []), [pages, query]);
  const active = hits.length ? hits[Math.min(at, hits.length - 1)] : null;

  React.useEffect(() => setAt(0), [query]);
  React.useEffect(() => {
    if (!active) return;
    // let the highlight render, then bring it into view
    requestAnimationFrame(() => document.querySelector('[data-hit="active"]')?.scrollIntoView({ block: "center", behavior: "smooth" }));
  }, [active]);

  const all = textExport(pages);
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what} copied.`, "success");
    } catch {
      toast("Copying isn't allowed here. Select the text and copy it instead.", "danger");
    }
  };
  const saveTxt = () => {
    const url = URL.createObjectURL(new Blob([all], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/[\u0000-\u001f\\/:*?"<>|]+/g, " ").trim() || "Scan"}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };
  const step = (d: number) => hits.length && setAt((i) => (i + d + hits.length) % hits.length);
  const hitPages = [...new Set(hits.map((x) => x.page + 1))];

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <header className="flex flex-wrap items-center gap-2 border-b bg-surface/80 px-3 py-2 backdrop-blur sm:px-5">
        <Button variant="ghost" size="sm" icon={<ArrowLeft className="size-4" />} onClick={onBack}>
          Pages
        </Button>
        <h1 className="mr-auto text-sm font-semibold text-ink">Recognised text</h1>
        <div className="relative order-last w-full sm:order-none sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <Input
            type="search"
            aria-label="Search the scan"
            placeholder="Search the scan"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                step(e.shiftKey ? -1 : 1);
              }
            }}
            className="pl-8 pr-28 [&::-webkit-search-cancel-button]:hidden"
          />
          {query.trim() && (
            <span className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
              <span className="px-1 text-xs tabular-nums text-ink-3" aria-live="polite" data-testid="search-count">
                {hits.length ? `${Math.min(at, hits.length - 1) + 1} of ${hits.length}` : "No matches"}
              </span>
              <IconButton size="sm" label="Previous match" onClick={() => step(-1)} disabled={!hits.length}>
                <ChevronUp className="size-3.5" />
              </IconButton>
              <IconButton size="sm" label="Next match" onClick={() => step(1)} disabled={!hits.length}>
                <ChevronDown className="size-3.5" />
              </IconButton>
            </span>
          )}
        </div>
        <Button size="sm" icon={<Copy className="size-3.5" />} onClick={() => copy(all, "All text")}>
          Copy all
        </Button>
        <Button size="sm" variant="primary" icon={<FileText className="size-3.5" />} onClick={saveTxt}>
          Export .txt
        </Button>
      </header>
      {query.trim() && hits.length > 0 && (
        <p className="border-b bg-surface px-5 py-1.5 text-xs text-ink-2">
          Found on page{hitPages.length > 1 ? "s" : ""} {hitPages.join(", ")}
        </p>
      )}
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1180px] space-y-8 p-4 sm:p-8">
          {pages.map((p, i) => (
            <section key={p.id} aria-label={`Page ${i + 1}`} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div>
                <p className="mb-2 text-xs font-semibold text-ink-2">Page {i + 1} · select text right on the page</p>
                <PageText page={p} index={i} hits={hits.filter((x) => x.page === i)} active={active} />
              </div>
              <div className="flex min-h-0 flex-col">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-semibold text-ink-2">
                    Text{p.ocr ? ` · ${Math.round(p.ocr.confidence)}% confidence` : ""}
                  </p>
                  <IconButton size="sm" label={`Copy text of page ${i + 1}`} onClick={() => copy(p.ocr?.text ?? "", `Page ${i + 1} text`)} disabled={!p.ocr?.text}>
                    <Copy className="size-3.5" />
                  </IconButton>
                </div>
                <pre data-testid="page-text" className="scroll-thin max-h-[70vh] min-h-32 flex-1 overflow-auto whitespace-pre-wrap rounded-xl bg-surface p-4 font-sans text-sm leading-6 text-ink shadow-card">
                  {p.ocr ? p.ocr.text || "No text found on this page." : "Not recognised yet."}
                </pre>
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
