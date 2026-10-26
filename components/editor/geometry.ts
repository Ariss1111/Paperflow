import type { PageViewport } from "pdfjs-dist";
import type { Rect } from "@/lib/editor/model";

export interface ViewRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** PDF user-space rect → CSS pixel box inside the page view (works for any page rotation). */
export function rectToView(vp: PageViewport, r: Rect): ViewRect {
  const [ax, ay] = vp.convertToViewportPoint(r.x, r.y);
  const [bx, by] = vp.convertToViewportPoint(r.x + r.w, r.y + r.h);
  return { left: Math.min(ax, bx), top: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) };
}

export function pointToView(vp: PageViewport, x: number, y: number): [number, number] {
  const [vx, vy] = vp.convertToViewportPoint(x, y);
  return [vx, vy];
}

export function pointToPdf(vp: PageViewport, vx: number, vy: number): [number, number] {
  const [x, y] = vp.convertToPdfPoint(vx, vy);
  return [x, y];
}

export function viewRectToPdf(vp: PageViewport, a: [number, number], b: [number, number]): Rect {
  const [x1, y1] = pointToPdf(vp, a[0], a[1]);
  const [x2, y2] = pointToPdf(vp, b[0], b[1]);
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export interface TextItem {
  str: string;
  x: number;
  /** baseline */
  y: number;
  w: number;
  size: number;
  /** bbox in user space */
  box: Rect;
  font: string;
}

/** Horizontal text runs from PDF.js text content, with user-space boxes. */
export function textItems(content: { items: unknown[]; styles?: Record<string, { fontFamily?: string }> }): TextItem[] {
  const out: TextItem[] = [];
  for (const raw of content.items) {
    const it = raw as { str?: string; transform?: number[]; width?: number; height?: number; fontName?: string };
    if (!it.str || !it.str.trim() || !it.transform) continue;
    const [a, b, c, d, e, f] = it.transform;
    if (Math.abs(b) > 0.01 || Math.abs(c) > 0.01 || a <= 0) continue; // skip rotated / mirrored runs
    const size = Math.abs(d) || it.height || 10;
    const w = it.width ?? 0;
    if (w <= 0) continue;
    out.push({
      str: it.str,
      x: e,
      y: f,
      w,
      size,
      box: { x: e, y: f - size * 0.24, w, h: size * 1.18 },
      font: content.styles?.[it.fontName ?? ""]?.fontFamily ?? "sans-serif",
    });
  }
  return out;
}

/** Clips a text run to the horizontal span [x0, x1], snapping to (approximate) character boundaries. */
export function clipItem(it: TextItem, x0: number, x1: number): Rect | null {
  const n = it.str.length;
  const cw = it.w / n;
  const from = Math.max(0, Math.floor((Math.max(x0, it.x) - it.x) / cw));
  const to = Math.min(n, Math.ceil((Math.min(x1, it.x + it.w) - it.x) / cw));
  if (to <= from) return null;
  return { x: it.x + from * cw, y: it.box.y, w: (to - from) * cw, h: it.box.h };
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
