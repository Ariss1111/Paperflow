"use client";
import type { ScanPage } from "./client";

// Long edge in points for recognised paper shapes; anything else (receipts, cards) keeps its proportions at A4's long edge.
const PAPER: [ratio: number, longEdge: number][] = [
  [Math.SQRT2, 841.89], // A series
  [11 / 8.5, 792], // Letter
  [14 / 8.5, 1008], // Legal
];

function pageSize(width: number, height: number): [number, number] {
  const ratio = Math.max(width, height) / Math.min(width, height);
  const match = PAPER.find(([r]) => Math.abs(ratio - r) / r < 0.01);
  const long = match ? match[1] : 841.89;
  const k = long / Math.max(width, height);
  return [width * k, height * k];
}

/**
 * Builds the PDF in the browser: each scanned page becomes one page, with its orientation and proportions.
 * With `searchable`, pages that went through OCR get Tesseract's invisible text layer on top of the image,
 * so the text can be selected, copied and searched in any PDF reader.
 */
export async function scanToPdf(pages: ScanPage[], title: string, o: { searchable?: boolean } = {}): Promise<Uint8Array<ArrayBuffer>> {
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setCreator("Pagelyt");
  for (const p of pages) {
    if (!p.result || !p.width || !p.height) throw new Error("A page hasn't finished processing yet.");
    const bytes = new Uint8Array(await p.result.arrayBuffer());
    const image = p.result.type === "image/png" ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    const [w, h] = pageSize(p.width, p.height);
    const page = doc.addPage([w, h]);
    page.drawImage(image, { x: 0, y: 0, width: w, height: h });
    if (o.searchable && p.ocr) {
      const [layer] = await doc.embedPdf(p.ocr.layer, [0]);
      page.drawPage(layer, { x: 0, y: 0, xScale: w / layer.width, yScale: h / layer.height });
    }
  }
  if (o.searchable && pages.some((p) => p.ocr)) doc.setKeywords(["searchable", "OCR"]);
  return (await doc.save()) as Uint8Array<ArrayBuffer>;
}

/**
 * Opens the generated PDF again and checks it before anything reports success:
 * one page per scan, in order with the right orientation, and a text layer where OCR ran.
 */
export async function verifyScanPdf(bytes: Uint8Array, pages: ScanPage[], o: { searchable?: boolean } = {}): Promise<{ pages: number; searchable: number }> {
  const { loadPdf, forgetPdf } = await import("@/lib/client/pdfjs");
  const key = `scan-verify-${Date.now()}-${Math.random()}`;
  const doc = await loadPdf(bytes.slice().buffer as ArrayBuffer, key);
  try {
    if (doc.numPages !== pages.length) throw new Error(`The PDF has ${doc.numPages} pages instead of ${pages.length}.`);
    let searchable = 0;
    for (let i = 0; i < pages.length; i++) {
      const pg = await doc.getPage(i + 1);
      const vp = pg.getViewport({ scale: 1 });
      const p = pages[i];
      if (p.width && p.height && (vp.width > vp.height) !== (p.width > p.height) && Math.abs(p.width - p.height) > 2)
        throw new Error(`Page ${i + 1} came out with the wrong orientation.`);
      if (o.searchable && p.ocr?.text.trim()) {
        const tc = await pg.getTextContent();
        if (!tc.items.some((it) => "str" in it && it.str.trim())) throw new Error(`Page ${i + 1} is missing its text layer.`);
        searchable++;
      }
    }
    return { pages: doc.numPages, searchable };
  } finally {
    forgetPdf(key);
  }
}

export function safePdfName(title: string): string {
  const base = title.replace(/[\u0000-\u001f\\/:*?"<>|]+/g, " ").replace(/\.pdf$/i, "").trim().slice(0, 120);
  return `${base || "Scan"}.pdf`;
}
