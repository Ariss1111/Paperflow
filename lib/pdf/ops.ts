// Page-level PDF operations built on pdf-lib. Pure: bytes in, bytes out.
import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFArray,
  PDFNumber,
  PDFString,
  PDFHexString,
  PDFRef,
  degrees,
  rgb,
  type PDFPage,
  type PDFFont,
} from "pdf-lib";
import { UserError } from "@/lib/server/errors";
import { embedFont, drawable } from "@/lib/server/fonts";
import { parseRanges, pageIndices, type PageRange } from "./pages";

export const MM = 72 / 25.4;

export const PAGE_SIZES: Record<string, [number, number]> = {
  a3: [841.89, 1190.55],
  a4: [595.28, 841.89],
  a5: [419.53, 595.28],
  letter: [612, 792],
  legal: [612, 1008],
};

export async function load(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    const msg = String((e as Error)?.message ?? "");
    if (/encrypt/i.test(msg)) {
      throw new UserError("This PDF is password-protected. Unlock it first with the Unlock PDF tool.", "encrypted");
    }
    throw new UserError("This PDF couldn't be read. It may be damaged — try Repair PDF first.", "unreadable");
  }
}

async function save(doc: PDFDocument): Promise<Uint8Array> {
  return doc.save({ useObjectStreams: true });
}

