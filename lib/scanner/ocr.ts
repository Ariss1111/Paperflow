"use client";
// Text recognition for scanned pages, run on this device: Tesseract in its own Web Worker,
// with the engine and the English/Romanian language data served from this site.
import type { Worker } from "tesseract.js";

export type OcrLang = "eng" | "ron" | "eng+ron";

export const OCR_LANGS: { value: OcrLang; label: string }[] = [
  { value: "eng+ron", label: "English + Romanian" },
  { value: "eng", label: "English" },
  { value: "ron", label: "Romanian" },
];

export interface OcrWord {
  text: string;
  /** normalised to the page image: x0, y0, x1, y1 in 0..1 */
  box: [number, number, number, number];
}

export interface OcrResult {
  lang: OcrLang;
  text: string;
  /** words grouped by line, in reading order */
  lines: OcrWord[][];
  /** an invisible, text-only PDF page from Tesseract, laid over the image to make the PDF searchable */
  layer: Uint8Array;
  /** mean word confidence, 0..100 */
  confidence: number;
}

// Matches the scale the scanner renders pages at, so Tesseract sizes the text layer sensibly.
const DPI = 300;

let current: { lang: OcrLang; worker: Promise<Worker> } | null = null;
// recognitions run one at a time; Tesseract's worker isn't re-entrant
let queue: Promise<unknown> = Promise.resolve();

async function create(lang: OcrLang): Promise<Worker> {
  const { createWorker, OEM, PSM } = await import("tesseract.js");
  const w = await createWorker(lang, OEM.LSTM_ONLY, {
    workerPath: "/tesseract/worker.min.js",
    corePath: "/tesseract",
    langPath: "/tesseract/lang",
    gzip: true,
    workerBlobURL: false,
    // the browser caches the files over HTTP; IndexedDB copies would just duplicate them
    cacheMethod: "none",
  });
  await w.setParameters({ user_defined_dpi: String(DPI), tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: "1" });
  return w;
}

function workerFor(lang: OcrLang): Promise<Worker> {
  if (current?.lang === lang) return current.worker;
  const old = current;
  current = { lang, worker: create(lang) };
  const mine = current;
  // a failed start shouldn't stick: the next call tries again
  mine.worker.catch(() => {
    if (current === mine) current = null;
  });
  old?.worker.then((w) => w.terminate()).catch(() => undefined);
  return current.worker;
}

/** Stops the OCR worker and frees its memory (called when the scanner closes). */
export function releaseOcr() {
  const old = current;
  current = null;
  old?.worker.then((w) => w.terminate()).catch(() => undefined);
}

/** Recognises one page image. */
export function recognize(image: Blob, width: number, height: number, lang: OcrLang): Promise<OcrResult> {
  const run = async () => {
    let w: Worker;
    try {
      w = await workerFor(lang);
    } catch {
      throw new Error("Text recognition couldn't start. Check your connection and try again.");
    }
    const r = await w.recognize(image, { pdfTextOnly: true }, { text: true, blocks: true, pdf: true });
    const lines: OcrWord[][] = [];
    let sum = 0;
    let count = 0;
    for (const block of r.data.blocks ?? [])
      for (const para of block.paragraphs)
        for (const line of para.lines) {
          const words = line.words
            .filter((wd) => wd.text.trim())
            .map((wd) => {
              sum += wd.confidence;
              count++;
              return { text: wd.text, box: [wd.bbox.x0 / width, wd.bbox.y0 / height, wd.bbox.x1 / width, wd.bbox.y1 / height] as OcrWord["box"] };
            });
          if (words.length) lines.push(words);
        }
    if (!r.data.pdf) throw new Error("Text recognition didn't produce a text layer.");
    return { lang, text: (r.data.text ?? "").trim(), lines, layer: Uint8Array.from(r.data.pdf), confidence: count ? sum / count : 0 };
  };
  const p = queue.then(run, run);
  queue = p.catch(() => undefined);
  return p;
}

/** Lower-cases and strips diacritics, so "stefan" finds "Ștefan". */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Finds a phrase in a page's words. Returns the matched words as [line, word] index pairs, one array per match. */
export function findInPage(lines: OcrWord[][], query: string): [number, number][][] {
  const q = fold(query).trim().replace(/\s+/g, " ");
  if (!q) return [];
  // one string per page with each word's start offset, so phrases can span words and lines
  let s = "";
  const spans: { start: number; end: number; at: [number, number] }[] = [];
  lines.forEach((line, li) =>
    line.forEach((w, wi) => {
      if (s) s += " ";
      const start = s.length;
      s += fold(w.text);
      spans.push({ start, end: s.length, at: [li, wi] });
    }),
  );
  const out: [number, number][][] = [];
  for (let i = s.indexOf(q); i !== -1; i = s.indexOf(q, i + q.length)) {
    const end = i + q.length;
    out.push(spans.filter((w) => w.end > i && w.start < end).map((w) => w.at));
  }
  return out;
}

/** The recognised text of every page, ready to save as a .txt file. */
export function textExport(pages: { ocr?: OcrResult }[]): string {
  return pages.map((p, i) => `——— Page ${i + 1} ———\n\n${p.ocr?.text ?? ""}`).join("\n\n") + "\n";
}
