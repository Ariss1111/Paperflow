"use client";
import * as React from "react";
import { Crop, RotateCw, RefreshCcw, Plus, Check, Loader2 } from "lucide-react";
import { MODE_DEFAULTS, renderPage, type RawImage, type ScanMode, type ScanPage } from "@/lib/scanner/client";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/controls";
import { Notice } from "@/components/ui/feedback";
import { cn } from "@/lib/utils";

const MODES: { id: ScanMode; label: string }[] = [
  { id: "color", label: "Enhanced" },
  { id: "original", label: "Original" },
  { id: "contrast", label: "High contrast" },
  { id: "gray", label: "Grayscale" },
  { id: "bw", label: "Black & White" },
];

function ImageCanvas({ img, className, label }: { img: RawImage | null; className?: string; label?: string }) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => {
    const c = ref.current;
    if (!c || !img) return;
    c.width = img.width;
    c.height = img.height;
    c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  }, [img]);
  return <canvas ref={ref} role="img" aria-label={label} className={className} />;
}

/** Shows the cropped page; modes and options re-render live from the worker. */
export function ReviewView({
  page,
  isNew,
  busy,
  error,
  onChange,
  onAdjust,
  onRetake,
  onKeep,
  onCancel,
}: {
  page: ScanPage;
  isNew: boolean;
  busy: boolean;
  error: string | null;
  onChange: (p: ScanPage) => void;
  onAdjust: () => void;
  onRetake: () => void;
  onKeep: (next: "scan" | "finish") => void;
  onCancel: () => void;
}) {
  const [preview, setPreview] = React.useState<RawImage | null>(null);
  const [thumbs, setThumbs] = React.useState<Partial<Record<ScanMode, RawImage>>>({});
  const [rendering, setRendering] = React.useState(true);
  const [renderError, setRenderError] = React.useState<string | null>(null);
  const request = React.useRef(0);

  const geometry = `${page.id}|${JSON.stringify(page.corners)}|${page.rotation}`;
  const look = JSON.stringify([page.mode, page.options]);

  // main preview: debounced so dragging the contrast slider stays smooth; stale results are dropped
  React.useEffect(() => {
    const id = ++request.current;
    setRendering(true);
    const t = setTimeout(() => {
      renderPage(page, 1400)
        .then((img) => {
          if (id !== request.current) return;
          setPreview(img);
          setRenderError(null);
        })
        .catch((e) => id === request.current && setRenderError((e as Error).message))
        .finally(() => id === request.current && setRendering(false));
    }, 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometry, look]);

  // one small live preview per mode, side by side for comparison
  React.useEffect(() => {
    let live = true;
    (async () => {
      for (const m of MODES) {
        if (!live) return;
        const img = await renderPage({ ...page, mode: m.id, options: MODE_DEFAULTS[m.id] }, 220).catch(() => null);
        if (live && img) setThumbs((t) => ({ ...t, [m.id]: img }));
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometry]);

  const setOption = (p: Partial<ScanPage["options"]>) => onChange({ ...page, options: { ...page.options, ...p } });

  return (
    <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] bg-canvas lg:grid-cols-[minmax(0,1fr)_320px] lg:grid-rows-1">
      {/* page */}
      <div className="checker relative flex min-h-0 items-center justify-center p-4 sm:p-6">
        {preview ? (
          <ImageCanvas img={preview} label="Scanned page preview" className="max-h-full max-w-full rounded-[3px] bg-white object-contain shadow-[0_0_0_0.5px_rgb(0_0_0/0.12),0_12px_32px_-8px_rgb(0_0_0/0.3)]" />
        ) : (
          <p className="flex items-center gap-2 text-sm text-ink-2">
            <Loader2 className="size-4 animate-spin" /> Cropping and flattening the page…
          </p>
        )}
        {rendering && preview && (
          <span className="glass absolute right-4 top-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-ink-2 shadow-card">
            <Loader2 className="size-3 animate-spin" /> Updating
          </span>
        )}
      </div>

      {/* controls */}
      <div className="scroll-thin max-h-[52dvh] space-y-4 overflow-y-auto border-t bg-surface p-4 lg:max-h-none lg:border-l lg:border-t-0">
        {(error || renderError) && <Notice tone="danger">{error ?? renderError}</Notice>}
        <div>
          <p className="eyebrow mb-2">Look</p>
          <div role="radiogroup" aria-label="Enhancement mode" className="grid grid-cols-5 gap-1.5">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={page.mode === m.id}
                aria-label={m.label}
                onClick={() => onChange({ ...page, mode: m.id, options: MODE_DEFAULTS[m.id] })}
                className="group min-w-0 text-center"
              >
                <span className={cn("flex aspect-[3/4] items-center justify-center overflow-hidden rounded-lg bg-surface-2 transition-shadow", page.mode === m.id ? "ring-2 ring-accent ring-offset-2 ring-offset-surface" : "shadow-hairline group-hover:shadow-card")}>
                  {thumbs[m.id] ? <ImageCanvas img={thumbs[m.id]!} className="max-h-full max-w-full bg-white" /> : <Loader2 className="size-3.5 animate-spin text-ink-3" />}
                </span>
                <span className={cn("mt-1.5 block text-2xs font-medium leading-[1.2]", page.mode === m.id ? "text-accent" : "text-ink-2")}>{m.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          {page.mode !== "bw" && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-sm">
                <label htmlFor="scan-contrast" className="font-medium text-ink">
                  Contrast
                </label>
                <span className="tabular-nums text-ink-3">{Math.round(page.options.contrast * 100)}%</span>
              </div>
              <input id="scan-contrast" type="range" min={0} max={100} value={Math.round(page.options.contrast * 100)} onChange={(e) => setOption({ contrast: Number(e.target.value) / 100 })} className="h-1 w-full cursor-pointer accent-[rgb(var(--accent))]" />
            </div>
          )}
          {page.mode !== "bw" && (
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="scan-shadows" className="text-sm text-ink">
                Reduce shadows
              </label>
              <Switch id="scan-shadows" checked={page.options.shadows} onCheckedChange={(shadows) => setOption({ shadows })} />
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="scan-read" className="text-sm text-ink">
              Improve readability
            </label>
            <Switch id="scan-read" checked={page.options.readability} onCheckedChange={(readability) => setOption({ readability })} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="scan-sharp" className="text-sm text-ink">
              Sharpen text
            </label>
            <Switch id="scan-sharp" checked={page.options.sharpen} onCheckedChange={(sharpen) => setOption({ sharpen })} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Button size="sm" icon={<Crop className="size-3.5" />} onClick={onAdjust}>
            Corners
          </Button>
          <Button size="sm" icon={<RotateCw className="size-3.5" />} onClick={() => onChange({ ...page, rotation: (page.rotation + 90) % 360 })}>
            Rotate
          </Button>
          <Button size="sm" icon={<RefreshCcw className="size-3.5" />} onClick={onRetake}>
            Retake
          </Button>
        </div>

        <div className="space-y-2">
          {isNew ? (
            <>
              <Button variant="primary" size="lg" className="w-full" loading={busy} icon={<Check className="size-4" />} onClick={() => onKeep("finish")}>
                Done
              </Button>
              <Button size="lg" className="w-full" disabled={busy} icon={<Plus className="size-4" />} onClick={() => onKeep("scan")}>
                Add another page
              </Button>
            </>
          ) : (
            <>
              <Button variant="primary" size="lg" className="w-full" loading={busy} icon={<Check className="size-4" />} onClick={() => onKeep("finish")}>
                Save changes
              </Button>
              <Button size="lg" className="w-full" disabled={busy} onClick={onCancel}>
                Cancel
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
