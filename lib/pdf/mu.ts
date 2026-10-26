// MuPDF-backed operations: rendering, text, conversion, compression, encryption, repair.
import * as mupdf from "mupdf";
import sharp from "sharp";
import crypto from "node:crypto";
import { UserError, throwIfAborted } from "@/lib/server/errors";

export { mupdf };

const MAX_RENDER_PIXELS = 60_000_000;

export function openDoc(bytes: Uint8Array, password?: string): mupdf.PDFDocument {
  let doc: mupdf.Document;
  try {
    doc = mupdf.Document.openDocument(bytes, "application/pdf");
  } catch {
    throw new UserError("This PDF couldn't be opened. The file is damaged beyond automatic repair.", "unreadable");
  }
  const pdf = doc.asPDF();
  if (!pdf) throw new UserError("This file isn't a PDF.", "not_pdf");
  if (pdf.needsPassword()) {
    if (!password) throw new UserError("This PDF is password-protected. Unlock it first with the Unlock PDF tool.", "encrypted");
    if (!pdf.authenticatePassword(password)) throw new UserError("That password isn't correct for this PDF.", "wrong_password");
  }
  return pdf;
}

export interface PdfInfo {
  pages: number | null;
  encrypted: boolean;
  needsPassword: boolean;
  repaired: boolean;
}

/** Validates that the bytes are a PDF MuPDF can parse; never throws for password-protected files. */
export function inspect(bytes: Uint8Array): PdfInfo {
  let doc: mupdf.Document;
  try {
    doc = mupdf.Document.openDocument(bytes, "application/pdf");
  } catch {
    throw new UserError("This PDF is damaged and couldn't be read.", "unreadable");
  }
  const pdf = doc.asPDF();
  if (!pdf) throw new UserError("This file isn't a PDF.", "not_pdf");
  const needsPassword = pdf.needsPassword();
  const enc = pdf.getMetaData("encryption") ?? "None";
  let pages: number | null = null;
  if (!needsPassword) {
    pages = pdf.countPages();
    if (pages < 1) throw new UserError("This PDF has no pages.", "empty_pdf");
  }
  return { pages, needsPassword, encrypted: needsPassword || !/^none$/i.test(enc), repaired: pdf.wasRepaired() };
}

function matrixForDpi(page: mupdf.Page, dpi: number) {
  const [x0, y0, x1, y1] = page.getBounds();
  let scale = dpi / 72;
  const px = (x1 - x0) * scale * (y1 - y0) * scale;
  if (px > MAX_RENDER_PIXELS) scale *= Math.sqrt(MAX_RENDER_PIXELS / px);
  return mupdf.Matrix.scale(scale, scale);
}

export function renderPage(doc: mupdf.PDFDocument, index: number, dpi: number, alpha = false): mupdf.Pixmap {
  const page = doc.loadPage(index);
  return page.toPixmap(matrixForDpi(page, dpi), mupdf.ColorSpace.DeviceRGB, alpha, true);
}

export function renderPagePng(doc: mupdf.PDFDocument, index: number, dpi: number): Uint8Array {
  return renderPage(doc, index, dpi).asPNG();
}

/** Raw RGB pixels suitable for handing to sharp. */
export function pixmapRaw(pix: mupdf.Pixmap) {
  const w = pix.getWidth();
  const h = pix.getHeight();
  const stride = pix.getStride();
  const channels = stride / w;
  const pixels = pix.getPixels();
  let data: Buffer;
  if (Number.isInteger(channels)) data = Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength);
  else throw new Error("unexpected pixmap stride");
  return { data, width: w, height: h, channels: channels as 1 | 2 | 3 | 4 };
}

// ------------------------------------------------------------------ text

export function pageText(doc: mupdf.PDFDocument, index: number): string {
  return doc.loadPage(index).toStructuredText("preserve-whitespace").asText();
}

export function extractText(bytes: Uint8Array, pageBreaks: boolean, signal?: AbortSignal, onPage?: (i: number, n: number) => void) {
  const doc = openDoc(bytes);
  const n = doc.countPages();
  const parts: string[] = [];
  let chars = 0;
  for (let i = 0; i < n; i++) {
    throwIfAborted(signal);
    const t = pageText(doc, i).replace(/\s+$/g, "");
    chars += t.replace(/\s/g, "").length;
    parts.push(pageBreaks ? `——— Page ${i + 1} ———\n\n${t}` : t);
    onPage?.(i + 1, n);
  }
  return { text: parts.join(pageBreaks ? "\n\n" : "\n\f\n") + "\n", chars, pages: n };
}

