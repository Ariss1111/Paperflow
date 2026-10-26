import "server-only";
import fs from "node:fs";
import path from "node:path";
import { createWorker, OEM, PSM, type Worker } from "tesseract.js";
import { PDFDocument, degrees } from "pdf-lib";
import { env } from "./env";
import { UserError, throwIfAborted } from "./errors";
import { openDoc, renderPagePng, hasTextLayer, pageText } from "@/lib/pdf/mu";

const OCR_DPI = 300;

interface LangSource {
  dir: string;
  gzip: boolean;
}

function bundledEng(): string | null {
  const dir = path.join(env.projectRoot, "node_modules", "@tesseract.js-data", "eng", "4.0.0_best_int");
  return fs.existsSync(path.join(dir, "eng.traineddata.gz")) ? dir : null;
}

function langSource(code: string): LangSource | null {
  if (!/^[a-z_]{3,10}$/i.test(code)) return null;
  if (env.ocrLangPath) {
    const dir = path.resolve(env.ocrLangPath);
    if (fs.existsSync(path.join(dir, `${code}.traineddata.gz`))) return { dir, gzip: true };
    if (fs.existsSync(path.join(dir, `${code}.traineddata`))) return { dir, gzip: false };
  }
  if (code === "eng") {
    const dir = bundledEng();
    if (dir) return { dir, gzip: true };
  }
  return null;
}

/** Languages that are configured *and* have data files present. */
export function ocrLanguages(): string[] {
  const set = new Set(["eng", ...env.ocrLanguages]);
  return [...set].filter((l) => langSource(l));
}

async function worker(lang: string): Promise<Worker> {
  const src = langSource(lang);
  if (!src) throw new UserError(`OCR language “${lang}” isn't installed on this server.`, "ocr_language_unavailable", 503);
  const cachePath = path.join(env.dataDir, "tess-cache");
  fs.mkdirSync(cachePath, { recursive: true });
  const w = await createWorker(lang, OEM.LSTM_ONLY, {
    langPath: src.dir,
    gzip: src.gzip,
    cachePath,
    cacheMethod: "none",
    // surface WASM crashes as rejected promises instead of process-level exceptions
    errorHandler: () => undefined,
  });
  // tesseract.js defaults to single-block segmentation, which drops headings and columns
  await w.setParameters({ user_defined_dpi: String(OCR_DPI), tessedit_pageseg_mode: PSM.AUTO });
  return w;
}

/** Recognises one image; on a worker crash (rare WASM faults) retries once with a fresh worker. */
async function recognise(state: { w: Worker; lang: string }, image: Buffer, opts: Parameters<Worker["recognize"]>[1], out: Parameters<Worker["recognize"]>[2]) {
  try {
    return await state.w.recognize(image, opts, out);
  } catch {
    await state.w.terminate().catch(() => undefined);
    state.w = await worker(state.lang);
    return state.w.recognize(image, opts, out);
  }
}

export interface OcrResult {
  pdf?: Uint8Array;
  text: string;
  recognised: number;
  skipped: number;
}

export async function ocrPdf(
  bytes: Uint8Array,
  o: { lang: string; skipText: boolean; output: "pdf" | "txt" },
  signal: AbortSignal,
  progress: (p: number, msg: string) => void,
): Promise<OcrResult> {
  const doc = openDoc(bytes);
  const n = doc.countPages();
  const out = o.output === "pdf" ? await PDFDocument.load(bytes, { updateMetadata: false }) : null;
  const texts: string[] = [];
  let recognised = 0;
  let skipped = 0;
  const st = { w: await worker(o.lang), lang: o.lang };
  try {
    for (let i = 0; i < n; i++) {
      throwIfAborted(signal);
      if (o.skipText && hasTextLayer(doc, i)) {
        texts.push(pageText(doc, i).trim());
        skipped++;
        continue;
      }
      progress(i / n, `Recognising page ${i + 1} of ${n}…`);
      const png = renderPagePng(doc, i, OCR_DPI);
      const r = await recognise(st, Buffer.from(png), { pdfTextOnly: true }, { text: true, pdf: !!out });
      texts.push((r.data.text ?? "").trim());
      recognised++;
      if (out && r.data.pdf) {
        // overlay the invisible text layer on the untouched original page
        const layer = await PDFDocument.load(Uint8Array.from(r.data.pdf));
        const [embedded] = await out.embedPdf(layer, [0]);
        const page = out.getPage(i);
        const rot = ((page.getRotation().angle % 360) + 360) % 360;
        const b = page.getCropBox();
        const vw = rot % 180 === 0 ? b.width : b.height;
        const vh = rot % 180 === 0 ? b.height : b.width;
        const xs = vw / embedded.width;
        const ys = vh / embedded.height;
        // the OCR layer is in the page's visual orientation; rotate it back into user space
        const place =
          rot === 90
            ? { x: b.x + b.width, y: b.y, rotate: degrees(90) }
            : rot === 180
              ? { x: b.x + b.width, y: b.y + b.height, rotate: degrees(180) }
              : rot === 270
                ? { x: b.x, y: b.y + b.height, rotate: degrees(270) }
                : { x: b.x, y: b.y, rotate: degrees(0) };
        page.drawPage(embedded, { ...place, xScale: xs, yScale: ys });
      }
    }
  } finally {
    await st.w.terminate().catch(() => undefined);
  }
  progress(1, "Finishing…");
  return {
    pdf: out ? await out.save({ useObjectStreams: true }) : undefined,
    text: texts.map((t, i) => `——— Page ${i + 1} ———\n\n${t}`).join("\n\n") + "\n",
    recognised,
    skipped,
  };
}

export async function ocrImage(bytes: Uint8Array, o: { lang: string; output: "pdf" | "txt" }, signal: AbortSignal): Promise<OcrResult> {
  const st = { w: await worker(o.lang), lang: o.lang };
  try {
    throwIfAborted(signal);
    const r = await recognise(st, Buffer.from(bytes), {}, { text: true, pdf: o.output === "pdf" });
    return {
      text: (r.data.text ?? "").trim() + "\n",
      pdf: r.data.pdf ? Uint8Array.from(r.data.pdf) : undefined,
      recognised: 1,
      skipped: 0,
    };
  } finally {
    await st.w.terminate().catch(() => undefined);
  }
}
