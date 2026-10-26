import "server-only";
// Server implementations for the conversion catalog. Adding a format = one catalog entry + one function here.
import fsp from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { marked } from "marked";
import { CONVERSIONS, findConversion, type ConversionDef } from "./catalog";
import { FORMATS, type FormatId } from "@/lib/formats";
import { convertWithLibreOffice, sofficePath } from "@/lib/server/libreoffice";
import { UserError, throwIfAborted } from "@/lib/server/errors";
import { openDoc, renderPage, pixmapRaw, extractText, pdfToHtml, pageToSvg, inspect } from "@/lib/pdf/mu";
import { imagesToPdf } from "@/lib/pdf/ops";
import { pageIndices } from "@/lib/pdf/pages";
import { imageForPdf, convertImage, encodeRaster, type RasterTarget } from "./images";
import { pdfToDocx } from "./pdf-to-docx";
import { baseName } from "@/lib/utils";

export interface ConvertInput {
  path: string;
  name: string;
  format: FormatId;
}

export interface ConvertContext {
  workDir: string;
  signal: AbortSignal;
  options: Record<string, unknown>;
  progress(p: number | null, message?: string): void;
}

export interface ConvertOutput {
  name: string;
  data: Uint8Array;
  mime: string;
}

type Converter = (input: ConvertInput, ctx: ConvertContext) => Promise<ConvertOutput[]>;

const out = (name: string, fmt: FormatId, data: Uint8Array): ConvertOutput => ({ name: `${name}.${FORMATS[fmt].ext}`, data, mime: FORMATS[fmt].mime });

// ------------------------------------------------------------------ LibreOffice family

async function staged(input: ConvertInput, ctx: ConvertContext, ext: string, content?: Uint8Array | string): Promise<string> {
  // Copy to a predictable ASCII name with the right extension; LibreOffice picks its import filter from it.
  const dir = path.join(ctx.workDir, "lo-in");
  await fsp.mkdir(dir, { recursive: true });
  const p = path.join(dir, `input.${ext}`);
  if (content !== undefined) await fsp.writeFile(p, content);
  else await fsp.copyFile(input.path, p);
  return p;
}

async function validatePdf(p: string): Promise<Uint8Array> {
  const bytes = new Uint8Array(await fsp.readFile(p));
  const info = inspect(bytes); // throws if the produced file isn't a readable PDF
  if (!info.pages) throw new UserError("The conversion produced an empty document.", "conversion_failed", 422);
  return bytes;
}

const office: Converter = async (input, ctx) => {
  ctx.progress(null, "Converting with LibreOffice…");
  const src = await staged(input, ctx, FORMATS[input.format].ext);
  const pdf = await convertWithLibreOffice(src, path.join(ctx.workDir, "lo-out"), { convertTo: "pdf", signal: ctx.signal });
  return [out(baseName(input.name), "pdf", await validatePdf(pdf))];
};

const csv: Converter = async (input, ctx) => {
  ctx.progress(null, "Laying out spreadsheet…");
  const src = await staged(input, ctx, "csv");
  // 44 = comma, 34 = double quote, 76 = UTF-8, 1 = start row
  const pdf = await convertWithLibreOffice(src, path.join(ctx.workDir, "lo-out"), { convertTo: "pdf", infilter: "CSV:44,34,76,1", signal: ctx.signal });
  return [out(baseName(input.name), "pdf", await validatePdf(pdf))];
};

const text: Converter = async (input, ctx) => {
  ctx.progress(null, "Typesetting text…");
  const src = await staged(input, ctx, "txt");
  const pdf = await convertWithLibreOffice(src, path.join(ctx.workDir, "lo-out"), { convertTo: "pdf", infilter: "Text (encoded):UTF8,LF,,,", signal: ctx.signal });
  return [out(baseName(input.name), "pdf", await validatePdf(pdf))];
};

