"use client";
import * as React from "react";
import type { PDFDocumentProxy, PageViewport, RenderTask } from "pdfjs-dist";
import type { EditObject, EditPage, Rect, TextObj, ReplaceObj, FontId } from "@/lib/editor/model";
import { ObjectView } from "./ObjectView";
import { rectToView, pointToPdf, viewRectToPdf, textItems, clipItem, intersects, type TextItem } from "./geometry";
import { measureText } from "./fonts";
import { uid, type EditorApi } from "./useEditorState";
import { cn } from "@/lib/utils";

export type ToolId = "select" | "text" | "replace" | "highlight" | "underline" | "strike" | "ink" | "rect" | "ellipse" | "line" | "arrow" | "comment" | "erase";

export interface ToolStyle {
  color: string;
  stroke: string;
  fill: string | null;
  width: number;
  size: number;
  font: FontId;
  bold: boolean;
  opacity: number;
  highlight: string;
}

type Drag =
  | { kind: "move"; id: string; start: [number, number]; orig: EditObject }
  | { kind: "handle"; id: string; handle: string; start: [number, number]; orig: EditObject; view: { left: number; top: number; width: number; height: number } }
  | { kind: "draft"; tool: ToolId; start: [number, number]; cur: [number, number]; points?: [number, number][] };

/** Baseline sits this far below a text box's top edge (matches the export; DejaVu metrics, line-height 1.25). */
const BASELINE = 0.971;

export function translate(o: EditObject, dx: number, dy: number): EditObject {
  switch (o.type) {
    case "line":
    case "arrow":
      return { ...o, x1: o.x1 + dx, y1: o.y1 + dy, x2: o.x2 + dx, y2: o.y2 + dy };
    case "ink":
      return { ...o, points: o.points.map(([x, y]) => [x + dx, y + dy] as [number, number]) };
    case "highlight":
    case "underline":
    case "strike":
      return { ...o, rects: o.rects.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy })) };
    case "comment":
      return { ...o, x: o.x + dx, y: o.y + dy };
    default:
      return { ...o, x: o.x + dx, y: o.y + dy };
  }
}

/** Resizes a text box to fit its content, keeping the top-left corner fixed. */
export function fitText<T extends TextObj | ReplaceObj>(o: T): T {
  const m = measureText(o.text || " ", o.size, o.font, o.bold);
  const top = o.y + o.h;
  return { ...o, w: m.w, h: m.h, y: top - m.h };
}

function markupRects(items: TextItem[], drag: Rect, x0: number, x1: number): Rect[] {
  const hit = items.filter((it) => intersects(it.box, drag)).sort((a, b) => b.y - a.y || a.x - b.x);
  if (!hit.length) return [];
  // group into lines by baseline
  const lines: TextItem[][] = [];
  for (const it of hit) {
    const line = lines.find((l) => Math.abs(l[0].y - it.y) < it.size * 0.5);
    if (line) line.push(it);
    else lines.push([it]);
  }
  const out: Rect[] = [];
  lines.forEach((line, i) => {
    const from = i === 0 ? x0 : -Infinity;
    const to = i === lines.length - 1 ? x1 : Infinity;
    const parts = line.map((it) => clipItem(it, lines.length === 1 ? Math.min(x0, x1) : from, lines.length === 1 ? Math.max(x0, x1) : to)).filter((r): r is Rect => !!r);
    if (!parts.length) return;
    // merge into one rect per line
    const x = Math.min(...parts.map((p) => p.x));
    const r = Math.max(...parts.map((p) => p.x + p.w));
    const y = Math.min(...parts.map((p) => p.y));
    const t = Math.max(...parts.map((p) => p.y + p.h));
    out.push({ x, y, w: r - x, h: t - y });
  });
  return out;
}

