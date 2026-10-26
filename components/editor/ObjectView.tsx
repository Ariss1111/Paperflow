"use client";
import * as React from "react";
import type { PageViewport } from "pdfjs-dist";
import { MessageSquare } from "lucide-react";
import type { EditObject, TextObj, ReplaceObj } from "@/lib/editor/model";
import { LINE_HEIGHT } from "@/lib/editor/model";
import { rectToView, pointToView } from "./geometry";
import { FONT_FAMILY } from "./fonts";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";

const HANDLE = "absolute size-[9px] rounded-full border-[1.5px] border-accent bg-white shadow-sm";

/** Positions an unrotated box (in page units) so it appears with the page's rotation. */
function rotatedBox(vp: PageViewport, o: { x: number; y: number; w: number; h: number }, extraDeg = 0) {
  const v = rectToView(vp, o);
  const cx = v.left + v.width / 2;
  const cy = v.top + v.height / 2;
  const w = o.w * vp.scale;
  const h = o.h * vp.scale;
  return { style: { left: cx - w / 2, top: cy - h / 2, width: w, height: h, transform: `rotate(${vp.rotation + extraDeg}deg)` } as React.CSSProperties, view: v };
}

function TextContent({ o, vp, editing, onText, onDone }: { o: TextObj | ReplaceObj; vp: PageViewport; editing: boolean; onText: (t: string) => void; onDone: () => void }) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  React.useLayoutEffect(() => {
    if (!editing) return;
    ref.current?.focus({ preventScroll: true });
    ref.current?.select();
  }, [editing]);
  const style: React.CSSProperties = {
    fontFamily: `"${FONT_FAMILY[o.font]}"`,
    fontWeight: o.bold ? 700 : 400,
    fontSize: o.size * vp.scale,
    lineHeight: LINE_HEIGHT,
    color: o.color,
    textAlign: o.align,
    whiteSpace: "pre",
  };
  if (editing) {
    return (
      <textarea
        ref={ref}
        value={o.text}
        aria-label="Edit text"
        onChange={(e) => onText(e.target.value)}
        onBlur={onDone}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) onDone();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        spellCheck={false}
        className="absolute inset-0 m-0 resize-none overflow-hidden border-0 bg-white/40 p-0 outline-none"
        style={{ ...style, width: "max-content", minWidth: "100%", height: "100%" }}
      />
    );
  }
  return <div style={style}>{o.text || " "}</div>;
}

