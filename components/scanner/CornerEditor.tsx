"use client";
import * as React from "react";
import { FULL_FRAME, isValidQuad, type Corners } from "@/lib/scanner/client";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";

const NAMES = ["Top-left", "Top-right", "Bottom-right", "Bottom-left"];
const LOUPE = 128;
const ZOOM = 3;

/** Drag the four corners on the original photo, with a magnifier for precise placement. */
export function CornerEditor({
  source,
  corners: initial,
  detected,
  onCancel,
  onApply,
}: {
  source: Blob;
  corners: Corners;
  detected: boolean;
  onCancel: () => void;
  onApply: (c: Corners) => void;
}) {
  const [url] = React.useState(() => URL.createObjectURL(source));
  const [corners, setCorners] = React.useState<Corners>(initial);
  const [size, setSize] = React.useState<{ w: number; h: number } | null>(null);
  const [active, setActive] = React.useState<number | null>(null);
  const svg = React.useRef<SVGSVGElement>(null);
  const img = React.useRef<HTMLImageElement>(null);
  const loupe = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => () => URL.revokeObjectURL(url), [url]);

  const valid = isValidQuad(corners);

  const toNormalised = (e: React.PointerEvent): [number, number] => {
    const pt = svg.current!.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    // the inverse screen matrix accounts for the letterboxing of the fitted photo
    const p = pt.matrixTransform(svg.current!.getScreenCTM()!.inverse());
    return [Math.max(0, Math.min(1, p.x / size!.w)), Math.max(0, Math.min(1, p.y / size!.h))];
  };

  // the magnifier follows the corner being dragged
  React.useEffect(() => {
    if (active === null || !loupe.current || !img.current || !size) return;
    const ctx = loupe.current.getContext("2d");
    if (!ctx) return;
    const [x, y] = corners[active];
    const span = LOUPE / ZOOM;
    const scale = size.w / Math.max(1, img.current.clientWidth);
    const sw = span * Math.max(1, scale);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, LOUPE, LOUPE);
    ctx.drawImage(img.current, x * size.w - sw / 2, y * size.h - sw / 2, sw, sw, 0, 0, LOUPE, LOUPE);
    ctx.strokeStyle = "#0a84ff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(LOUPE / 2, 0);
    ctx.lineTo(LOUPE / 2, LOUPE);
    ctx.moveTo(0, LOUPE / 2);
    ctx.lineTo(LOUPE, LOUPE / 2);
    ctx.stroke();
  }, [active, corners, size]);

  const set = (i: number, p: [number, number]) => setCorners((c) => c.map((q, k) => (k === i ? p : q)));

  // handles stay the same on-screen size whatever the photo's resolution
  const unit = size ? size.w / Math.max(1, img.current?.clientWidth ?? size.w) : 1;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#111113] text-white">
      <div className="shrink-0 px-4 pb-2 pt-4 text-center">
        <h2 className="text-lg font-semibold">Adjust corners</h2>
        <p className="text-sm text-white/65">{detected ? "Drag each corner onto the corner of the page." : "We couldn't find the page edges automatically. Drag each corner onto the corner of the page."}</p>
      </div>
      <div className="relative min-h-0 flex-1 p-4">
        <div className="relative size-full">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img ref={img} src={url} alt="Captured photo" onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} className="absolute inset-0 size-full select-none object-contain" draggable={false} />
          {size && (
            <svg ref={svg} viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="xMidYMid meet" className="absolute inset-0 size-full touch-none overflow-visible" data-testid="corner-editor">
              <path
                d={`M0 0H${size.w}V${size.h}H0Z M${corners.map(([x, y]) => `${x * size.w} ${y * size.h}`).join("L")}Z`}
                fillRule="evenodd"
                fill="rgb(0 0 0 / 0.55)"
              />
              <polygon points={corners.map(([x, y]) => `${x * size.w},${y * size.h}`).join(" ")} fill="none" stroke={valid ? "#0a84ff" : "#ff453a"} strokeWidth={2 * unit} />
              {corners.map(([x, y], i) => (
                <g
                  key={i}
                  role="slider"
                  tabIndex={0}
                  aria-label={`${NAMES[i]} corner. Use arrow keys to move.`}
                  aria-valuetext={`${Math.round(x * 100)}% across, ${Math.round(y * 100)}% down`}
                  aria-valuenow={Math.round(x * 100)}
                  data-corner={i}
                  className="cursor-grab outline-none active:cursor-grabbing [&:focus-visible_.ring]:opacity-100"
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    setActive(i);
                  }}
                  onPointerMove={(e) => active === i && set(i, toNormalised(e))}
                  onPointerUp={() => setActive(null)}
                  onPointerCancel={() => setActive(null)}
                  onKeyDown={(e) => {
                    const d = e.shiftKey ? 0.01 : 0.002;
                    const move: Record<string, [number, number]> = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] };
                    const m = move[e.key];
                    if (!m) return;
                    e.preventDefault();
                    set(i, [Math.max(0, Math.min(1, x + m[0])), Math.max(0, Math.min(1, y + m[1]))]);
                  }}
                >
                  {/* generous invisible hit area for fingers */}
                  <circle cx={x * size.w} cy={y * size.h} r={26 * unit} fill="transparent" />
                  <circle className="ring opacity-0" cx={x * size.w} cy={y * size.h} r={15 * unit} fill="none" stroke="white" strokeWidth={2 * unit} />
                  <circle cx={x * size.w} cy={y * size.h} r={10 * unit} fill="rgb(10 132 255 / 0.35)" stroke="#fff" strokeWidth={2.5 * unit} />
                </g>
              ))}
            </svg>
          )}
          {active !== null && (
            <canvas
              ref={loupe}
              width={LOUPE}
              height={LOUPE}
              aria-hidden
              className="pointer-events-none absolute rounded-full shadow-overlay ring-2 ring-white"
              style={{ width: LOUPE, height: LOUPE, top: 8, ...(corners[active][0] < 0.5 ? { right: 8 } : { left: 8 }) }}
            />
          )}
        </div>
      </div>
      {!valid && (
        <div className="px-4">
          <Notice tone="warning">The corners cross each other. Move them so they form a four-sided outline of the page.</Notice>
        </div>
      )}
      <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        <Button onClick={onCancel}>Cancel</Button>
        <Button onClick={() => setCorners(FULL_FRAME)}>Use whole photo</Button>
        <Button variant="primary" disabled={!valid} onClick={() => onApply(corners)}>
          Apply crop
        </Button>
      </div>
    </div>
  );
}
