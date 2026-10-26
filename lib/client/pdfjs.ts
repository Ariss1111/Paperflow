"use client";
import type { PDFDocumentProxy, PDFDocumentLoadingTask } from "pdfjs-dist";

type PdfJs = typeof import("pdfjs-dist");
let lib: Promise<PdfJs> | null = null;

export function pdfjs(): Promise<PdfJs> {
  lib ??= import("pdfjs-dist").then((m) => {
    m.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    return m;
  });
  return lib;
}

// Documents are cached per source so thumbnails, previews and the editor share one parse.
const docs = new Map<string, { task: Promise<PDFDocumentLoadingTask>; doc: Promise<PDFDocumentProxy> }>();

export function loadPdf(source: string | ArrayBuffer, key?: string): Promise<PDFDocumentProxy> {
  const k = key ?? (typeof source === "string" ? source : "");
  const hit = k ? docs.get(k) : undefined;
  if (hit) return hit.doc;
  // Assets PDF.js needs for real-world files: non-embedded base-14 fonts, CJK CMaps, colour profiles, JPX/JBIG2 decoders.
  const assets = {
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    iccUrl: "/pdfjs/iccs/",
    wasmUrl: "/pdfjs/wasm/",
  };
  const task = pdfjs().then((m) =>
    m.getDocument(typeof source === "string" ? { url: source, withCredentials: true, ...assets } : { data: new Uint8Array(source.slice(0)), ...assets }),
  );
  const doc = task.then((t) => t.promise);
  if (k) {
    docs.set(k, { task, doc });
    doc.catch(() => docs.delete(k));
  }
  return doc;
}

export function forgetPdf(key: string) {
  const hit = docs.get(key);
  docs.delete(key);
  hit?.task.then((t) => t.destroy()).catch(() => undefined);
}

/** Renders one page into a canvas at a CSS width, respecting devicePixelRatio. */
export async function renderThumb(doc: PDFDocumentProxy, pageNumber: number, canvas: HTMLCanvasElement, cssWidth: number, extraRotation = 0) {
  const page = await doc.getPage(pageNumber);
  const rotation = (page.rotate + extraRotation) % 360;
  const base = page.getViewport({ scale: 1, rotation });
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const scale = (cssWidth / base.width) * dpr;
  const vp = page.getViewport({ scale, rotation });
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${Math.round(vp.height / dpr)}px`;
  const ctx = canvas.getContext("2d")!;
  await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
}
