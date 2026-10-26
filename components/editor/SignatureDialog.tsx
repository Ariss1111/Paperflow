"use client";
import * as React from "react";
import * as D from "@radix-ui/react-dialog";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Segmented, Input } from "@/components/ui/controls";
import { cn } from "@/lib/utils";

const INKS = ["#1d1d1f", "#0b3d91", "#0071e3"];
const SCRIPTS = [
  { label: "Script", css: '"Snell Roundhand", "Segoe Script", "Brush Script MT", "Apple Chancery", cursive' },
  { label: "Classic", css: '"Bradley Hand", "Lucida Handwriting", "Segoe Print", cursive' },
  { label: "Plain", css: '"Helvetica Neue", "Segoe UI", sans-serif' },
];

/** Crops a canvas to its non-transparent pixels and returns a PNG blob. */
function trimmedPng(src: HTMLCanvasElement, pad = 8): Promise<Blob | null> {
  const ctx = src.getContext("2d")!;
  const { width, height } = src;
  const data = ctx.getImageData(0, 0, width, height).data;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return Promise.resolve(null);
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(width - 1, x1 + pad);
  y1 = Math.min(height - 1, y1 + pad);
  const out = document.createElement("canvas");
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext("2d")!.drawImage(src, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return new Promise((r) => out.toBlob(r, "image/png"));
}

export function SignatureDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: (file: File) => void }) {
  const [tab, setTab] = React.useState<"draw" | "type" | "upload">("draw");
  const [ink, setInk] = React.useState(INKS[0]);
  const [typed, setTyped] = React.useState("");
  const [script, setScript] = React.useState(0);
  const [hasStrokes, setHasStrokes] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const pad = React.useRef<HTMLCanvasElement>(null);
  const drawing = React.useRef<{ x: number; y: number; w: number } | null>(null);
  const uploadInput = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!open) return;
    setHasStrokes(false);
    requestAnimationFrame(() => {
      const c = pad.current;
      if (!c) return;
      const dpr = window.devicePixelRatio || 1;
      c.width = c.clientWidth * dpr;
      c.height = c.clientHeight * dpr;
      const ctx = c.getContext("2d")!;
      ctx.scale(dpr, dpr);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    });
  }, [open, tab]);

  const pos = (e: React.PointerEvent) => {
    const r = pad.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  // stylus pressure varies the stroke width; mouse/touch use a steady width
  const widthFor = (e: React.PointerEvent) => (e.pointerType === "pen" && e.pressure > 0 ? 1 + e.pressure * 3.5 : 2.6);

  const down = (e: React.PointerEvent) => {
    pad.current!.setPointerCapture(e.pointerId);
    const p = pos(e);
    drawing.current = { ...p, w: widthFor(e) };
    const ctx = pad.current!.getContext("2d")!;
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.arc(p.x, p.y, drawing.current.w / 2, 0, Math.PI * 2);
    ctx.fill();
    setHasStrokes(true);
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const ctx = pad.current!.getContext("2d")!;
    const p = pos(e);
    const w = drawing.current.w * 0.6 + widthFor(e) * 0.4;
    ctx.strokeStyle = ink;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(drawing.current.x, drawing.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    drawing.current = { ...p, w };
  };
  const clear = () => {
    const c = pad.current;
    if (!c) return;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setHasStrokes(false);
  };

  const finish = async (blob: Blob | null, name: string) => {
    if (!blob) return;
    onDone(new File([blob], name, { type: blob.type || "image/png" }));
    onOpenChange(false);
    setTyped("");
  };

  const useDrawn = async () => {
    setBusy(true);
    await finish(await trimmedPng(pad.current!), "signature.png");
    setBusy(false);
  };

  const useTyped = async () => {
    if (!typed.trim()) return;
    setBusy(true);
    const c = document.createElement("canvas");
    const size = 96;
    const ctx = c.getContext("2d")!;
    ctx.font = `${size}px ${SCRIPTS[script].css}`;
    c.width = Math.ceil(ctx.measureText(typed).width + 40);
    c.height = Math.ceil(size * 1.6);
    ctx.font = `${size}px ${SCRIPTS[script].css}`;
    ctx.fillStyle = ink;
    ctx.textBaseline = "middle";
    ctx.fillText(typed, 20, c.height / 2);
    await finish(await trimmedPng(c), "signature.png");
    setBusy(false);
  };

  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 animate-fade-in bg-black/25 dark:bg-black/50" />
        <D.Content className="fixed left-1/2 top-[12vh] z-50 w-[min(560px,calc(100vw-24px))] -translate-x-1/2 animate-sheet-in rounded-2xl bg-surface p-5 shadow-overlay focus:outline-none">
          <D.Title className="text-lg font-semibold text-ink">Add a signature</D.Title>
          <D.Description className="mt-1 text-sm text-ink-2">A visual signature placed on the page — not a certificate-based digital signature.</D.Description>
          <Segmented
            label="Signature method"
            className="mt-4"
            value={tab}
            onChange={setTab}
            options={[
              { value: "draw", label: "Draw" },
              { value: "type", label: "Type" },
              { value: "upload", label: "Upload" },
            ]}
          />
          <div className="mt-4">
            {tab === "draw" && (
              <>
                <canvas
                  ref={pad}
                  aria-label="Signature pad. Draw with mouse, touch or stylus."
                  onPointerDown={down}
                  onPointerMove={move}
                  onPointerUp={() => (drawing.current = null)}
                  onPointerCancel={() => (drawing.current = null)}
                  className="h-48 w-full cursor-crosshair touch-none rounded-xl bg-white shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.15)]"
                />
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-xs text-ink-3">Sign above the line</span>
                  <Button size="sm" variant="ghost" onClick={clear} disabled={!hasStrokes}>
                    Clear
                  </Button>
                </div>
              </>
            )}
            {tab === "type" && (
              <div className="space-y-3">
                <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Your name" aria-label="Your name" autoFocus maxLength={60} />
                <div className="grid grid-cols-3 gap-2">
                  {SCRIPTS.map((s, i) => (
                    <button key={s.label} type="button" onClick={() => setScript(i)} aria-pressed={script === i} className={cn("h-16 truncate rounded-xl bg-white px-2 text-2xl text-black shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.15)]", script === i && "ring-2 ring-accent")} style={{ fontFamily: s.css, color: ink }}>
                      {typed || "Signature"}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {tab === "upload" && (
              <button type="button" onClick={() => uploadInput.current?.click()} className="flex h-40 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-ink/20 text-sm text-ink-2 hover:bg-ink/[0.03]">
                <Upload className="size-5 text-accent" />
                Choose a PNG or JPG of your signature
                <span className="text-xs text-ink-3">A transparent PNG looks best.</span>
                <input
                  ref={uploadInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) {
                      onDone(f);
                      onOpenChange(false);
                    }
                  }}
                />
              </button>
            )}
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            {tab !== "upload" ? (
              <div role="radiogroup" aria-label="Ink color" className="flex gap-2">
                {INKS.map((c) => (
                  <button key={c} type="button" role="radio" aria-checked={ink === c} aria-label={c} onClick={() => setInk(c)} className={cn("size-6 rounded-full", ink === c && "ring-2 ring-accent ring-offset-2 ring-offset-surface")} style={{ background: c }} />
                ))}
              </div>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button onClick={() => onOpenChange(false)}>Cancel</Button>
              {tab === "draw" && (
                <Button variant="primary" onClick={useDrawn} disabled={!hasStrokes} loading={busy}>
                  Use signature
                </Button>
              )}
              {tab === "type" && (
                <Button variant="primary" onClick={useTyped} disabled={!typed.trim()} loading={busy}>
                  Use signature
                </Button>
              )}
            </div>
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