export function hexToRgb(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  const n = m ? Number.parseInt(m[1], 16) : 0;
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

// ------------------------------------------------------------------ assemble

export async function merge(sources: Uint8Array[]): Promise<Uint8Array> {
  if (sources.length < 2) throw new UserError("Add at least two PDFs to merge.");
  const out = await PDFDocument.create();
  for (const bytes of sources) {
    const src = await load(bytes);
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  return save(out);
}

export async function pick(bytes: Uint8Array, indices: number[]): Promise<Uint8Array> {
  const src = await load(bytes);
  if (indices.length === 0) throw new UserError("The result would have no pages.");
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, indices);
  pages.forEach((p) => out.addPage(p));
  copyInfo(src, out);
  return save(out);
}

function copyInfo(src: PDFDocument, out: PDFDocument) {
  const title = src.getTitle();
  const author = src.getAuthor();
  if (title) out.setTitle(title);
  if (author) out.setAuthor(author);
}

export async function pageCount(bytes: Uint8Array): Promise<number> {
  return (await load(bytes)).getPageCount();
}

export async function splitByRanges(bytes: Uint8Array, spec: string): Promise<{ range: PageRange; bytes: Uint8Array }[]> {
  const total = await pageCount(bytes);
  const ranges = parseRanges(spec, total);
  const out = [];
  for (const range of ranges) {
    const idx = Array.from({ length: range.end - range.start + 1 }, (_, i) => range.start - 1 + i);
    out.push({ range, bytes: await pick(bytes, idx) });
  }
  return out;
}

export async function splitEvery(bytes: Uint8Array, chunk = 1): Promise<{ range: PageRange; bytes: Uint8Array }[]> {
  const total = await pageCount(bytes);
  const out = [];
  for (let s = 1; s <= total; s += chunk) {
    const e = Math.min(total, s + chunk - 1);
    const idx = Array.from({ length: e - s + 1 }, (_, i) => s - 1 + i);
    out.push({ range: { start: s, end: e }, bytes: await pick(bytes, idx) });
  }
  return out;
}

export async function deletePages(bytes: Uint8Array, spec: string): Promise<Uint8Array> {
  const total = await pageCount(bytes);
  const drop = new Set(pageIndices(spec, total));
  const keep = Array.from({ length: total }, (_, i) => i).filter((i) => !drop.has(i));
  if (keep.length === 0) throw new UserError("You can't delete every page.");
  return pick(bytes, keep);
}

export async function rotate(bytes: Uint8Array, angle: number, spec?: string): Promise<Uint8Array> {
  if (![90, 180, 270, -90].includes(angle)) throw new UserError("Rotation must be 90, 180 or 270 degrees.");
  const doc = await load(bytes);
  for (const i of pageIndices(spec, doc.getPageCount())) {
    const p = doc.getPage(i);
    p.setRotation(degrees((((p.getRotation().angle + angle) % 360) + 360) % 360));
  }
  return save(doc);
}

export interface PlanItem {
  /** index into sources */
  src: number;
  /** zero-based page index in that source */
  page: number;
  /** additional clockwise rotation */
  rotate?: number;
}

/** Builds a new document from an explicit page plan (reorder / duplicate / delete / insert from other PDFs). */
export async function assemble(sources: Uint8Array[], plan: PlanItem[]): Promise<Uint8Array> {
  if (!Array.isArray(plan) || plan.length === 0) throw new UserError("The result would have no pages.");
  if (plan.length > 5000) throw new UserError("Too many pages.");
  const docs = await Promise.all(sources.map(load));
  const out = await PDFDocument.create();
  for (const item of plan) {
    const src = docs[item.src];
    if (!src || !Number.isInteger(item.page) || item.page < 0 || item.page >= src.getPageCount()) {
      throw new UserError("The page plan refers to a page that doesn't exist.");
    }
    const [p] = await out.copyPages(src, [item.page]);
    const r = Number(item.rotate || 0);
    if (r % 90 !== 0) throw new UserError("Rotation must be a multiple of 90°.");
    if (r) p.setRotation(degrees((((p.getRotation().angle + r) % 360) + 360) % 360));
    out.addPage(p);
  }
  if (docs[0]) copyInfo(docs[0], out);
  return save(out);
}

// ------------------------------------------------------------------ stamping

/** Visible page box, accounting for crop box offsets. */
function box(page: PDFPage) {
  const b = page.getCropBox();
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}

/**
 * Converts a position given in the page's *visual* orientation into PDF user space,
 * so stamps stay upright on rotated pages.
 */
function placeText(page: PDFPage, font: PDFFont, text: string, size: number, pos: string, margin: number) {
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  const b = box(page);
  const vw = rot % 180 === 0 ? b.w : b.h;
  const vh = rot % 180 === 0 ? b.h : b.w;
  const tw = font.widthOfTextAtSize(text, size);
  const th = font.heightAtSize(size, { descender: false });
  const [vert, horiz] = pos.split("-");
  let vx = horiz === "left" ? margin : horiz === "right" ? vw - margin - tw : (vw - tw) / 2;
  let vy = vert === "top" ? vh - margin - th : margin;
  if (pos === "center") {
    vx = (vw - tw) / 2;
    vy = (vh - th) / 2;
  }
  const { x, y } = visualToUser(b, rot, vx, vy);
  return { x, y, rotate: degrees(rot) };
}

/**
 * /Rotate turns the page clockwise for display. Maps a point measured from the *displayed*
 * bottom-left corner back to unrotated user space.
 */
export function visualToUser(b: { x: number; y: number; w: number; h: number }, rot: number, vx: number, vy: number) {
  switch (rot) {
    case 90:
      return { x: b.x + b.w - vy, y: b.y + vx };
    case 180:
      return { x: b.x + b.w - vx, y: b.y + b.h - vy };
    case 270:
      return { x: b.x + vy, y: b.y + b.h - vx };
    default:
      return { x: b.x + vx, y: b.y + vy };
  }
}

export interface WatermarkOptions {
  text: string;
  size: number;
  color: string;
  opacity: number; // 0..1
  angle: number;
  position: string;
  behind?: boolean;
  pages?: string;
}

export async function watermark(bytes: Uint8Array, o: WatermarkOptions): Promise<{ bytes: Uint8Array; dropped: number }> {
  if (!o.text?.trim()) throw new UserError("Enter watermark text.");
  const doc = await load(bytes);
  const font = await embedFont(doc, "sans", true);
  const { text, dropped } = drawable(font, o.text.trim());
  const color = hexToRgb(o.color);
  for (const i of pageIndices(o.pages, doc.getPageCount())) {
    const page = doc.getPage(i);
    const b = box(page);
    const tw = font.widthOfTextAtSize(text, o.size);
    const angle = o.angle + pageRot(page);
    const rad = (angle * Math.PI) / 180;
    const draw = (cx: number, cy: number) => {
      // pdf-lib rotates around the baseline origin; offset so the text is centred on (cx, cy)
      const x = cx - (Math.cos(rad) * tw) / 2 + Math.sin(rad) * o.size * 0.35;
      const y = cy - (Math.sin(rad) * tw) / 2 - Math.cos(rad) * o.size * 0.35;
      page.drawText(text, { x, y, size: o.size, font, color, opacity: o.opacity, rotate: degrees(angle) });
    };
    if (o.position === "tile") {
      const stepX = tw + o.size * 3;
      const stepY = o.size * 5;
      for (let y = b.y; y < b.y + b.h + stepY; y += stepY) {
        for (let x = b.x - stepX / 2; x < b.x + b.w + stepX; x += stepX) draw(x, y);
      }
    } else if (o.position === "center") {
      draw(b.x + b.w / 2, b.y + b.h / 2);
    } else {
      const p = placeText(page, font, text, o.size, o.position, 36);
      page.drawText(text, { x: p.x, y: p.y, size: o.size, font, color, opacity: o.opacity, rotate: p.rotate });
    }
    if (o.behind) moveLastContentToBack(page);
  }
  return { bytes: await save(doc), dropped };
}

function pageRot(page: PDFPage): number {
  return ((page.getRotation().angle % 360) + 360) % 360;
}

/** pdf-lib appends drawing as the last content stream; moving it first places it behind existing content. */
function moveLastContentToBack(page: PDFPage) {
  const contents = page.node.Contents();
  if (contents instanceof PDFArray && contents.size() > 1) {
    const last = contents.get(contents.size() - 1);
    contents.remove(contents.size() - 1);
    contents.insert(0, last);
  }
}

export interface PageNumberOptions {
  position: string;
  format: string;
  start: number;
  size: number;
  margin: number;
  pages?: string;
}

export async function pageNumbers(bytes: Uint8Array, o: PageNumberOptions): Promise<Uint8Array> {
  const doc = await load(bytes);
  const font = await embedFont(doc, "sans");
  const total = doc.getPageCount();
  const indices = pageIndices(o.pages, total);
  const fmt = o.format?.trim() || "{n}";
  indices.forEach((i, k) => {
    const page = doc.getPage(i);
    const label = drawable(font, fmt.replaceAll("{n}", String(o.start + k)).replaceAll("{total}", String(o.start + indices.length - 1))).text;
    const p = placeText(page, font, label, o.size, o.position, o.margin);
    page.drawText(label, { x: p.x, y: p.y, size: o.size, font, color: rgb(0.2, 0.2, 0.22), rotate: p.rotate });
  });
  return save(doc);
}

export interface HeaderFooterOptions {
  header?: string;
  footer?: string;
  align: "left" | "center" | "right";
  size: number;
  color: string;
  margin: number;
  pages?: string;
  filename?: string;
}

export async function headerFooter(bytes: Uint8Array, o: HeaderFooterOptions): Promise<Uint8Array> {
  if (!o.header?.trim() && !o.footer?.trim()) throw new UserError("Enter a header, a footer, or both.");
  const doc = await load(bytes);
  const font = await embedFont(doc, "sans");
  const total = doc.getPageCount();
  const date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const color = hexToRgb(o.color);
  const fill = (t: string, n: number) =>
    drawable(font, t.replaceAll("{n}", String(n)).replaceAll("{total}", String(total)).replaceAll("{date}", date).replaceAll("{filename}", o.filename ?? "")).text;
  for (const i of pageIndices(o.pages, total)) {
    const page = doc.getPage(i);
    for (const [text, vert] of [
      [o.header, "top"],
      [o.footer, "bottom"],
    ] as const) {
      if (!text?.trim()) continue;
      const label = fill(text.trim(), i + 1);
      const p = placeText(page, font, label, o.size, `${vert}-${o.align === "center" ? "center" : o.align}`, o.margin);
      page.drawText(label, { x: p.x, y: p.y, size: o.size, font, color, rotate: p.rotate });
    }
  }
  return save(doc);
}

// ------------------------------------------------------------------ geometry

export async function crop(
  bytes: Uint8Array,
  m: { top: number; right: number; bottom: number; left: number },
  spec?: string,
): Promise<Uint8Array> {
  const doc = await load(bytes);
  for (const i of pageIndices(spec, doc.getPageCount())) {
    const page = doc.getPage(i);
    const b = box(page);
    // margins are given visually; map them onto the unrotated box
    const rot = ((page.getRotation().angle % 360) + 360) % 360;
    const vis = [m.top, m.right, m.bottom, m.left].map((v) => Math.max(0, v) * MM);
    const shift = rot / 90; // top,right,bottom,left rotate with the page
    const [t, r, bo, l] = [0, 1, 2, 3].map((k) => vis[(k + shift) % 4]);
    const w = b.w - l - r;
    const h = b.h - t - bo;
    if (w < 36 || h < 36) throw new UserError(`The margins leave less than 1.3 cm of page ${i + 1}. Use smaller values.`);
    page.setCropBox(b.x + l, b.y + bo, w, h);
    page.setTrimBox(b.x + l, b.y + bo, w, h);
  }
  return save(doc);
}

export async function resize(bytes: Uint8Array, size: string, orientation: string): Promise<{ bytes: Uint8Array; hadAnnots: boolean }> {
  const dims = PAGE_SIZES[size];
  if (!dims) throw new UserError("Unknown page size.");
  const src = await load(bytes);
  const out = await PDFDocument.create();
  let hadAnnots = false;
  for (let i = 0; i < src.getPageCount(); i++) {
    const sp = src.getPage(i);
    if (sp.node.Annots()?.size()) hadAnnots = true;
    const rot = ((sp.getRotation().angle % 360) + 360) % 360;
    const b = box(sp);
    const vw = rot % 180 === 0 ? b.w : b.h;
    const vh = rot % 180 === 0 ? b.h : b.w;
    let [W, H] = dims;
    const landscape = orientation === "landscape" || (orientation === "auto" && vw > vh);
    if (landscape) [W, H] = [H, W];
    const embedded = await out.embedPage(sp, { left: b.x, bottom: b.y, right: b.x + b.w, top: b.y + b.h });
    const scale = Math.min(W / vw, H / vh);
    const page = out.addPage([W, H]);
    const dw = vw * scale;
    const dh = vh * scale;
    const ox = (W - dw) / 2;
    const oy = (H - dh) / 2;
    // place the embedded (unrotated) page so it appears with its original visual orientation
    const opts = { xScale: scale, yScale: scale } as const;
    switch (rot) {
      case 90:
        page.drawPage(embedded, { ...opts, x: ox, y: oy + dh, rotate: degrees(-90) });
        break;
      case 180:
        page.drawPage(embedded, { ...opts, x: ox + dw, y: oy + dh, rotate: degrees(180) });
        break;
      case 270:
        page.drawPage(embedded, { ...opts, x: ox + dw, y: oy, rotate: degrees(90) });
        break;
      default:
        page.drawPage(embedded, { ...opts, x: ox, y: oy });
    }
  }
  copyInfo(src, out);
  return { bytes: await save(out), hadAnnots };
}

// ------------------------------------------------------------------ images

export interface ImagePage {
  bytes: Uint8Array;
  kind: "jpg" | "png";
}

export async function imagesToPdf(
  images: ImagePage[],
  o: { pageSize: string; orientation: string; margin: number },
): Promise<Uint8Array> {
  if (images.length === 0) throw new UserError("Add at least one image.");
  const doc = await PDFDocument.create();
  for (const img of images) {
    const embedded = img.kind === "jpg" ? await doc.embedJpg(img.bytes) : await doc.embedPng(img.bytes);
    const { width: iw, height: ih } = embedded;
    if (o.pageSize === "fit" || !PAGE_SIZES[o.pageSize]) {
      // 1 px = 0.75 pt (96 dpi) keeps typical photos at a sensible physical size
      const w = iw * 0.75;
      const h = ih * 0.75;
      const page = doc.addPage([w, h]);
      page.drawImage(embedded, { x: 0, y: 0, width: w, height: h });
      continue;
    }
    let [W, H] = PAGE_SIZES[o.pageSize];
    const landscape = o.orientation === "landscape" || (o.orientation === "auto" && iw > ih);
    if (landscape) [W, H] = [H, W];
    const m = Math.max(0, Math.min(o.margin || 0, Math.min(W, H) / 3));
    const s = Math.min((W - 2 * m) / iw, (H - 2 * m) / ih);
    const page = doc.addPage([W, H]);
    page.drawImage(embedded, { x: (W - iw * s) / 2, y: (H - ih * s) / 2, width: iw * s, height: ih * s });
  }
  return save(doc);
}

// ------------------------------------------------------------------ metadata

export interface Metadata {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  creator?: string;
  producer?: string;
  creationDate?: string;
  modificationDate?: string;
  pages: number;
  pdfVersion?: string;
  hasXmp: boolean;
  pageSize?: string;
}

export async function readMetadata(bytes: Uint8Array): Promise<Metadata> {
  const doc = await load(bytes);
  const header = new TextDecoder("latin1").decode(bytes.subarray(0, 16));
  const p0 = doc.getPageCount() ? doc.getPage(0) : null;
  return {
    title: doc.getTitle(),
    author: doc.getAuthor(),
    subject: doc.getSubject(),
    keywords: doc.getKeywords(),
    creator: doc.getCreator(),
    producer: doc.getProducer(),
    creationDate: doc.getCreationDate()?.toISOString(),
    modificationDate: doc.getModificationDate()?.toISOString(),
    pages: doc.getPageCount(),
    pdfVersion: /%PDF-(\d\.\d)/.exec(header)?.[1],
    hasXmp: !!doc.catalog.get(PDFName.of("Metadata")),
    pageSize: p0 ? `${Math.round(p0.getWidth())} × ${Math.round(p0.getHeight())} pt` : undefined,
  };
}

export async function writeMetadata(
  bytes: Uint8Array,
  m: { title?: string; author?: string; subject?: string; keywords?: string },
): Promise<Uint8Array> {
  const doc = await load(bytes);
  if (m.title !== undefined) doc.setTitle(m.title);
  if (m.author !== undefined) doc.setAuthor(m.author);
  if (m.subject !== undefined) doc.setSubject(m.subject);
  if (m.keywords !== undefined) doc.setKeywords(m.keywords.split(/[,;]/).map((s) => s.trim()).filter(Boolean));
  doc.setModificationDate(new Date());
  // XMP would otherwise contradict the edited Info dictionary in some viewers
  doc.catalog.delete(PDFName.of("Metadata"));
  return save(doc);
}

export async function stripMetadata(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await load(bytes);
  doc.catalog.delete(PDFName.of("Metadata"));
  const infoRef = doc.context.trailerInfo.Info;
  if (infoRef) {
    const info = doc.context.lookup(infoRef);
    if (info instanceof PDFDict) for (const k of info.keys()) info.delete(k);
  }
  // per-page XMP / PieceInfo
  for (const page of doc.getPages()) {
    page.node.delete(PDFName.of("Metadata"));
    page.node.delete(PDFName.of("PieceInfo"));
  }
  return doc.save({ useObjectStreams: true, updateFieldAppearances: false });
}

// ------------------------------------------------------------------ outline

export interface OutlineEntry {
  title: string;
  page: number; // 1-based
  depth: number;
}

export function parseOutline(text: string, total: number): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, n) => {
    if (!raw.trim()) return;
    const depth = Math.floor((raw.match(/^\s*/)![0].replace(/\t/g, "  ").length) / 2);
    const m = /^(.*?)\s*\|\s*(\d+)\s*$/.exec(raw.trim());
    if (!m) throw new UserError(`Line ${n + 1}: write it as “Title | page”.`);
    const page = Number.parseInt(m[2], 10);
    if (page < 1 || page > total) throw new UserError(`Line ${n + 1}: page ${page} doesn't exist (the document has ${total}).`);
    const prevDepth = entries.length ? entries[entries.length - 1].depth : -1;
    entries.push({ title: m[1].slice(0, 300), page, depth: Math.min(depth, prevDepth + 1) });
  });
  if (!entries.length) throw new UserError("Add at least one bookmark.");
  return entries;
}