/** Removes active content and anything that would make LibreOffice fetch remote URLs. */
export function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<(iframe|object|embed|frame|frameset|applet|link|meta|base)\b[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(src|href|background|poster|srcset)\s*=\s*("|')\s*(?:https?:|file:|ftp:|\/\/|javascript:)[^"']*\2/gi, "")
    .replace(/url\(\s*(['"]?)\s*(?:https?:|file:|ftp:|\/\/)[^)]*\)/gi, "none")
    .replace(/@import[^;]+;/gi, "");
}

const HTML_STYLE = `<style>
body{font-family:"DejaVu Sans","Liberation Sans",Arial,sans-serif;font-size:11pt;line-height:1.45;color:#1d1d1f}
h1{font-size:22pt}h2{font-size:16pt}h3{font-size:13pt}
code,pre{font-family:"DejaVu Sans Mono","Liberation Mono",monospace;font-size:9.5pt}
pre{background:#f2f2f4;padding:8pt}
table{border-collapse:collapse}td,th{border:0.5pt solid #bbb;padding:3pt 6pt}
blockquote{color:#555;border-left:2pt solid #ccc;padding-left:8pt}
</style>`;

const html: Converter = async (input, ctx) => {
  ctx.progress(null, "Rendering HTML…");
  const raw = await fsp.readFile(input.path, "utf8");
  const src = await staged(input, ctx, "html", sanitizeHtml(raw));
  const pdf = await convertWithLibreOffice(src, path.join(ctx.workDir, "lo-out"), { convertTo: "pdf:writer_web_pdf_Export", signal: ctx.signal });
  return [out(baseName(input.name), "pdf", await validatePdf(pdf))];
};

const markdown: Converter = async (input, ctx) => {
  ctx.progress(null, "Rendering Markdown…");
  const md = await fsp.readFile(input.path, "utf8");
  const body = await marked.parse(md, { gfm: true, async: true });
  const doc = `<!doctype html><html><head><meta charset="utf-8"><title>${baseName(input.name).replace(/[<>&]/g, "")}</title>${HTML_STYLE}</head><body>${sanitizeHtml(body)}</body></html>`;
  const src = await staged(input, ctx, "html", doc);
  const pdf = await convertWithLibreOffice(src, path.join(ctx.workDir, "lo-out"), { convertTo: "pdf:writer_web_pdf_Export", signal: ctx.signal });
  return [out(baseName(input.name), "pdf", await validatePdf(pdf))];
};

// ------------------------------------------------------------------ PDF sources

const pdfToRaster =
  (to: RasterTarget): Converter =>
  async (input, ctx) => {
    const bytes = new Uint8Array(await fsp.readFile(input.path));
    const doc = openDoc(bytes);
    const n = doc.countPages();
    const dpi = Math.min(600, Math.max(36, Number(ctx.options.dpi) || 150));
    const idx = pageIndices(ctx.options.pages as string | undefined, n);
    const results: ConvertOutput[] = [];
    const pad = String(n).length;
    for (let k = 0; k < idx.length; k++) {
      throwIfAborted(ctx.signal);
      ctx.progress(k / idx.length, `Rendering page ${idx[k] + 1} of ${n}…`);
      const raw = pixmapRaw(renderPage(doc, idx[k], dpi));
      const data = await encodeRaster(sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: raw.channels } }), to, dpi);
      results.push(out(`${baseName(input.name)}-page-${String(idx[k] + 1).padStart(pad, "0")}`, to, data));
    }
    return results;
  };

const pdfToSvg: Converter = async (input, ctx) => {
  const doc = openDoc(new Uint8Array(await fsp.readFile(input.path)));
  const n = doc.countPages();
  const idx = pageIndices(ctx.options.pages as string | undefined, n);
  const pad = String(n).length;
  return idx.map((i, k) => {
    throwIfAborted(ctx.signal);
    ctx.progress(k / idx.length, `Converting page ${i + 1} of ${n}…`);
    return out(`${baseName(input.name)}-page-${String(i + 1).padStart(pad, "0")}`, "svg", pageToSvg(doc, i));
  });
};

const pdfToTxt: Converter = async (input, ctx) => {
  const r = extractText(new Uint8Array(await fsp.readFile(input.path)), false, ctx.signal, (i, n) => ctx.progress(i / n, `Reading page ${i} of ${n}…`));
  if (r.chars === 0) throw new UserError("No text found. This PDF is probably a scan — run OCR PDF to recognise its text.", "no_text");
  return [out(baseName(input.name), "txt", new TextEncoder().encode(r.text))];
};

const pdfToHtmlConv: Converter = async (input, ctx) => {
  ctx.progress(null, "Converting to HTML…");
  return [out(baseName(input.name), "html", pdfToHtml(new Uint8Array(await fsp.readFile(input.path))))];
};

const pdfToWord: Converter = async (input, ctx) => {
  if (ctx.options.docxMode === "layout") {
    ctx.progress(null, "Converting with LibreOffice (exact layout)…");
    const src = await staged(input, ctx, "pdf");
    const docx = await convertWithLibreOffice(src, path.join(ctx.workDir, "lo-out"), {
      // passed as a single argv entry (no shell), so no quoting around the filter name
      convertTo: "docx:MS Word 2007 XML",
      infilter: "writer_pdf_import",
      signal: ctx.signal,
    });
    return [out(baseName(input.name), "docx", new Uint8Array(await fsp.readFile(docx)))];
  }
  const r = await pdfToDocx(new Uint8Array(await fsp.readFile(input.path)), ctx.signal, (i, n) => ctx.progress(i / n, `Reading page ${i} of ${n}…`));
  return [out(baseName(input.name), "docx", r.bytes)];
};

// ------------------------------------------------------------------ image sources

const imageToPdf: Converter = async (input, ctx) => {
  ctx.progress(null, "Creating PDF…");
  const img = await imageForPdf(new Uint8Array(await fsp.readFile(input.path)));
  const pdf = await imagesToPdf([img], { pageSize: "fit", orientation: "auto", margin: 0 });
  return [out(baseName(input.name), "pdf", pdf)];
};

const imageTo =
  (to: RasterTarget): Converter =>
  async (input, ctx) => {
    ctx.progress(null, `Converting to ${FORMATS[to].label}…`);
    return [out(baseName(input.name), to, await convertImage(new Uint8Array(await fsp.readFile(input.path)), to))];
  };

// ------------------------------------------------------------------ registry

const IMPLEMENTATIONS: Record<string, Converter> = {
  "document-to-pdf": office,
  "slides-to-pdf": office,
  "sheet-to-pdf": office,
  "csv-to-pdf": csv,
  "text-to-pdf": text,
  "html-to-pdf": html,
  "markdown-to-pdf": markdown,
  "image-to-pdf": imageToPdf,
  "pdf-to-jpg": pdfToRaster("jpg"),
  "pdf-to-png": pdfToRaster("png"),
  "pdf-to-webp": pdfToRaster("webp"),
  "pdf-to-tiff": pdfToRaster("tiff"),
  "pdf-to-svg": pdfToSvg,
  "pdf-to-txt": pdfToTxt,
  "pdf-to-html": pdfToHtmlConv,
  "pdf-to-docx": pdfToWord,
  "image-to-jpg": imageTo("jpg"),
  "image-to-png": imageTo("png"),
  "image-to-webp": imageTo("webp"),
  "image-to-tiff": imageTo("tiff"),
};

// Fail fast at startup if the catalog and implementations drift apart.
for (const c of CONVERSIONS) {
  if (!IMPLEMENTATIONS[c.id]) throw new Error(`conversion ${c.id} has no implementation`);
}

export function conversionAvailable(def: ConversionDef): boolean {
  return def.requires !== "libreoffice" || !!sofficePath();
}

export async function convert(input: ConvertInput, to: FormatId, ctx: ConvertContext): Promise<ConvertOutput[]> {
  const def = findConversion(input.format, to);
  if (!def) {
    throw new UserError(`Converting ${FORMATS[input.format].label} to ${FORMATS[to]?.label ?? to} isn't supported.`, "unsupported_conversion");
  }
  if (!conversionAvailable(def)) {
    throw new UserError(
      `${FORMATS[input.format].label} → ${FORMATS[to].label} needs LibreOffice, which isn't configured on this server.`,
      "engine_unavailable",
      503,
    );
  }
  // PDF→Word exact layout also needs LibreOffice
  if (def.id === "pdf-to-docx" && ctx.options.docxMode === "layout" && !sofficePath()) {
    throw new UserError("Exact-layout PDF → Word needs LibreOffice, which isn't configured on this server.", "engine_unavailable", 503);
  }
  return IMPLEMENTATIONS[def.id](input, ctx);
}
