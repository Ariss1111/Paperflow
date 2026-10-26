// Applies an EditDocument to a PDF. Three passes:
//  1. pdf-lib  — assemble pages (order, duplicates, deletions, rotation)
//  2. MuPDF    — content changes (redaction for replace/erase) and real markup annotations
//  3. pdf-lib  — overlays (text, images, ink, shapes, lines)
import { PDFDocument, degrees, LineCapStyle, type PDFPage, type PDFFont, type PDFImage } from "pdf-lib";
import sharp from "sharp";
import { UserError } from "@/lib/server/errors";
import { embedFont, drawable, type FontFamily } from "@/lib/server/fonts";
import { load, hexToRgb, assemble } from "./ops";
import { openDoc, mupdf } from "./mu";
import type { EditDocument, EditObject, Rect, TextObj, ReplaceObj } from "@/lib/editor/model";
import { LINE_HEIGHT } from "@/lib/editor/model";

export interface EditAssets {
  /** uploaded image bytes keyed by file id */
  images: Map<string, Uint8Array>;
}

const MAX_OBJECTS = 5000;

function color3(hex: string): [number, number, number] {
  const c = hexToRgb(hex);
  return [c.red, c.green, c.blue];
}

function validate(doc: EditDocument, pageCount: number) {
  if (!doc || doc.version !== 1 || !Array.isArray(doc.pages) || !Array.isArray(doc.objects)) {
    throw new UserError("The edit data is malformed.");
  }
  if (doc.pages.length === 0) throw new UserError("The document must keep at least one page.");
  if (doc.objects.length > MAX_OBJECTS) throw new UserError("Too many objects on the document.");
  const keys = new Set<string>();
  for (const p of doc.pages) {
    if (typeof p.key !== "string" || keys.has(p.key)) throw new UserError("Duplicate page key.");
    if (!Number.isInteger(p.src) || p.src < 0 || p.src >= pageCount) throw new UserError("A page refers to a page that doesn't exist.");
    if (![0, 90, 180, 270].includes(p.rotate)) throw new UserError("Invalid page rotation.");
    keys.add(p.key);
  }
  const finite = (...n: unknown[]) => n.every((v) => typeof v === "number" && Number.isFinite(v));
  for (const o of doc.objects) {
    if (!keys.has(o.pageKey)) continue; // object on a deleted page: ignored
    switch (o.type) {
      case "text":
      case "replace":
        if (!finite(o.x, o.y, o.w, o.h, o.size) || o.size <= 0 || o.size > 400) throw new UserError("Invalid text box.");
        if (typeof o.text !== "string" || o.text.length > 20000) throw new UserError("Text is too long.");
        break;
      case "ink":
        if (!Array.isArray(o.points) || o.points.length > 20000 || !o.points.every((p) => finite(p[0], p[1]))) throw new UserError("Invalid drawing.");
        break;
      case "highlight":
      case "underline":
      case "strike":
        if (!Array.isArray(o.rects) || !o.rects.every((r) => finite(r.x, r.y, r.w, r.h))) throw new UserError("Invalid markup.");
        break;
      case "line":
      case "arrow":
        if (!finite(o.x1, o.y1, o.x2, o.y2, o.width)) throw new UserError("Invalid line.");
        break;
      case "comment":
        if (!finite(o.x, o.y)) throw new UserError("Invalid comment.");
        break;
      default:
        if (!finite((o as Rect).x, (o as Rect).y, (o as Rect).w, (o as Rect).h)) throw new UserError("Invalid object.");
    }
  }
}

/** Matrix application helper for MuPDF's page transform (PDF user space -> MuPDF page space). */
function tx(m: number[], x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}
function rectToMu(m: number[], r: Rect): [number, number, number, number] {
  const a = tx(m, r.x, r.y);
  const b = tx(m, r.x + r.w, r.y + r.h);
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
}
function rectToQuad(m: number[], r: Rect): mupdf.Quad {
  // quad order: upper-left, upper-right, lower-left, lower-right (in user space "upper" = larger y)
  const ul = tx(m, r.x, r.y + r.h);
  const ur = tx(m, r.x + r.w, r.y + r.h);
  const ll = tx(m, r.x, r.y);
  const lr = tx(m, r.x + r.w, r.y);
  return [...ul, ...ur, ...ll, ...lr] as mupdf.Quad;
}