export const PageView = React.memo(function PageView({
  pdf,
  page,
  index,
  scale,
  objects,
  tool,
  style,
  selectedId,
  editingId,
  editor,
  onSelect,
  onEdit,
  onToolDone,
  getText,
  registerView,
}: {
  pdf: PDFDocumentProxy;
  page: EditPage;
  index: number;
  scale: number;
  objects: EditObject[];
  tool: ToolId;
  style: ToolStyle;
  selectedId: string | null;
  editingId: string | null;
  editor: EditorApi;
  onSelect: (id: string | null) => void;
  onEdit: (id: string | null) => void;
  onToolDone: () => void;
  getText: (src: number) => Promise<TextItem[]>;
  registerView: (key: string, el: HTMLElement | null, vp: PageViewport | null) => void;
}) {
  const root = React.useRef<HTMLDivElement>(null);
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const [vp, setVp] = React.useState<PageViewport | null>(null);
  const [visible, setVisible] = React.useState(index < 2);
  const [rendered, setRendered] = React.useState(false);
  const [items, setItems] = React.useState<TextItem[] | null>(null);
  const [hoverItem, setHoverItem] = React.useState<number | null>(null);
  const [drag, setDrag] = React.useState<Drag | null>(null);
  const textTools = tool === "replace" || tool === "highlight" || tool === "underline" || tool === "strike";

  // viewport (cheap) — always known so placeholders have the right size
  React.useEffect(() => {
    let live = true;
    pdf.getPage(page.src + 1).then((p) => {
      if (!live) return;
      setVp(p.getViewport({ scale, rotation: (p.rotate + page.rotate) % 360 }));
    });
    return () => {
      live = false;
    };
  }, [pdf, page.src, page.rotate, scale]);

  React.useEffect(() => {
    registerView(page.key, root.current, vp);
  }, [page.key, vp, registerView]);
  React.useEffect(() => () => registerView(page.key, null, null), [page.key, registerView]);

  React.useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // render the page bitmap when visible; re-render on zoom/rotation
  React.useEffect(() => {
    if (!visible || !vp || !canvas.current) return;
    let task: RenderTask | null = null;
    let live = true;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    pdf.getPage(page.src + 1).then((p) => {
      if (!live || !canvas.current) return;
      const v = p.getViewport({ scale: scale * dpr, rotation: (p.rotate + page.rotate) % 360 });
      const c = canvas.current;
      c.width = Math.floor(v.width);
      c.height = Math.floor(v.height);
      task = p.render({ canvas: c, canvasContext: c.getContext("2d")!, viewport: v });
      task.promise.then(() => live && setRendered(true)).catch(() => undefined);
    });
    return () => {
      live = false;
      task?.cancel();
    };
  }, [visible, vp, pdf, page.src, page.rotate, scale]);

  React.useEffect(() => {
    if (!textTools || !visible || items) return;
    getText(page.src).then(setItems).catch(() => setItems([]));
  }, [textTools, visible, items, getText, page.src]);

  const local = (e: React.PointerEvent | PointerEvent): [number, number] => {
    const r = root.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const sampleBg = (r: Rect): string => {
    try {
      const c = canvas.current;
      if (!c || !vp) return "#ffffff";
      const v = rectToView(vp, r);
      const k = c.width / vp.width;
      const d = c.getContext("2d")!.getImageData(Math.max(0, Math.floor((v.left - 2) * k)), Math.max(0, Math.floor((v.top + v.height / 2) * k)), 1, 1).data;
      return `rgb(${d[0]} ${d[1]} ${d[2]})`;
    } catch {
      return "#ffffff";
    }
  };

  const createReplace = (it: TextItem) => {
    const sans = !/serif/i.test(it.font) || /sans/i.test(it.font);
    const font: FontId = /mono|courier/i.test(it.font) ? "mono" : sans ? "sans" : "serif";
    const top = it.y + it.size * BASELINE;
    const base: ReplaceObj = {
      id: uid("r"),
      pageKey: page.key,
      type: "replace",
      cover: { x: it.box.x - 0.5, y: it.box.y - 0.5, w: it.box.w + 1, h: it.box.h + 1 },
      original: it.str,
      text: it.str,
      size: Math.round(it.size * 10) / 10,
      color: "#000000",
      font,
      bold: false,
      align: "left",
      x: it.x,
      y: top - it.size,
      w: it.w,
      h: it.size,
      previewBg: sampleBg(it.box),
    };
    const o = fitText({ ...base, y: top - base.h });
    editor.add(o);
    onSelect(o.id);
    onEdit(o.id);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !vp) return;
    const target = e.target as HTMLElement;
    if (target.closest("textarea")) return;
    // stop the browser's default mousedown focus change, which would blur a text box we're about to focus
    e.preventDefault();
    (document.activeElement as HTMLElement | null)?.blur?.();
    const p = local(e);
    const handle = target.closest("[data-handle]")?.getAttribute("data-handle");
    const objId = target.closest("[data-obj]")?.getAttribute("data-obj");
    const sel = objects.find((o) => o.id === selectedId);
    if (handle && sel) {
      const view = "x" in sel && "w" in sel ? rectToView(vp, sel as Rect) : { left: 0, top: 0, width: 0, height: 0 };
      setDrag({ kind: "handle", id: sel.id, handle, start: p, orig: sel, view });
    } else if (objId && (tool === "select" || tool === "text" || tool === "comment")) {
      onSelect(objId);
      if (editingId && editingId !== objId) onEdit(null);
      setDrag({ kind: "move", id: objId, start: p, orig: objects.find((o) => o.id === objId)! });
    } else if (tool === "select") {
      onSelect(null);
      onEdit(null);
      return;
    } else if (tool === "replace") {
      if (hoverItem !== null && items?.[hoverItem]) createReplace(items[hoverItem]);
      return;
    } else if (tool === "text") {
      const [x, y] = pointToPdf(vp, p[0], p[1]);
      const o = fitText<TextObj>({ id: uid("t"), pageKey: page.key, type: "text", x, y: y - style.size * 1.25, w: 10, h: style.size * 1.25, text: "", size: style.size, color: style.color, font: style.font, bold: style.bold, align: "left" });
      editor.add(o);
      onSelect(o.id);
      onEdit(o.id);
      onToolDone();
      return;
    } else if (tool === "comment") {
      const [x, y] = pointToPdf(vp, p[0], p[1]);
      const id = uid("c");
      editor.add({ id, pageKey: page.key, type: "comment", x, y, text: "", color: "#ffd60a" });
      onSelect(id);
      onToolDone();
      return;
    } else {
      setDrag({ kind: "draft", tool, start: p, cur: p, points: tool === "ink" ? [pointToPdf(vp, p[0], p[1])] : undefined });
    }
    root.current?.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!vp) return;
    const p = local(e);
    if (!drag) {
      if (tool === "replace" && items) {
        const [x, y] = pointToPdf(vp, p[0], p[1]);
        const i = items.findIndex((it) => x >= it.box.x && x <= it.box.x + it.box.w && y >= it.box.y && y <= it.box.y + it.box.h);
        setHoverItem(i >= 0 ? i : null);
      }
      return;
    }
    if (drag.kind === "draft") {
      if (drag.tool === "ink") {
        const last = drag.points![drag.points!.length - 1];
        const pt = pointToPdf(vp, p[0], p[1]);
        if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) * vp.scale < 1.5) return;
        setDrag({ ...drag, cur: p, points: [...drag.points!, pt] });
      } else setDrag({ ...drag, cur: p });
      return;
    }
    const [sx, sy] = pointToPdf(vp, drag.start[0], drag.start[1]);
    const [cx, cy] = pointToPdf(vp, p[0], p[1]);
    if (drag.kind === "move") {
      editor.update((d) => ({ ...d, objects: d.objects.map((o) => (o.id === drag.id ? translate(drag.orig, cx - sx, cy - sy) : o)) }), `move:${drag.id}`);
      return;
    }
    // handles
    const o = drag.orig;
    if (drag.handle === "p1" || drag.handle === "p2") {
      if (o.type === "line" || o.type === "arrow") editor.patch(o.id, drag.handle === "p1" ? { x1: cx, y1: cy } : { x2: cx, y2: cy }, `h:${o.id}`);
      return;
    }
    if (drag.handle === "rot" && (o.type === "image" || o.type === "signature")) {
      const v = drag.view;
      const deg = (Math.atan2(p[1] - (v.top + v.height / 2), p[0] - (v.left + v.width / 2)) * 180) / Math.PI + 90 - vp.rotation;
      const snapped = e.shiftKey ? Math.round(deg / 15) * 15 : Math.round(deg);
      editor.patch(o.id, { rotation: ((snapped % 360) + 360) % 360 }, `h:${o.id}`);
      return;
    }
    if (!("w" in o)) return;
    const v = drag.view;
    const fixed: [number, number] = [drag.handle.includes("w") ? v.left + v.width : v.left, drag.handle.includes("n") ? v.top + v.height : v.top];
    let [px, py] = p;
    const keepAspect = o.type === "image" || o.type === "signature" || o.type === "text" || o.type === "replace" || e.shiftKey;
    if (keepAspect && v.width > 0 && v.height > 0) {
      const ratio = v.width / v.height;
      const w = Math.abs(px - fixed[0]);
      const h = Math.abs(py - fixed[1]);
      const k = Math.max(w / v.width, h / v.height);
      px = fixed[0] + Math.sign(px - fixed[0] || 1) * v.width * k;
      py = fixed[1] + Math.sign(py - fixed[1] || 1) * (v.width * k) / ratio;
    }
    const r = viewRectToPdf(vp, fixed, [px, py]);
    if (r.w < 4 || r.h < 4) return;
    if (o.type === "text" || o.type === "replace") {
      const size = Math.max(4, Math.min(400, Math.round(o.size * (r.h / o.h) * 10) / 10));
      editor.patch(o.id, fitText({ ...o, size, x: r.x, y: r.y + r.h - o.h }) as Partial<EditObject>, `h:${o.id}`);
    } else editor.patch(o.id, r as Partial<EditObject>, `h:${o.id}`);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!drag || !vp) return;
    root.current?.releasePointerCapture?.(e.pointerId);
    setDrag(null);
    if (drag.kind !== "draft") {
      editor.commit();
      return;
    }
    const { tool: t, start, cur } = drag;
    const r = viewRectToPdf(vp, start, cur);
    const tiny = r.w * vp.scale < 4 && r.h * vp.scale < 4;
    const id = uid();
    if (t === "ink") {
      if ((drag.points?.length ?? 0) >= 2) editor.add({ id, pageKey: page.key, type: "ink", points: drag.points!, color: style.stroke, width: style.width, opacity: style.opacity });
    } else if (t === "rect" || t === "ellipse") {
      const rr = tiny ? { ...pointToPdfRect(vp, start, 120, 80) } : r;
      editor.add({ id, pageKey: page.key, type: t, ...rr, stroke: style.stroke, fill: style.fill, width: style.width, opacity: style.opacity });
      onSelect(id);
    } else if (t === "erase") {
      if (tiny) return;
      editor.add({ id, pageKey: page.key, type: "erase", ...r, fill: "#ffffff" });
      onSelect(id);
    } else if (t === "line" || t === "arrow") {
      if (tiny) return;
      const [x1, y1] = pointToPdf(vp, start[0], start[1]);
      const [x2, y2] = pointToPdf(vp, cur[0], cur[1]);
      editor.add({ id, pageKey: page.key, type: t, x1, y1, x2, y2, color: style.stroke, width: style.width, opacity: style.opacity });
      onSelect(id);
    } else if (t === "highlight" || t === "underline" || t === "strike") {
      const [x0] = pointToPdf(vp, start[0], start[1]);
      const [x1] = pointToPdf(vp, cur[0], cur[1]);
      let rects = items ? markupRects(items, tiny ? { ...r, w: 0.1, h: 0.1 } : r, x0, x1) : [];
      if (!rects.length && !tiny && t === "highlight") rects = [r]; // free-form area highlight (e.g. scans)
      if (!rects.length) return;
      editor.add({ id, pageKey: page.key, type: t, rects, color: t === "highlight" ? style.highlight : style.stroke, opacity: t === "highlight" ? 0.4 : 1 });
    }
  };

  const draft = drag?.kind === "draft" && vp ? drag : null;
  const sorted = React.useMemo(() => {
    // markup underneath, content edits next, overlays on top, comments last
    const order = (o: EditObject) => (o.type === "highlight" ? 0 : o.type === "erase" ? 1 : o.type === "comment" ? 4 : o.type === "underline" || o.type === "strike" ? 2 : 3);
    return [...objects].sort((a, b) => order(a) - order(b));
  }, [objects]);

  return (
    <div
      ref={root}
      data-page-key={page.key}
      role="group"
      aria-label={`Page ${index + 1}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => setHoverItem(null)}
      onMouseDown={(e) => {
        // the default mousedown action moves focus to <body>, stealing it from a freshly created text box
        if (!(e.target as HTMLElement).closest("textarea")) e.preventDefault();
      }}
      onDoubleClick={(e) => {
        const id = (e.target as HTMLElement).closest("[data-obj]")?.getAttribute("data-obj");
        const o = objects.find((x) => x.id === id);
        if (o && (o.type === "text" || o.type === "replace")) onEdit(o.id);
      }}
      className={cn(
        "relative mx-auto touch-none bg-white shadow-[0_0_0_0.5px_rgb(0_0_0/0.12),0_4px_16px_-4px_rgb(0_0_0/0.18)]",
        tool === "select" ? "cursor-default" : tool === "text" ? "cursor-text" : tool === "replace" ? (hoverItem !== null ? "cursor-pointer" : "cursor-default") : "cursor-crosshair",
      )}
      style={{ width: vp?.width ?? 600, height: vp?.height ?? 800 }}
    >
      <canvas ref={canvas} aria-hidden className={cn("pointer-events-none absolute inset-0 size-full transition-opacity duration-200", rendered ? "opacity-100" : "opacity-0")} />
      {!rendered && <div className="absolute inset-0 animate-pulse bg-surface-2/60" />}
      <svg className="absolute size-0" aria-hidden>
        <defs>
          <pattern id="pf-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="#d70015" strokeWidth="1.5" />
          </pattern>
        </defs>
      </svg>
      {vp && tool === "replace" && items && (
        <div className="pointer-events-none absolute inset-0">
          {items.map((it, i) => {
            const v = rectToView(vp, it.box);
            return <div key={i} className={cn("absolute rounded-[2px] transition-colors", i === hoverItem ? "bg-accent/15 outline outline-1 outline-accent" : "outline outline-1 outline-accent/15")} style={{ left: v.left, top: v.top, width: v.width, height: v.height }} />;
          })}
        </div>
      )}
      {vp && (
        <div className={cn("absolute inset-0", tool !== "select" && tool !== "text" && tool !== "comment" && "[&_[data-obj]]:pointer-events-none")}>
          {sorted.map((o) => (
            <ObjectView
              key={o.id}
              o={o}
              vp={vp}
              selected={o.id === selectedId}
              editing={o.id === editingId}
              interactive={tool === "select"}
              onText={(id, text) => {
                const cur = objects.find((x) => x.id === id);
                if (cur && (cur.type === "text" || cur.type === "replace")) editor.patch(id, fitText({ ...cur, text }) as Partial<EditObject>, `text:${id}`);
              }}
              onDoneEditing={() => {
                const cur = objects.find((x) => x.id === editingId);
                if (cur && cur.type === "text" && !cur.text.trim()) editor.remove(cur.id);
                editor.commit();
                onEdit(null);
              }}
            />
          ))}
        </div>
      )}
      {draft && vp && <DraftView drag={draft} vp={vp} style={style} />}
    </div>
  );
});

function pointToPdfRect(vp: PageViewport, at: [number, number], w: number, h: number): Rect {
  const [x, y] = pointToPdf(vp, at[0], at[1]);
  return { x, y: y - h, w, h };
}

function DraftView({ drag, vp, style }: { drag: Extract<Drag, { kind: "draft" }>; vp: PageViewport; style: ToolStyle }) {
  const [a, b] = [drag.start, drag.cur];
  const box = { left: Math.min(a[0], b[0]), top: Math.min(a[1], b[1]), width: Math.abs(b[0] - a[0]), height: Math.abs(b[1] - a[1]) };
  const w = style.width * vp.scale;
  return (
    <svg className="pointer-events-none absolute inset-0 size-full overflow-visible">
      {drag.tool === "ink" && drag.points && (
        <path
          d={drag.points.map(([x, y], i) => {
            const [vx, vy] = vp.convertToViewportPoint(x, y);
            return `${i ? "L" : "M"}${vx} ${vy}`;
          }).join(" ")}
          fill="none"
          stroke={style.stroke}
          strokeOpacity={style.opacity}
          strokeWidth={w}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {drag.tool === "rect" && <rect x={box.left} y={box.top} width={box.width} height={box.height} fill={style.fill ?? "none"} stroke={style.stroke} strokeWidth={w} opacity={style.opacity} />}
      {drag.tool === "ellipse" && <ellipse cx={box.left + box.width / 2} cy={box.top + box.height / 2} rx={box.width / 2} ry={box.height / 2} fill={style.fill ?? "none"} stroke={style.stroke} strokeWidth={w} opacity={style.opacity} />}
      {drag.tool === "erase" && <rect x={box.left} y={box.top} width={box.width} height={box.height} fill="#fff" stroke="#d70015" strokeDasharray="4 3" />}
      {(drag.tool === "line" || drag.tool === "arrow") && <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={style.stroke} strokeWidth={w} strokeLinecap="round" />}
      {(drag.tool === "highlight" || drag.tool === "underline" || drag.tool === "strike") && (
        <rect x={box.left} y={box.top} width={box.width} height={box.height} fill="rgb(var(--accent) / 0.08)" stroke="rgb(var(--accent) / 0.5)" strokeDasharray="3 3" />
      )}
    </svg>
  );
}