export function ObjectView({
  o,
  vp,
  selected,
  editing,
  interactive,
  onText,
  onDoneEditing,
}: {
  o: EditObject;
  vp: PageViewport;
  selected: boolean;
  editing: boolean;
  interactive: boolean;
  onText: (id: string, text: string) => void;
  onDoneEditing: () => void;
}) {
  const s = vp.scale;
  const common = { "data-obj": o.id, className: cn(interactive && "cursor-move") } as const;
  switch (o.type) {
    case "text":
    case "replace": {
      const { style, view } = rotatedBox(vp, o);
      const cover = o.type === "replace" ? rectToView(vp, o.cover) : null;
      return (
        <>
          {cover && (
            <div
              aria-hidden
              className={cn("absolute", selected && "outline outline-1 outline-dashed outline-danger/60")}
              style={{ left: cover.left, top: cover.top, width: cover.width, height: cover.height, background: (o.type === "replace" && o.previewBg) || "#fff" }}
            />
          )}
          <div {...common} className={cn("absolute origin-center", interactive && "cursor-move", selected && !editing && "outline outline-1 outline-accent")} style={style}>
            <TextContent o={o} vp={vp} editing={editing} onText={(t) => onText(o.id, t)} onDone={onDoneEditing} />
          </div>
          {selected && !editing && <Handles view={view} />}
        </>
      );
    }
    case "image":
    case "signature": {
      const { style, view } = rotatedBox(vp, o, o.rotation);
      return (
        <>
          <div {...common} className={cn("absolute origin-center", interactive && "cursor-move", selected && "outline outline-1 outline-accent")} style={{ ...style, opacity: o.opacity }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={api.fileUrl(o.fileId)} alt="" draggable={false} className="pointer-events-none size-full select-none object-fill" />
          </div>
          {selected && <Handles view={view} rotate />}
        </>
      );
    }
    case "rect":
    case "ellipse":
    case "erase": {
      const v = rectToView(vp, o);
      return (
        <>
          <svg {...common} className={cn("absolute overflow-visible", interactive && "cursor-move")} style={{ left: v.left, top: v.top, width: Math.max(1, v.width), height: Math.max(1, v.height) }}>
            {o.type === "erase" ? (
              <>
                <rect width={v.width} height={v.height} fill={o.fill} />
                <rect width={v.width} height={v.height} fill="url(#pf-hatch)" opacity={selected ? 0.6 : 0.25} />
              </>
            ) : o.type === "rect" ? (
              <rect
                x={(o.width * s) / 2}
                y={(o.width * s) / 2}
                width={Math.max(0, v.width - o.width * s)}
                height={Math.max(0, v.height - o.width * s)}
                fill={o.fill ?? "transparent"}
                stroke={o.width > 0 ? o.stroke : "none"}
                strokeWidth={o.width * s}
                opacity={o.opacity}
                pointerEvents="all"
              />
            ) : (
              <ellipse cx={v.width / 2} cy={v.height / 2} rx={Math.max(0, v.width / 2)} ry={Math.max(0, v.height / 2)} fill={o.fill ?? "transparent"} stroke={o.stroke} strokeWidth={o.width * s} opacity={o.opacity} pointerEvents="all" />
            )}
            {selected && <rect width={v.width} height={v.height} fill="none" stroke="rgb(var(--accent))" strokeWidth={1} />}
          </svg>
          {selected && <Handles view={v} />}
        </>
      );
    }
    case "line":
    case "arrow": {
      const [x1, y1] = pointToView(vp, o.x1, o.y1);
      const [x2, y2] = pointToView(vp, o.x2, o.y2);
      const w = o.width * s;
      const ang = Math.atan2(y2 - y1, x2 - x1);
      const head = Math.max(8, o.width * 4) * s;
      const p = (a: number) => [x2 - Math.cos(ang + a) * head, y2 - Math.sin(ang + a) * head];
      const [l, r] = [p(0.45), p(-0.45)];
      const ex = o.type === "arrow" ? x2 - Math.cos(ang) * head * 0.8 : x2;
      const ey = o.type === "arrow" ? y2 - Math.sin(ang) * head * 0.8 : y2;
      return (
        <>
          <svg className="pointer-events-none absolute inset-0 size-full overflow-visible">
            <g {...common} opacity={o.opacity} style={{ pointerEvents: "auto" }}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={Math.max(12, w + 8)} />
              <line x1={x1} y1={y1} x2={ex} y2={ey} stroke={o.color} strokeWidth={w} strokeLinecap="round" />
              {o.type === "arrow" && <polygon points={`${x2},${y2} ${l[0]},${l[1]} ${r[0]},${r[1]}`} fill={o.color} />}
            </g>
          </svg>
          {selected && (
            <>
              <span data-handle="p1" className={cn(HANDLE, "cursor-crosshair")} style={{ left: x1 - 4.5, top: y1 - 4.5 }} />
              <span data-handle="p2" className={cn(HANDLE, "cursor-crosshair")} style={{ left: x2 - 4.5, top: y2 - 4.5 }} />
            </>
          )}
        </>
      );
    }
    case "ink": {
      const pts = o.points.map(([x, y]) => pointToView(vp, x, y));
      const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
      return (
        <svg className="pointer-events-none absolute inset-0 size-full overflow-visible">
          <g {...common} style={{ pointerEvents: "auto" }}>
            <path d={d} fill="none" stroke="transparent" strokeWidth={Math.max(12, o.width * s + 8)} strokeLinecap="round" strokeLinejoin="round" />
            <path d={d} fill="none" stroke={o.color} strokeOpacity={o.opacity} strokeWidth={o.width * s} strokeLinecap="round" strokeLinejoin="round" />
            {selected && <path d={d} fill="none" stroke="rgb(var(--accent))" strokeWidth={1} strokeDasharray="3 3" />}
          </g>
        </svg>
      );
    }
    case "highlight":
    case "underline":
    case "strike": {
      return (
        <svg className="pointer-events-none absolute inset-0 size-full overflow-visible">
          <g {...common} style={{ pointerEvents: "auto", mixBlendMode: o.type === "highlight" ? "multiply" : undefined }}>
            {o.rects.map((r, i) => {
              const v = rectToView(vp, r);
              if (o.type === "highlight") return <rect key={i} x={v.left} y={v.top} width={v.width} height={v.height} fill={o.color} opacity={o.opacity} />;
              const y = o.type === "underline" ? v.top + v.height - v.height * 0.12 : v.top + v.height * 0.55;
              return (
                <g key={i}>
                  <rect x={v.left} y={v.top} width={v.width} height={v.height} fill="transparent" />
                  <line x1={v.left} x2={v.left + v.width} y1={y} y2={y} stroke={o.color} strokeWidth={Math.max(1, v.height * 0.07)} opacity={o.opacity} />
                </g>
              );
            })}
            {selected &&
              o.rects.map((r, i) => {
                const v = rectToView(vp, r);
                return <rect key={`s${i}`} x={v.left - 1} y={v.top - 1} width={v.width + 2} height={v.height + 2} fill="none" stroke="rgb(var(--accent))" strokeDasharray="3 2" />;
              })}
          </g>
        </svg>
      );
    }
    case "comment": {
      const [x, y] = pointToView(vp, o.x, o.y);
      return (
        <div {...common} className={cn("absolute flex size-7 items-center justify-center rounded-lg shadow-raised", interactive && "cursor-move", selected && "ring-2 ring-accent")} style={{ left: x, top: y, background: o.color }}>
          <MessageSquare className="pointer-events-none size-4 text-black/70" />
        </div>
      );
    }
  }
}

function Handles({ view, rotate }: { view: { left: number; top: number; width: number; height: number }; rotate?: boolean }) {
  const { left: l, top: t, width: w, height: h } = view;
  const pos: [string, number, number, string][] = [
    ["nw", l, t, "cursor-nwse-resize"],
    ["ne", l + w, t, "cursor-nesw-resize"],
    ["sw", l, t + h, "cursor-nesw-resize"],
    ["se", l + w, t + h, "cursor-nwse-resize"],
  ];
  return (
    <>
      {pos.map(([k, x, y, c]) => (
        <span key={k} data-handle={k} className={cn(HANDLE, c)} style={{ left: x - 4.5, top: y - 4.5 }} />
      ))}
      {rotate && (
        <>
          <span aria-hidden className="pointer-events-none absolute w-px bg-accent" style={{ left: l + w / 2, top: t - 22, height: 18 }} />
          <span data-handle="rot" title="Rotate" className={cn(HANDLE, "size-[11px] cursor-grab")} style={{ left: l + w / 2 - 5.5, top: t - 28 }} />
        </>
      )}
    </>
  );
}