export async function applyEdits(source: Uint8Array, edit: EditDocument, assets: EditAssets): Promise<{ bytes: Uint8Array; stats: Record<string, number> }> {
  const srcDoc = await load(source);
  validate(edit, srcDoc.getPageCount());

  // ---- pass 1: page assembly
  const assembled = await assemble(
    [source],
    edit.pages.map((p) => ({ src: 0, page: p.src, rotate: p.rotate })),
  );
  const pageIndex = new Map(edit.pages.map((p, i) => [p.key, i]));
  const byPage = new Map<number, EditObject[]>();
  for (const o of edit.objects) {
    const i = pageIndex.get(o.pageKey);
    if (i === undefined) continue;
    if (!byPage.has(i)) byPage.set(i, []);
    byPage.get(i)!.push(o);
  }
  const stats: Record<string, number> = { removed: 0, annotations: 0, overlays: 0, pages: edit.pages.length };

  // ---- pass 2: content changes + annotations (MuPDF)
  let stage = assembled;
  const needsMu = edit.objects.some((o) => pageIndex.has(o.pageKey) && ["replace", "erase", "highlight", "underline", "strike", "comment"].includes(o.type));
  if (needsMu || edit.flattenAnnotations) {
    const mdoc = openDoc(assembled);
    for (const [i, objs] of byPage) {
      const page = mdoc.loadPage(i);
      const m = page.getTransform() as unknown as number[];
      const replaces = objs.filter((o): o is ReplaceObj => o.type === "replace");
      if (replaces.length) {
        for (const r of replaces) {
          const a = page.createAnnotation("Redact");
          a.setRect(rectToMu(m, r.cover));
        }
        // text only: keep images and vector art under replaced text
        page.applyRedactions(false, mupdf.PDFPage.REDACT_IMAGE_NONE, mupdf.PDFPage.REDACT_LINE_ART_NONE, mupdf.PDFPage.REDACT_TEXT_REMOVE);
        stats.removed += replaces.length;
      }
      const erases = objs.filter((o) => o.type === "erase");
      if (erases.length) {
        for (const r of erases) {
          const a = page.createAnnotation("Redact");
          a.setRect(rectToMu(m, r as Rect));
        }
        page.applyRedactions(
          false,
          mupdf.PDFPage.REDACT_IMAGE_PIXELS,
          mupdf.PDFPage.REDACT_LINE_ART_REMOVE_IF_COVERED,
          mupdf.PDFPage.REDACT_TEXT_REMOVE,
        );
        stats.removed += erases.length;
      }
      for (const o of objs) {
        if (o.type === "highlight" || o.type === "underline" || o.type === "strike") {
          const a = page.createAnnotation(o.type === "highlight" ? "Highlight" : o.type === "underline" ? "Underline" : "StrikeOut");
          a.setQuadPoints(o.rects.map((r) => rectToQuad(m, r)));
          a.setColor(color3(o.color));
          a.setOpacity(Math.max(0.05, Math.min(1, o.opacity)));
          a.update();
          stats.annotations++;
        } else if (o.type === "comment") {
          const a = page.createAnnotation("Text");
          const [x, y] = tx(m, o.x, o.y);
          a.setRect([x, y - 20, x + 20, y]);
          a.setContents(o.text.slice(0, 10000));
          a.setColor(color3(o.color));
          a.setIcon("Comment");
          a.update();
          stats.annotations++;
        }
      }
      page.update();
    }
    stage = mdoc.saveToBuffer({ garbage: "yes", compress: "yes" }).asUint8Array().slice();
  }

  // ---- pass 3: overlays (pdf-lib)
  const doc = await load(stage);
  const fonts = new Map<string, PDFFont>();
  const font = async (family: FontFamily, bold: boolean) => {
    const k = `${family}-${bold}`;
    if (!fonts.has(k)) fonts.set(k, await embedFont(doc, family, bold));
    return fonts.get(k)!;
  };
  const images = new Map<string, PDFImage>();
  const image = async (fileId: string) => {
    if (images.has(fileId)) return images.get(fileId)!;
    const bytes = assets.images.get(fileId);
    if (!bytes) throw new UserError("An inserted image is no longer available. Re-insert it and export again.");
    // normalise everything (webp, gif, exif rotation) to PNG/JPEG pdf-lib can embed
    const meta = await sharp(bytes).metadata();
    const img =
      meta.format === "jpeg" && !meta.orientation
        ? await doc.embedJpg(bytes)
        : await doc.embedPng(await sharp(bytes).rotate().png().toBuffer());
    images.set(fileId, img);
    return img;
  };

  for (const [i, objs] of byPage) {
    const page = doc.getPage(i);
    for (const o of objs) {
      switch (o.type) {
        case "erase": {
          page.drawRectangle({ x: o.x, y: o.y, width: o.w, height: o.h, color: hexToRgb(o.fill) });
          break;
        }
        case "text":
        case "replace":
          await drawTextBox(page, o, await font(o.font, o.bold));
          stats.overlays++;
          break;
        case "image":
        case "signature": {
          const img = await image(o.fileId);
          const theta = (-(o.rotation || 0) * Math.PI) / 180; // screen clockwise -> PDF counter-clockwise
          const cx = o.x + o.w / 2;
          const cy = o.y + o.h / 2;
          // pdf-lib rotates around the bottom-left anchor; pick the anchor that keeps the centre fixed
          const ax = cx - (Math.cos(theta) * o.w) / 2 + (Math.sin(theta) * o.h) / 2;
          const ay = cy - (Math.sin(theta) * o.w) / 2 - (Math.cos(theta) * o.h) / 2;
          page.drawImage(img, { x: ax, y: ay, width: o.w, height: o.h, rotate: degrees((theta * 180) / Math.PI), opacity: o.opacity ?? 1 });
          stats.overlays++;
          break;
        }
        case "ink": {
          if (o.points.length < 2) break;
          const d = o.points.map(([x, y], k) => `${k ? "L" : "M"}${x.toFixed(2)} ${(-y).toFixed(2)}`).join(" ");
          page.drawSvgPath(d, {
            x: 0,
            y: 0,
            borderColor: hexToRgb(o.color),
            borderWidth: o.width,
            borderOpacity: o.opacity,
            borderLineCap: LineCapStyle.Round,
          });
          stats.overlays++;
          break;
        }
        case "rect":
          page.drawRectangle({
            x: o.x,
            y: o.y,
            width: o.w,
            height: o.h,
            borderColor: o.width > 0 ? hexToRgb(o.stroke) : undefined,
            borderWidth: o.width,
            color: o.fill ? hexToRgb(o.fill) : undefined,
            opacity: o.opacity,
            borderOpacity: o.opacity,
          });
          stats.overlays++;
          break;
        case "ellipse":
          page.drawEllipse({
            x: o.x + o.w / 2,
            y: o.y + o.h / 2,
            xScale: o.w / 2,
            yScale: o.h / 2,
            borderColor: o.width > 0 ? hexToRgb(o.stroke) : undefined,
            borderWidth: o.width,
            color: o.fill ? hexToRgb(o.fill) : undefined,
            opacity: o.opacity,
            borderOpacity: o.opacity,
          });
          stats.overlays++;
          break;
        case "line":
        case "arrow": {
          const color = hexToRgb(o.color);
          let { x2, y2 } = o;
          const ang = Math.atan2(o.y2 - o.y1, o.x2 - o.x1);
          const head = Math.max(8, o.width * 4);
          if (o.type === "arrow") {
            // stop the shaft at the arrowhead's base so the tip stays sharp
            x2 -= Math.cos(ang) * head * 0.8;
            y2 -= Math.sin(ang) * head * 0.8;
          }
          page.drawLine({ start: { x: o.x1, y: o.y1 }, end: { x: x2, y: y2 }, thickness: o.width, color, opacity: o.opacity, lineCap: LineCapStyle.Round });
          if (o.type === "arrow") {
            const p = (a: number) => [o.x2 - Math.cos(ang + a) * head, o.y2 - Math.sin(ang + a) * head];
            const [l, r] = [p(0.45), p(-0.45)];
            const d = `M${o.x2} ${-o.y2} L${l[0]} ${-l[1]} L${r[0]} ${-r[1]} Z`;
            page.drawSvgPath(d, { x: 0, y: 0, color, opacity: o.opacity });
          }
          stats.overlays++;
          break;
        }
      }
    }
  }

  let bytes = await doc.save({ useObjectStreams: true });
  if (edit.flattenAnnotations) {
    const m = openDoc(bytes);
    m.bake(true, true);
    bytes = m.saveToBuffer({ garbage: "yes", compress: "yes" }).asUint8Array().slice();
  }
  return { bytes, stats };
}

/** Draws explicit lines top-down inside the box. Matches the editor's CSS (line-height 1.25, white-space: pre). */
async function drawTextBox(page: PDFPage, o: TextObj | ReplaceObj, font: PDFFont) {
  const { text } = drawable(font, o.text);
  const lines = text.split("\n");
  const lh = o.size * LINE_HEIGHT;
  // DejaVu ascent ≈ 0.928em, descent ≈ 0.236em → baseline sits this far below each line box top
  const baselineOffset = (lh - o.size * (0.928 + 0.236)) / 2 + o.size * 0.928;
  const top = o.y + o.h;
  lines.forEach((line, k) => {
    const w = font.widthOfTextAtSize(line, o.size);
    const x = o.align === "center" ? o.x + (o.w - w) / 2 : o.align === "right" ? o.x + o.w - w : o.x;
    page.drawText(line, { x, y: top - k * lh - baselineOffset, size: o.size, font, color: hexToRgb(o.color) });
  });
}