export function hasTextLayer(doc: mupdf.PDFDocument, index: number): boolean {
  return pageText(doc, index).replace(/\s/g, "").length > 3;
}

// ------------------------------------------------------------------ writers

function writeAll(doc: mupdf.PDFDocument, format: string, options: string, indices: number[]): Uint8Array {
  const buf = new mupdf.Buffer();
  const writer = new mupdf.DocumentWriter(buf, format, options);
  for (const i of indices) {
    const page = doc.loadPage(i);
    const dev = writer.beginPage(page.getBounds());
    page.run(dev, mupdf.Matrix.identity);
    writer.endPage();
  }
  writer.close();
  return buf.asUint8Array().slice();
}

export function pdfToHtml(bytes: Uint8Array): Uint8Array {
  const doc = openDoc(bytes);
  const all = Array.from({ length: doc.countPages() }, (_, i) => i);
  return writeAll(doc, "html", "preserve-images", all);
}

export function pageToSvg(doc: mupdf.PDFDocument, index: number): Uint8Array {
  return writeAll(doc, "svg", "text=path", [index]);
}

// ------------------------------------------------------------------ structured text (PDF -> DOCX)

export interface TextLine {
  text: string;
  size: number;
  bold: boolean;
  italic: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface TextBlock {
  lines: TextLine[];
  x: number;
  y: number;
  w: number;
  h: number;
}

export function structuredPage(doc: mupdf.PDFDocument, index: number): { width: number; height: number; blocks: TextBlock[] } {
  const page = doc.loadPage(index);
  const [x0, y0, x1, y1] = page.getBounds();
  const json = JSON.parse(page.toStructuredText("preserve-whitespace").asJSON()) as {
    blocks: {
      type: string;
      bbox: { x: number; y: number; w: number; h: number };
      lines?: { bbox: { x: number; y: number; w: number; h: number }; text: string; font: { size: number; weight: string; style: string } }[];
    }[];
  };
  const blocks: TextBlock[] = [];
  for (const b of json.blocks ?? []) {
    if (b.type !== "text" || !b.lines?.length) continue;
    blocks.push({
      ...b.bbox,
      lines: b.lines.map((l) => ({
        text: l.text,
        size: l.font?.size ?? 11,
        bold: l.font?.weight === "bold",
        italic: l.font?.style === "italic",
        ...l.bbox,
      })),
    });
  }
  return { width: x1 - x0, height: y1 - y0, blocks };
}

// ------------------------------------------------------------------ compression

export type CompressionLevel = "low" | "medium" | "high";

const LEVELS: Record<Exclude<CompressionLevel, "low">, { dpi: number; quality: number }> = {
  medium: { dpi: 150, quality: 72 },
  high: { dpi: 96, quality: 55 },
};

function nameOf(o: mupdf.PDFObject): string | null {
  return o && !o.isNull() && o.isName() ? o.asName() : null;
}

function filters(o: mupdf.PDFObject): string[] {
  const f = o.get("Filter");
  if (f.isNull()) return [];
  if (f.isName()) return [f.asName()];
  if (f.isArray()) {
    const out: string[] = [];
    for (let i = 0; i < f.length; i++) out.push(f.get(i).asName());
    return out;
  }
  return [];
}

export async function compress(bytes: Uint8Array, level: CompressionLevel, signal?: AbortSignal, onProgress?: (p: number) => void) {
  const doc = openDoc(bytes);
  let recompressed = 0;
  let examined = 0;
  if (level !== "low") {
    const { dpi, quality } = LEVELS[level];
    // An image can't usefully be shown larger than the largest page; cap its pixels accordingly.
    let maxPt = 0;
    const n = doc.countPages();
    for (let i = 0; i < n; i++) {
      const [x0, y0, x1, y1] = doc.loadPage(i).getBounds();
      maxPt = Math.max(maxPt, x1 - x0, y1 - y0);
    }
    const maxPx = Math.ceil((maxPt / 72) * dpi);
    const total = doc.countObjects();
    const masks = new Set<number>();
    for (let num = 1; num < total; num++) {
      const o = doc.newIndirect(num).resolve();
      if (o.isDictionary()) {
        const sm = o.get("SMask");
        if (sm.isIndirect()) masks.add(sm.asIndirect());
      }
    }
    for (let num = 1; num < total; num++) {
      throwIfAborted(signal);
      if (num % 25 === 0) onProgress?.(num / total);
      // stream accessors only work through the indirect reference, not the resolved object
      const ref = doc.newIndirect(num);
      const o = ref;
      if (!o.isStream() || nameOf(o.get("Subtype")) !== "Image") continue;
      if (masks.has(num)) continue;
      if (o.get("ImageMask").valueOf() === true) continue;
      const f = filters(o);
      if (f.some((x) => x === "JBIG2Decode" || x === "CCITTFaxDecode" || x === "JPXDecode")) continue;
      const bpc = o.get("BitsPerComponent");
      if (!bpc.isNull() && bpc.asNumber() < 8 && nameOf(o.get("ColorSpace")) !== null) continue;
      examined++;
      let img: mupdf.Image;
      try {
        img = doc.loadImage(ref);
      } catch {
        continue;
      }
      const w = img.getWidth();
      const h = img.getHeight();
      if (w * h < 64 * 64) continue;
      let pix = img.toPixmap();
      const cs = pix.getColorSpace();
      if (!cs || !(cs.isRGB() || cs.isGray())) pix = pix.convertToColorSpace(mupdf.ColorSpace.DeviceRGB, false);
      const raw = pixmapRaw(pix);
      const gray = raw.channels === 1 || raw.channels === 2;
      const scale = Math.min(1, maxPx / Math.max(w, h));
      const tw = Math.max(1, Math.round(w * scale));
      const th = Math.max(1, Math.round(h * scale));
      let pipeline = sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: raw.channels } });
      if (raw.channels === 2 || raw.channels === 4) pipeline = pipeline.removeAlpha();
      if (scale < 1) pipeline = pipeline.resize(tw, th, { kernel: "lanczos3" });
      if (gray) pipeline = pipeline.toColourspace("b-w");
      const jpg = await pipeline.jpeg({ quality, mozjpeg: true, chromaSubsampling: "4:2:0" }).toBuffer();
      const before = o.readRawStream().getLength();
      if (jpg.length >= before * 0.92) continue;
      o.writeRawStream(new Uint8Array(jpg));
      o.put("Filter", doc.newName("DCTDecode"));
      o.delete("DecodeParms");
      o.delete("Decode");
      o.put("Width", tw);
      o.put("Height", th);
      o.put("BitsPerComponent", 8);
      o.put("ColorSpace", doc.newName(gray ? "DeviceGray" : "DeviceRGB"));
      recompressed++;
    }
  }
  const out = doc
    .saveToBuffer({ garbage: "deduplicate", compress: "yes", "compress-images": "yes", "compress-fonts": "yes", objstms: "yes" })
    .asUint8Array()
    .slice();
  return { bytes: out, recompressed, examined };
}

