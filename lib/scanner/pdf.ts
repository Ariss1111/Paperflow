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

/** Builds the PDF in the browser: each scanned page becomes one page, with its orientation and proportions. */
export async function scanToPdf(pages: ScanPage[], title: string): Promise<Uint8Array<ArrayBuffer>> {
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setCreator("Paperflow");
  for (const p of pages) {
    if (!p.result || !p.width || !p.height) throw new Error("A page hasn't finished processing yet.");
    const bytes = new Uint8Array(await p.result.arrayBuffer());
    const image = p.result.type === "image/png" ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    const [w, h] = pageSize(p.width, p.height);
    doc.addPage([w, h]).drawImage(image, { x: 0, y: 0, width: w, height: h });
  }
  return (await doc.save()) as Uint8Array<ArrayBuffer>;
}

export function safePdfName(title: string): string {
  const base = title.replace(/[\u0000-\u001f\\/:*?"<>|]+/g, " ").replace(/\.pdf$/i, "").trim().slice(0, 120);
  return `${base || "Scan"}.pdf`;
}