export async function setOutline(bytes: Uint8Array, text: string): Promise<{ bytes: Uint8Array; count: number }> {
  const doc = await load(bytes);
  const entries = parseOutline(text, doc.getPageCount());
  const ctx = doc.context;
  const rootRef = ctx.nextRef();
  type Node = { entry: OutlineEntry; ref: PDFRef; children: Node[] };
  const root: Node[] = [];
  const stack: Node[] = [];
  for (const entry of entries) {
    const node: Node = { entry, ref: ctx.nextRef(), children: [] };
    while (stack.length > entry.depth) stack.pop();
    (stack.length ? stack[stack.length - 1].children : root).push(node);
    stack.push(node);
  }
  const countAll = (nodes: Node[]): number => nodes.reduce((s, n) => s + 1 + countAll(n.children), 0);
  const write = (nodes: Node[], parent: PDFRef) => {
    nodes.forEach((n, i) => {
      const pageRef = doc.getPage(n.entry.page - 1).ref;
      const dict = ctx.obj({
        Title: PDFHexString.fromText(n.entry.title),
        Parent: parent,
        Dest: ctx.obj([pageRef, PDFName.of("Fit")]),
      }) as PDFDict;
      if (i > 0) dict.set(PDFName.of("Prev"), nodes[i - 1].ref);
      if (i < nodes.length - 1) dict.set(PDFName.of("Next"), nodes[i + 1].ref);
      if (n.children.length) {
        dict.set(PDFName.of("First"), n.children[0].ref);
        dict.set(PDFName.of("Last"), n.children[n.children.length - 1].ref);
        dict.set(PDFName.of("Count"), PDFNumber.of(countAll(n.children)));
        write(n.children, n.ref);
      }
      ctx.assign(n.ref, dict);
    });
  };
  write(root, rootRef);
  ctx.assign(
    rootRef,
    ctx.obj({
      Type: "Outlines",
      First: root[0].ref,
      Last: root[root.length - 1].ref,
      Count: PDFNumber.of(countAll(root)),
    }),
  );
  doc.catalog.set(PDFName.of("Outlines"), rootRef);
  doc.catalog.set(PDFName.of("PageMode"), PDFName.of("UseOutlines"));
  return { bytes: await save(doc), count: entries.length };
}

