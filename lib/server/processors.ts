import "server-only";
import fsp from "node:fs/promises";
import sharp from "sharp";
import * as ops from "@/lib/pdf/ops";
import * as mu from "@/lib/pdf/mu";
import { applyEdits } from "@/lib/pdf/edit";
import { describeRange, pageIndices } from "@/lib/pdf/pages";
import { convert } from "@/lib/conversion/registry";
import { imageForPdf } from "@/lib/conversion/images";
import { ocrPdf, ocrImage } from "./ocr";
import { UserError, throwIfAborted } from "./errors";
import { FORMATS, IMAGE_INPUTS, type FormatId } from "@/lib/formats";
import { baseName, formatBytes } from "@/lib/utils";
import type { EditDocument } from "@/lib/editor/model";

export interface InputFile {
  id: string;
  name: string;
  format: FormatId;
  path: string;
  size: number;
  read(): Promise<Uint8Array>;
}

export interface ProcessContext {
  inputs: InputFile[];
  options: Record<string, unknown>;
  workDir: string;
  signal: AbortSignal;
  progress(p: number | null, message?: string): void;
  emit(name: string, data: Uint8Array, mime: string): Promise<void>;
  summary: Record<string, string | number | boolean>;
  notes: string[];
}

export type Processor = (ctx: ProcessContext) => Promise<void>;

// ------------------------------------------------------------------ option helpers

const str = (o: Record<string, unknown>, k: string, d = ""): string => (typeof o[k] === "string" ? (o[k] as string) : d);
const num = (o: Record<string, unknown>, k: string, d: number, min: number, max: number): number => {
  const v = Number(o[k]);
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d;
};
const bool = (o: Record<string, unknown>, k: string, d: boolean): boolean => (typeof o[k] === "boolean" ? (o[k] as boolean) : d);
const oneOf = <T extends string>(o: Record<string, unknown>, k: string, allowed: readonly T[], d: T): T =>
  allowed.includes(o[k] as T) ? (o[k] as T) : d;

const PDF = FORMATS.pdf.mime;

async function eachPdf(ctx: ProcessContext, fn: (bytes: Uint8Array, input: InputFile, i: number) => Promise<void>) {
  for (let i = 0; i < ctx.inputs.length; i++) {
    throwIfAborted(ctx.signal);
    const input = ctx.inputs[i];
    ctx.progress(ctx.inputs.length > 1 ? i / ctx.inputs.length : null, ctx.inputs.length > 1 ? `Processing ${input.name}…` : "Processing document…");
    await fn(await input.read(), input, i);
  }
}

// ------------------------------------------------------------------ processors