// ------------------------------------------------------------------ security

export function protect(
  bytes: Uint8Array,
  password: string,
  allow: { print: boolean; copy: boolean; edit: boolean },
): Uint8Array {
  if (!password) throw new UserError("Enter a password.");
  if (password.length > 127) throw new UserError("Passwords can be at most 127 characters.");
  const doc = openDoc(bytes);
  // Reserved bits set per ISO 32000; accessibility extraction always allowed.
  let p = 0xfffff0c0 | 512;
  if (allow.print) p |= 4 | 2048;
  if (allow.copy) p |= 16;
  if (allow.edit) p |= 8 | 32 | 256 | 1024;
  // A random owner password: restrictions can't be lifted by guessing; the user password still opens the file.
  const owner = crypto.randomBytes(24).toString("base64url");
  return doc
    .saveToBuffer({ encrypt: "aes-256", "user-password": password, "owner-password": owner, permissions: p | 0, garbage: "yes", compress: "yes" })
    .asUint8Array()
    .slice();
}

export function unlock(bytes: Uint8Array, password: string): Uint8Array {
  let doc: mupdf.PDFDocument;
  try {
    doc = mupdf.Document.openDocument(bytes, "application/pdf").asPDF()!;
  } catch {
    throw new UserError("This PDF couldn't be opened.", "unreadable");
  }
  const enc = doc.getMetaData("encryption") ?? "None";
  if (!doc.needsPassword() && /^none$/i.test(enc)) {
    throw new UserError("This PDF isn't encrypted, so there's nothing to unlock.", "not_encrypted");
  }
  if (doc.needsPassword()) {
    if (!password) throw new UserError("Enter the password that opens this PDF.", "password_required");
    if (!doc.authenticatePassword(password)) throw new UserError("That password isn't correct for this PDF.", "wrong_password");
  } else {
    // Permission-restricted only: lifting restrictions requires the owner password.
    const r = password ? doc.authenticatePassword(password) : 0;
    if (!(r & 4)) {
      throw new UserError(
        "This PDF opens without a password but restricts what you can do with it. Enter its owner (permissions) password to remove the restrictions.",
        "owner_password_required",
      );
    }
  }
  return doc.saveToBuffer({ encrypt: "none", garbage: "yes", compress: "yes" }).asUint8Array().slice();
}