// ------------------------------------------------------------------ forms

export interface FormFieldInfo {
  name: string;
  type: "text" | "checkbox" | "radio" | "dropdown" | "optionlist" | "button" | "signature" | "unknown";
  value: string | boolean | string[];
  options?: string[];
  multiline?: boolean;
  readOnly: boolean;
  required: boolean;
  maxLength?: number;
}

export async function readForm(bytes: Uint8Array): Promise<{ fields: FormFieldInfo[]; xfa: boolean }> {
  const doc = await load(bytes);
  const form = doc.getForm();
  const acro = doc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
  const xfa = !!acro?.get(PDFName.of("XFA"));
  const fields: FormFieldInfo[] = form.getFields().map((f) => {
    const kind = f.constructor.name;
    const base = { name: f.getName(), readOnly: f.isReadOnly(), required: f.isRequired() };
    const anyF = f as unknown as Record<string, (...a: unknown[]) => unknown>;
    switch (kind) {
      case "PDFTextField":
        return {
          ...base,
          type: "text",
          value: (anyF.getText() as string | undefined) ?? "",
          multiline: anyF.isMultiline() as boolean,
          maxLength: anyF.getMaxLength() as number | undefined,
        };
      case "PDFCheckBox":
        return { ...base, type: "checkbox", value: anyF.isChecked() as boolean };
      case "PDFRadioGroup":
        return { ...base, type: "radio", value: (anyF.getSelected() as string | undefined) ?? "", options: anyF.getOptions() as string[] };
      case "PDFDropdown":
        return { ...base, type: "dropdown", value: (anyF.getSelected() as string[])[0] ?? "", options: anyF.getOptions() as string[] };
      case "PDFOptionList":
        return { ...base, type: "optionlist", value: anyF.getSelected() as string[], options: anyF.getOptions() as string[] };
      case "PDFButton":
        return { ...base, type: "button", value: "" };
      case "PDFSignature":
        return { ...base, type: "signature", value: "" };
      default:
        return { ...base, type: "unknown", value: "" };
    }
  });
  return { fields, xfa };
}

