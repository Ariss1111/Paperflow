"use client";
import * as React from "react";
import type { PageNumberSettings, WatermarkSettings } from "@/lib/editor/model";
import { Sheet } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Segmented, Select } from "@/components/ui/controls";

export const DEFAULT_WATERMARK: WatermarkSettings = { text: "CONFIDENTIAL", size: 54, color: "#d70015", opacity: 0.25, angle: 45, position: "center" };
export const DEFAULT_PAGE_NUMBERS: PageNumberSettings = { position: "bottom-center", format: "{n}", start: 1, size: 10 };

function Slider({ id, label, value, min, max, unit, onChange }: { id: string; label: string; value: number; min: number; max: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-sm">
        <label htmlFor={id} className="font-medium text-ink">
          {label}
        </label>
        <span className="tabular-nums text-ink-3">
          {value}
          {unit}
        </span>
      </div>
      <input id={id} type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-1 w-full cursor-pointer accent-[rgb(var(--accent))]" />
    </div>
  );
}

/** Watermark settings; the editor previews it on every page and the export stamps it for real. */
export function WatermarkDialog({ open, value, onOpenChange, onApply }: { open: boolean; value: WatermarkSettings | null | undefined; onOpenChange: (o: boolean) => void; onApply: (w: WatermarkSettings | null) => void }) {
  const [w, setW] = React.useState<WatermarkSettings>(value ?? DEFAULT_WATERMARK);
  React.useEffect(() => {
    if (open) setW(value ?? DEFAULT_WATERMARK);
  }, [open, value]);
  const set = (p: Partial<WatermarkSettings>) => setW((x) => ({ ...x, ...p }));
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Watermark"
      description="Stamped on every page of the exported PDF."
      footer={
        <>
          {value && (
            <Button variant="ghost" className="mr-auto text-danger" onClick={() => { onApply(null); onOpenChange(false); }}>
              Remove watermark
            </Button>
          )}
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" disabled={!w.text.trim()} onClick={() => { onApply({ ...w, text: w.text.trim() }); onOpenChange(false); }}>
            {value ? "Update" : "Add watermark"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Text" htmlFor="wm-text">
          <Input id="wm-text" value={w.text} maxLength={200} onChange={(e) => set({ text: e.target.value })} />
        </Field>
        <Field label="Layout">
          <Segmented label="Layout" value={w.position} onChange={(position) => set({ position })} options={[{ value: "center", label: "Centered" }, { value: "tile", label: "Tiled" }]} />
        </Field>
        <Slider id="wm-size" label="Size" value={w.size} min={12} max={140} unit=" pt" onChange={(size) => set({ size })} />
        <Slider id="wm-angle" label="Angle" value={w.angle} min={-90} max={90} unit="°" onChange={(angle) => set({ angle })} />
        <Slider id="wm-opacity" label="Opacity" value={Math.round(w.opacity * 100)} min={5} max={100} unit="%" onChange={(v) => set({ opacity: v / 100 })} />
        <Field label="Color" htmlFor="wm-color" inline>
          <input id="wm-color" type="color" value={w.color} onChange={(e) => set({ color: e.target.value })} className="h-7 w-10 cursor-pointer rounded-md border-0 bg-transparent p-0" />
        </Field>
      </div>
    </Sheet>
  );
}

export function PageNumbersDialog({ open, value, onOpenChange, onApply }: { open: boolean; value: PageNumberSettings | null | undefined; onOpenChange: (o: boolean) => void; onApply: (p: PageNumberSettings | null) => void }) {
  const [p, setP] = React.useState<PageNumberSettings>(value ?? DEFAULT_PAGE_NUMBERS);
  React.useEffect(() => {
    if (open) setP(value ?? DEFAULT_PAGE_NUMBERS);
  }, [open, value]);
  const set = (x: Partial<PageNumberSettings>) => setP((v) => ({ ...v, ...x }));
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Page numbers"
      description="Added to every page of the exported PDF, upright even on rotated pages."
      footer={
        <>
          {value && (
            <Button variant="ghost" className="mr-auto text-danger" onClick={() => { onApply(null); onOpenChange(false); }}>
              Remove numbers
            </Button>
          )}
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onClick={() => { onApply({ ...p, format: p.format.trim() || "{n}" }); onOpenChange(false); }}>
            {value ? "Update" : "Add page numbers"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Position" htmlFor="pn-pos">
          <Select id="pn-pos" value={p.position} onChange={(e) => set({ position: e.target.value as PageNumberSettings["position"] })}>
            <option value="bottom-center">Bottom center</option>
            <option value="bottom-right">Bottom right</option>
            <option value="bottom-left">Bottom left</option>
            <option value="top-center">Top center</option>
            <option value="top-right">Top right</option>
            <option value="top-left">Top left</option>
          </Select>
        </Field>
        <Field label="Format" htmlFor="pn-format" hint="{n} is the page number, {total} the page count. Example: Page {n} of {total}">
          <Input id="pn-format" value={p.format} maxLength={80} onChange={(e) => set({ format: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First number" htmlFor="pn-start">
            <Input id="pn-start" type="number" min={0} max={100000} value={p.start} onChange={(e) => set({ start: Math.max(0, Number(e.target.value) || 0) })} />
          </Field>
          <Field label="Size" htmlFor="pn-size">
            <Input id="pn-size" type="number" min={6} max={48} value={p.size} onChange={(e) => set({ size: Math.min(48, Math.max(6, Number(e.target.value) || 10)) })} />
          </Field>
        </div>
      </div>
    </Sheet>
  );
}

/** Live preview of the stamps on one page (the export draws the real thing server-side). */
export function StampPreview({ watermark, pageNumbers, index, total, scale, width, height }: { watermark?: WatermarkSettings | null; pageNumbers?: PageNumberSettings | null; index: number; total: number; scale: number; width: number; height: number }) {
  if (!watermark && !pageNumbers) return null;
  const label = pageNumbers ? pageNumbers.format.replaceAll("{n}", String(pageNumbers.start + index)).replaceAll("{total}", String(pageNumbers.start + total - 1)) : "";
  const margin = 28 * scale;
  const [vert, horiz] = (pageNumbers?.position ?? "bottom-center").split("-");
  const wmStyle = (extra: React.CSSProperties = {}): React.CSSProperties => ({
    fontFamily: '"PF Sans"',
    fontWeight: 700,
    fontSize: (watermark?.size ?? 0) * scale,
    color: watermark?.color,
    opacity: watermark?.opacity,
    transform: `rotate(${-(watermark?.angle ?? 0)}deg)`,
    whiteSpace: "nowrap",
    lineHeight: 1,
    ...extra,
  });
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden" data-testid="stamp-preview">
      {watermark && watermark.position === "center" && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span style={wmStyle()}>{watermark.text}</span>
        </div>
      )}
      {watermark && watermark.position === "tile" && (
        <div className="absolute flex flex-wrap content-start items-center justify-around" style={{ inset: -height * 0.25, gap: watermark.size * scale * 2 }}>
          {Array.from({ length: Math.min(60, Math.ceil(((width * height) / Math.max(1, (watermark.size * scale) ** 2)) / 24) + 4) }, (_, i) => (
            <span key={i} style={wmStyle()}>
              {watermark.text}
            </span>
          ))}
        </div>
      )}
      {pageNumbers && (
        <span
          className="absolute whitespace-nowrap"
          style={{
            fontFamily: '"PF Sans"',
            fontSize: pageNumbers.size * scale,
            color: "rgb(51 51 56)",
            lineHeight: 1,
            [vert === "top" ? "top" : "bottom"]: margin,
            ...(horiz === "left" ? { left: margin } : horiz === "right" ? { right: margin } : { left: "50%", transform: "translateX(-50%)" }),
          }}
        >
          {label}
        </span>
      )}
    </div>
  );
}