// ------------------------------------------------------------------ repair / flatten

export function repair(bytes: Uint8Array) {
  const doc = openDoc(bytes);
  const pages = doc.countPages();
  // touching every page forces object resolution so broken references surface now
  let unreadable = 0;
  for (let i = 0; i < pages; i++) {
    try {
      doc.loadPage(i).getBounds();
    } catch {
      unreadable++;
    }
  }
  const out = doc.saveToBuffer({ garbage: "compact", compress: "yes" }).asUint8Array().slice();
  return { bytes: out, repaired: doc.wasRepaired(), pages, unreadable };
}

export function flatten(bytes: Uint8Array, forms: boolean, annotations: boolean): Uint8Array {
  if (!forms && !annotations) throw new UserError("Choose form fields, annotations, or both.");
  const doc = openDoc(bytes);
  doc.bake(annotations, forms);
  return doc.saveToBuffer({ garbage: "yes", compress: "yes" }).asUint8Array().slice();
}

// ------------------------------------------------------------------ analysis

const BLANK_THRESHOLDS = { strict: 0.0003, normal: 0.0015, loose: 0.006 } as const;

export async function blankPages(bytes: Uint8Array, sensitivity: keyof typeof BLANK_THRESHOLDS, signal?: AbortSignal) {
  const doc = openDoc(bytes);
  const n = doc.countPages();
  const blank: number[] = [];
  for (let i = 0; i < n; i++) {
    throwIfAborted(signal);
    if (hasTextLayer(doc, i)) continue;
    const pix = renderPage(doc, i, 40);
    const raw = pixmapRaw(pix);
    const { data: gray } = await sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: raw.channels } })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    // compare against the page's median tone so evenly grey scans of empty paper count as blank
    const hist = new Uint32Array(256);
    for (const v of gray) hist[v]++;
    let acc = 0;
    let median = 255;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= gray.length / 2) {
        median = v;
        break;
      }
    }
    let ink = 0;
    for (const v of gray) if (Math.abs(v - median) > 48) ink++;
    if (ink / gray.length <= BLANK_THRESHOLDS[sensitivity]) blank.push(i);
  }
  return { blank, total: n };
}

export interface ExtractedImage {
  data: Uint8Array;
  ext: "jpg" | "png";
  width: number;
  height: number;
}

export function extractImages(bytes: Uint8Array, minSize: number, signal?: AbortSignal): ExtractedImage[] {
  const doc = openDoc(bytes);
  const total = doc.countObjects();
  const masks = new Set<number>();
  for (let num = 1; num < total; num++) {
    const o = doc.newIndirect(num).resolve();
    if (o.isDictionary()) {
      const sm = o.get("SMask");
      if (sm.isIndirect()) masks.add(sm.asIndirect());
    }
  }
  const out: ExtractedImage[] = [];
  for (let num = 1; num < total; num++) {
    throwIfAborted(signal);
    const ref = doc.newIndirect(num);
    const o = ref;
    if (!o.isStream() || nameOf(o.get("Subtype")) !== "Image" || masks.has(num)) continue;
    if (o.get("ImageMask").valueOf() === true) continue;
    let img: mupdf.Image;
    try {
      img = doc.loadImage(ref);
    } catch {
      continue;
    }
    const width = img.getWidth();
    const height = img.getHeight();
    if (width < minSize || height < minSize) continue;
    const f = filters(o);
    const cs = img.getColorSpace();
    if (f.length === 1 && f[0] === "DCTDecode" && cs && (cs.isRGB() || cs.isGray()) && o.get("Decode").isNull()) {
      out.push({ data: o.readRawStream().asUint8Array().slice(), ext: "jpg", width, height });
      continue;
    }
    let pix = img.toPixmap();
    const pcs = pix.getColorSpace();
    if (!pcs || !(pcs.isRGB() || pcs.isGray())) pix = pix.convertToColorSpace(mupdf.ColorSpace.DeviceRGB, false);
    out.push({ data: pix.asPNG().slice(), ext: "png", width, height });
  }
  return out;
}