export const PROCESSORS: Record<string, Processor> = {
  async merge(ctx) {
    ctx.progress(null, "Merging documents…");
    const sources = await Promise.all(ctx.inputs.map((f) => f.read()));
    const out = await ops.merge(sources);
    ctx.summary.files = ctx.inputs.length;
    ctx.summary.pages = await ops.pageCount(out);
    await ctx.emit("merged.pdf", out, PDF);
  },

  async split(ctx) {
    const [input] = ctx.inputs;
    const bytes = await input.read();
    const mode = oneOf(ctx.options, "mode", ["ranges", "every", "chunks"] as const, "ranges");
    const stem = baseName(input.name);
    if (mode === "ranges" && bool(ctx.options, "mergeRanges", false)) {
      const idx = pageIndices(str(ctx.options, "ranges"), await ops.pageCount(bytes));
      await ctx.emit(`${stem}-selected.pdf`, await ops.pick(bytes, idx), PDF);
      ctx.summary.pages = idx.length;
      return;
    }
    const parts =
      mode === "ranges"
        ? await ops.splitByRanges(bytes, str(ctx.options, "ranges"))
        : await ops.splitEvery(bytes, mode === "every" ? 1 : num(ctx.options, "chunk", 2, 1, 100000));
    for (let i = 0; i < parts.length; i++) {
      throwIfAborted(ctx.signal);
      ctx.progress(i / parts.length, `Writing part ${i + 1} of ${parts.length}…`);
      await ctx.emit(`${stem}-p${describeRange(parts[i].range)}.pdf`, parts[i].bytes, PDF);
    }
    ctx.summary.files = parts.length;
  },

  async organize(ctx) {
    ctx.progress(null, "Rebuilding document…");
    const plan = ctx.options.plan;
    if (!Array.isArray(plan)) throw new UserError("No page order was provided.");
    const sources = await Promise.all(ctx.inputs.map((f) => f.read()));
    const out = await ops.assemble(sources, plan as ops.PlanItem[]);
    ctx.summary.pages = plan.length;
    const name = str(ctx.options, "outputName") || `${baseName(ctx.inputs[0].name)}-organized`;
    await ctx.emit(`${baseName(name)}.pdf`, out, PDF);
  },

  async rotate(ctx) {
    const angle = Number(oneOf(ctx.options, "angle", ["90", "180", "270"] as const, "90"));
    await eachPdf(ctx, async (bytes, f) => {
      await ctx.emit(`${baseName(f.name)}-rotated.pdf`, await ops.rotate(bytes, angle, str(ctx.options, "pages")), PDF);
    });
  },

  async "delete-pages"(ctx) {
    await eachPdf(ctx, async (bytes, f) => {
      const out = await ops.deletePages(bytes, str(ctx.options, "pages"));
      ctx.summary.pagesLeft = await ops.pageCount(out);
      await ctx.emit(`${baseName(f.name)}-edited.pdf`, out, PDF);
    });
  },

  async "extract-pages"(ctx) {
    await eachPdf(ctx, async (bytes, f) => {
      const spec = str(ctx.options, "pages");
      if (!spec.trim()) throw new UserError("Enter the pages to extract.");
      const idx = pageIndices(spec, await ops.pageCount(bytes));
      ctx.summary.pages = idx.length;
      await ctx.emit(`${baseName(f.name)}-extract.pdf`, await ops.pick(bytes, idx), PDF);
    });
  },

  async "remove-blank"(ctx) {
    const sensitivity = oneOf(ctx.options, "sensitivity", ["strict", "normal", "loose"] as const, "normal");
    let removed = 0;
    await eachPdf(ctx, async (bytes, f) => {
      const { blank, total } = await mu.blankPages(bytes, sensitivity, ctx.signal);
      if (blank.length === total) throw new UserError(`Every page of ${f.name} looks blank, so nothing was removed.`, "all_blank");
      removed += blank.length;
      const keep = Array.from({ length: total }, (_, i) => i).filter((i) => !blank.includes(i));
      if (blank.length) ctx.notes.push(`${f.name}: removed page${blank.length > 1 ? "s" : ""} ${blank.map((i) => i + 1).join(", ")}.`);
      else ctx.notes.push(`${f.name}: no blank pages found; the file is unchanged.`);
      await ctx.emit(`${baseName(f.name)}-no-blanks.pdf`, blank.length ? await ops.pick(bytes, keep) : bytes, PDF);
    });
    ctx.summary.removedPages = removed;
  },

  async compress(ctx) {
    const level = oneOf(ctx.options, "level", ["low", "medium", "high"] as const, "medium");
    let before = 0;
    let after = 0;
    for (let i = 0; i < ctx.inputs.length; i++) {
      const f = ctx.inputs[i];
      const bytes = await f.read();
      const r = await mu.compress(bytes, level, ctx.signal, (p) => ctx.progress((i + p) / ctx.inputs.length, `Optimising ${f.name}…`));
      const smaller = r.bytes.length < bytes.length;
      before += bytes.length;
      after += smaller ? r.bytes.length : bytes.length;
      if (smaller) {
        const pct = ((1 - r.bytes.length / bytes.length) * 100).toFixed(1);
        ctx.notes.push(`${f.name}: ${formatBytes(bytes.length)} → ${formatBytes(r.bytes.length)} (−${pct}%)${r.recompressed ? `, ${r.recompressed} image${r.recompressed > 1 ? "s" : ""} re-encoded` : ""}.`);
      } else {
        ctx.notes.push(`${f.name}: already well optimised; it couldn't be made smaller, so the original is returned unchanged.`);
      }
      await ctx.emit(`${baseName(f.name)}-compressed.pdf`, smaller ? r.bytes : bytes, PDF);
    }
    ctx.summary.originalSize = before;
    ctx.summary.resultSize = after;
    ctx.summary.reduced = after < before;
    ctx.summary.reductionPercent = before ? Number(((1 - after / before) * 100).toFixed(1)) : 0;
  },

  async repair(ctx) {
    await eachPdf(ctx, async (bytes, f) => {
      const r = mu.repair(bytes);
      ctx.notes.push(
        r.repaired
          ? `${f.name}: the cross-reference table was damaged and has been rebuilt (${r.pages} pages recovered).`
          : `${f.name}: no structural damage found; the file was rewritten cleanly.`,
      );
      if (r.unreadable) ctx.notes.push(`${f.name}: ${r.unreadable} page(s) could not be read and may be blank.`);
      await ctx.emit(`${baseName(f.name)}-repaired.pdf`, r.bytes, PDF);
    });
  },

  async convert(ctx) {
    const to = str(ctx.options, "to") as FormatId;
    if (!FORMATS[to]) throw new UserError("Choose a target format.");
    for (let i = 0; i < ctx.inputs.length; i++) {
      throwIfAborted(ctx.signal);
      const f = ctx.inputs[i];
      const base = ctx.inputs.length > 1 ? i / ctx.inputs.length : 0;
      const outputs = await convert({ path: f.path, name: f.name, format: f.format }, to, {
        workDir: `${ctx.workDir}/c${i}`,
        signal: ctx.signal,
        options: ctx.options,
        progress: (p, m) => ctx.progress(p === null ? (ctx.inputs.length > 1 ? base : null) : base + p / ctx.inputs.length, ctx.inputs.length > 1 ? `${f.name}: ${m ?? ""}` : m),
      });
      for (const o of outputs) await ctx.emit(o.name, o.data, o.mime);
    }
  },

  async "images-to-pdf"(ctx) {
    const pages: ops.ImagePage[] = [];
    for (let i = 0; i < ctx.inputs.length; i++) {
      throwIfAborted(ctx.signal);
      ctx.progress(i / ctx.inputs.length, `Preparing image ${i + 1} of ${ctx.inputs.length}…`);
      pages.push(await imageForPdf(await ctx.inputs[i].read()));
    }
    const out = await ops.imagesToPdf(pages, {
      pageSize: oneOf(ctx.options, "pageSize", ["fit", "a4", "letter"] as const, "fit"),
      orientation: oneOf(ctx.options, "orientation", ["auto", "portrait", "landscape"] as const, "auto"),
      margin: num(ctx.options, "margin", 0, 0, 72),
    });
    ctx.summary.pages = pages.length;
    await ctx.emit(ctx.inputs.length === 1 ? `${baseName(ctx.inputs[0].name)}.pdf` : "images.pdf", out, PDF);
  },

  async edit(ctx) {
    const [pdf, ...rest] = ctx.inputs;
    const edit = ctx.options.edit as EditDocument;
    ctx.progress(null, "Applying edits…");
    const images = new Map<string, Uint8Array>();
    for (const f of rest) images.set(f.id, await f.read());
    const r = await applyEdits(await pdf.read(), edit, { images });
    Object.assign(ctx.summary, r.stats);
    const suffix = str(ctx.options, "suffix", "edited").replace(/[^a-z-]/gi, "") || "edited";
    await ctx.emit(`${baseName(pdf.name)}-${suffix}.pdf`, r.bytes, PDF);
  },

  async watermark(ctx) {
    await eachPdf(ctx, async (bytes, f) => {
      const r = await ops.watermark(bytes, {
        text: str(ctx.options, "text", "CONFIDENTIAL").slice(0, 200),
        size: num(ctx.options, "size", 54, 8, 200),
        color: str(ctx.options, "color", "#d70015"),
        opacity: num(ctx.options, "opacity", 25, 5, 100) / 100,
        angle: num(ctx.options, "angle", 45, -90, 90),
        position: str(ctx.options, "position", "center"),
        behind: bool(ctx.options, "behind", false),
        pages: str(ctx.options, "pages"),
      });
      if (r.dropped) ctx.notes.push(`${r.dropped} character(s) aren't available in the stamp font and were left out.`);
      await ctx.emit(`${baseName(f.name)}-watermarked.pdf`, r.bytes, PDF);
    });
  },

  async "page-numbers"(ctx) {
    await eachPdf(ctx, async (bytes, f) => {
      const out = await ops.pageNumbers(bytes, {
        position: str(ctx.options, "position", "bottom-center"),
        format: str(ctx.options, "format", "{n}").slice(0, 80),
        start: num(ctx.options, "start", 1, 0, 100000),
        size: num(ctx.options, "size", 10, 6, 48),
        margin: num(ctx.options, "margin", 28, 6, 144),
        pages: str(ctx.options, "pages"),
      });
      await ctx.emit(`${baseName(f.name)}-numbered.pdf`, out, PDF);
    });
  },

  async "header-footer"(ctx) {
    await eachPdf(ctx, async (bytes, f) => {
      const out = await ops.headerFooter(bytes, {
        header: str(ctx.options, "header").slice(0, 200),
        footer: str(ctx.options, "footer").slice(0, 200),
        align: oneOf(ctx.options, "align", ["left", "center", "right"] as const, "center"),
        size: num(ctx.options, "size", 9, 6, 36),
        color: str(ctx.options, "color", "#636368"),
        margin: num(ctx.options, "margin", 24, 6, 144),
        pages: str(ctx.options, "pages"),
        filename: f.name,
      });
      await ctx.emit(`${baseName(f.name)}-header-footer.pdf`, out, PDF);
    });
  },

  async crop(ctx) {
    await eachPdf(ctx, async (bytes, f) => {
      const m = {
        top: num(ctx.options, "top", 10, 0, 200),
        right: num(ctx.options, "right", 10, 0, 200),
        bottom: num(ctx.options, "bottom", 10, 0, 200),
        left: num(ctx.options, "left", 10, 0, 200),
      };
      await ctx.emit(`${baseName(f.name)}-cropped.pdf`, await ops.crop(bytes, m, str(ctx.options, "pages")), PDF);
    });
  },

  async resize(ctx) {
    await eachPdf(ctx, async (bytes, f) => {
      const r = await ops.resize(bytes, str(ctx.options, "size", "a4"), oneOf(ctx.options, "orientation", ["auto", "portrait", "landscape"] as const, "auto"));
      if (r.hadAnnots) ctx.notes.push(`${f.name}: links and annotations can't be carried over when pages are re-laid out.`);
      await ctx.emit(`${baseName(f.name)}-${str(ctx.options, "size", "a4")}.pdf`, r.bytes, PDF);
    });
  },

  async "fill-form"(ctx) {
    const [f] = ctx.inputs;
    const values = (ctx.options.values ?? {}) as Record<string, string | boolean | string[]>;
    if (typeof values !== "object" || Array.isArray(values)) throw new UserError("Form values are malformed.");
    ctx.progress(null, "Filling form…");
    const r = await ops.fillForm(await f.read(), values, bool(ctx.options, "flatten", false));
    ctx.summary.fieldsFilled = r.filled;
    await ctx.emit(`${baseName(f.name)}-filled.pdf`, r.bytes, PDF);
  },

  async flatten(ctx) {
    await eachPdf(ctx, async (bytes, f) => {
      await ctx.emit(`${baseName(f.name)}-flattened.pdf`, mu.flatten(bytes, bool(ctx.options, "forms", true), bool(ctx.options, "annotations", true)), PDF);
    });
  },

  async bookmarks(ctx) {
    const [f] = ctx.inputs;
    const r = await ops.setOutline(await f.read(), str(ctx.options, "outline"));
    ctx.summary.bookmarks = r.count;
    await ctx.emit(`${baseName(f.name)}-bookmarked.pdf`, r.bytes, PDF);
  },

  async protect(ctx) {
    const password = str(ctx.options, "password");
    if (!password) throw new UserError("Enter a password.", "password_required");
    await eachPdf(ctx, async (bytes, f) => {
      const out = mu.protect(bytes, password, {
        print: bool(ctx.options, "allowPrint", true),
        copy: bool(ctx.options, "allowCopy", false),
        edit: bool(ctx.options, "allowEdit", false),
      });
      await ctx.emit(`${baseName(f.name)}-protected.pdf`, out, PDF);
    });
    ctx.summary.encryption = "AES-256";
  },

  async unlock(ctx) {
    const [f] = ctx.inputs;
    ctx.progress(null, "Decrypting…");
    await ctx.emit(`${baseName(f.name)}-unlocked.pdf`, mu.unlock(await f.read(), str(ctx.options, "password")), PDF);
  },

  async metadata(ctx) {
    const mode = oneOf(ctx.options, "mode", ["view", "edit", "remove"] as const, "view");
    await eachPdf(ctx, async (bytes, f) => {
      if (mode === "view") {
        const m = await ops.readMetadata(bytes);
        if (ctx.inputs.length === 1) {
          for (const [k, v] of Object.entries(m)) if (v !== undefined && v !== "") ctx.summary[k] = v as string | number | boolean;
        }
        await ctx.emit(`${baseName(f.name)}-metadata.json`, new TextEncoder().encode(JSON.stringify(m, null, 2)), "application/json");
      } else if (mode === "edit") {
        const pick = (k: string) => (typeof ctx.options[k] === "string" ? (ctx.options[k] as string).slice(0, 500) : undefined);
        const out = await ops.writeMetadata(bytes, { title: pick("title"), author: pick("author"), subject: pick("subject"), keywords: pick("keywords") });
        await ctx.emit(`${baseName(f.name)}.pdf`, out, PDF);
      } else {
        await ctx.emit(`${baseName(f.name)}-clean.pdf`, await ops.stripMetadata(bytes), PDF);
      }
    });
  },

  async ocr(ctx) {
    const lang = str(ctx.options, "lang", "eng");
    const output = oneOf(ctx.options, "output", ["pdf", "txt"] as const, "pdf");
    let recognised = 0;
    let skipped = 0;
    for (let i = 0; i < ctx.inputs.length; i++) {
      const f = ctx.inputs[i];
      const bytes = await f.read();
      const isImage = IMAGE_INPUTS.includes(f.format);
      let r;
      if (isImage) {
        ctx.progress(i / ctx.inputs.length, `Recognising ${f.name}…`);
        // normalise orientation / exotic formats for tesseract
        const png = new Uint8Array(await sharp(bytes).rotate().png().toBuffer());
        r = await ocrImage(png, { lang, output }, ctx.signal);
      } else {
        r = await ocrPdf(bytes, { lang, skipText: bool(ctx.options, "skipText", true), output }, ctx.signal, (p, m) =>
          ctx.progress((i + p) / ctx.inputs.length, ctx.inputs.length > 1 ? `${f.name}: ${m}` : m),
        );
      }
      recognised += r.recognised;
      skipped += r.skipped;
      if (output === "pdf" && r.pdf) await ctx.emit(`${baseName(f.name)}-ocr.pdf`, r.pdf, PDF);
      else await ctx.emit(`${baseName(f.name)}-ocr.txt`, new TextEncoder().encode(r.text), FORMATS.txt.mime);
    }
    ctx.summary.pagesRecognised = recognised;
    if (skipped) {
      ctx.summary.pagesSkipped = skipped;
      ctx.notes.push(`${skipped} page(s) already had a text layer and were left unchanged.`);
    }
  },

  async "extract-text"(ctx) {
    await eachPdf(ctx, async (bytes, f) => {
      const r = mu.extractText(bytes, bool(ctx.options, "pageBreaks", true), ctx.signal);
      if (r.chars === 0) ctx.notes.push(`${f.name}: no text layer found. It's probably scanned — use OCR PDF to recognise its text.`);
      ctx.summary.characters = r.chars;
      await ctx.emit(`${baseName(f.name)}.txt`, new TextEncoder().encode(r.text), FORMATS.txt.mime);
    });
  },

  async "extract-images"(ctx) {
    let count = 0;
    await eachPdf(ctx, async (bytes, f) => {
      const images = mu.extractImages(bytes, num(ctx.options, "minSize", 32, 0, 2000), ctx.signal);
      const pad = String(images.length).length;
      for (let i = 0; i < images.length; i++) {
        const im = images[i];
        await ctx.emit(`${baseName(f.name)}-image-${String(i + 1).padStart(pad, "0")}.${im.ext}`, im.data, im.ext === "jpg" ? "image/jpeg" : "image/png");
      }
      count += images.length;
    });
    if (count === 0) throw new UserError("No embedded images matched. The PDF may contain only text and vector graphics.", "no_images");
    ctx.summary.images = count;
  },

  async compare(ctx) {
    const { compareReport } = await import("./compare");
    const [a, b] = ctx.inputs;
    const r = await compareReport(await a.read(), await b.read(), a.name, b.name, ctx.signal, (p, m) => ctx.progress(p, m));
    Object.assign(ctx.summary, r.summary);
    await ctx.emit("comparison.html", new TextEncoder().encode(r.html), "text/html");
  },
};
