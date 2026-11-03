"use client";
import * as React from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/client/api";
import { loadPdf, pdfjs } from "@/lib/client/pdfjs";
import type { StoredFile } from "@/types";

export interface DocViewerHandle {
  goTo: (page: number) => void;
}

/** One page: drawn when it scrolls near view, with PDF.js's text layer so its text can be selected. */
function Page({ pdf, n, width, ratio }: { pdf: PDFDocumentProxy; n: number; width: number; ratio: number }) {
  const box = React.useRef<HTMLDivElement>(null);
  const [visible, setVisible] = React.useState(false);
  const [size, setSize] = React.useState<{ w: number; h: number } | null>(null);

  React.useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  React.useEffect(() => {
    if (!visible || !width) return;
    let cancelled = false;
    let task: { cancel: () => void } | null = null;
    let layer: { cancel: () => void } | null = null;
    (async () => {
      const page = await pdf.getPage(n);
      const vp = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
      if (cancelled || !box.current) return;
      setSize({ w: vp.width, h: vp.height });
      const canvas = box.current.querySelector("canvas")!;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.floor(vp.width * dpr);
      canvas.height = Math.floor(vp.height * dpr);
      const r = page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      task = r;
      await r.promise.catch(() => undefined);
      if (cancelled) return;
      canvas.style.opacity = "1";
      const container = box.current.querySelector<HTMLDivElement>(".pdf-text-layer")!;
      container.replaceChildren();
      container.style.setProperty("--total-scale-factor", String(vp.scale));
      const { TextLayer } = await pdfjs();
      const tl = new TextLayer({ textContentSource: page.streamTextContent(), container, viewport: vp });
      layer = tl;
      await tl.render().catch(() => undefined);
    })();
    return () => {
      cancelled = true;
      task?.cancel();
      layer?.cancel();
    };
  }, [visible, width, pdf, n]);

  const h = size?.h ?? width * ratio;
  return (
    <div ref={box} data-page={n} className="relative mx-auto bg-white shadow-[0_0_0_0.5px_rgb(0_0_0/0.12),0_8px_24px_-10px_rgb(0_0_0/0.3)]" style={{ width, height: h }}>
      <canvas className="absolute inset-0 size-full opacity-0 transition-opacity duration-200" aria-hidden />
      <div className="pdf-text-layer" />
      <span className="pointer-events-none absolute -bottom-5 left-1/2 -translate-x-1/2 text-2xs tabular-nums text-ink-3">{n}</span>
    </div>
  );
}

type Viewable = Pick<StoredFile, "id" | "name" | "format">;

/**
 * Scrollable view of a PDF (or image) whose text can be selected; `onSelect` reports selected text and its page.
 * Session files load directly; saved documents pass `resolve`, which returns a short-lived signed link.
 */
export const DocViewer = React.forwardRef<DocViewerHandle, { file: Viewable; resolve?: () => Promise<string>; onSelect?: (s: { text: string; page: number } | null) => void }>(function DocViewer({ file, resolve, onSelect }, ref) {
  const [imageUrl, setImageUrl] = React.useState<string | null>(null);
  const scroller = React.useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = React.useState<PDFDocumentProxy | null>(null);
  const [ratio, setRatio] = React.useState(1.414);
  const [width, setWidth] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const isPdf = file.format === "pdf";

  React.useEffect(() => {
    if (!isPdf) return;
    let cancelled = false;
    setPdf(null);
    const open = resolve
      ? resolve()
          .then((url) => fetch(url))
          .then((r) => {
            if (!r.ok) throw new Error();
            return r.arrayBuffer();
          })
          .then((buf) => loadPdf(buf, `doc:${file.id}:${Date.now()}`))
      : loadPdf(api.fileUrl(file.id), file.id);
    open
      .then(async (d) => {
        const p1 = await d.getPage(1);
        const v = p1.getViewport({ scale: 1 });
        if (cancelled) return;
        setRatio(v.height / v.width);
        setPdf(d);
      })
      .catch(() => !cancelled && setError("This document couldn't be displayed."));
    return () => {
      cancelled = true;
    };
  }, [file.id, isPdf]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (isPdf) return;
    if (!resolve) return setImageUrl(api.fileUrl(file.id));
    resolve().then(setImageUrl, () => setError("This document couldn't be displayed."));
  }, [file.id, isPdf]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(200, Math.min(900, e.contentRect.width - 32))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  React.useImperativeHandle(ref, () => ({
    goTo(page: number) {
      const el = scroller.current?.querySelector<HTMLElement>(`[data-page="${page}"]`);
      if (!el) return;
      el.scrollIntoView({ block: "start", behavior: "smooth" });
      el.animate([{ boxShadow: "0 0 0 3px rgb(52 120 246 / 0.7)" }, { boxShadow: "0 0 0 3px rgb(52 120 246 / 0)" }], { duration: 1400, easing: "ease-out" });
    },
  }));

  // report text selected inside the viewer (for "Explain this paragraph")
  React.useEffect(() => {
    if (!onSelect) return;
    const check = () => {
      const sel = window.getSelection();
      const node = sel?.anchorNode;
      const el = node && (node.nodeType === 1 ? (node as Element) : node.parentElement);
      const host = el?.closest<HTMLElement>("[data-page]");
      const text = sel?.toString().replace(/\s+/g, " ").trim() ?? "";
      onSelect(host && scroller.current?.contains(host) && text.length > 1 ? { text: text.slice(0, 3000), page: Number(host.dataset.page) } : null);
    };
    document.addEventListener("selectionchange", check);
    return () => document.removeEventListener("selectionchange", check);
  }, [onSelect]);

  return (
    <div ref={scroller} className="scroll-thin h-full overflow-y-auto bg-[#e8e8ed] py-4 dark:bg-[#1c1c1f]" aria-label={`Viewer: ${file.name}`} data-testid="doc-viewer">
      {error && <p className="p-6 text-center text-sm text-ink-2">{error}</p>}
      {!isPdf && imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt={file.name} data-page={1} className="mx-auto max-w-[calc(100%-32px)] bg-white shadow-card" />
      )}
      {isPdf && !pdf && !error && (
        <p className="flex items-center justify-center gap-2 p-10 text-sm text-ink-3">
          <Loader2 className="size-4 animate-spin" /> Opening…
        </p>
      )}
      {pdf && width > 0 && (
        <div className="space-y-8 pb-6">
          {Array.from({ length: pdf.numPages }, (_, i) => (
            <Page key={i} pdf={pdf} n={i + 1} width={width} ratio={ratio} />
          ))}
        </div>
      )}
    </div>
  );
});