export async function fillForm(
  bytes: Uint8Array,
  values: Record<string, string | boolean | string[]>,
  flatten: boolean,
): Promise<{ bytes: Uint8Array; filled: number }> {
  const doc = await load(bytes);
  const form = doc.getForm();
  const font = await embedFont(doc, "sans");
  let filled = 0;
  for (const [name, value] of Object.entries(values ?? {})) {
    let f;
    try {
      f = form.getField(name);
    } catch {
      throw new UserError(`The form has no field named “${name}”.`);
    }
    if (f.isReadOnly()) continue;
    const anyF = f as unknown as Record<string, (...a: unknown[]) => unknown>;
    switch (f.constructor.name) {
      case "PDFTextField": {
        const max = anyF.getMaxLength() as number | undefined;
        const text = drawable(font, String(value ?? "")).text;
        anyF.setText(max ? text.slice(0, max) : text);
        break;
      }
      case "PDFCheckBox":
        if (value === true || value === "true") anyF.check();
        else anyF.uncheck();
        break;
      case "PDFRadioGroup":
        if (value) anyF.select(String(value));
        break;
      case "PDFDropdown":
        if (value) anyF.select(String(value));
        break;
      case "PDFOptionList":
        if (Array.isArray(value)) anyF.select(value);
        break;
      default:
        continue;
    }
    filled++;
  }
  form.updateFieldAppearances(font);
  if (flatten) form.flatten({ updateFieldAppearances: false });
  return { bytes: await save(doc), filled };
}

export { PDFString };
