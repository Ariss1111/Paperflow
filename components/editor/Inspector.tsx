"use client";
import * as React from "react";
import { Trash2, AlignLeft, AlignCenter, AlignRight, Bold, Layers3, PenTool, Eraser, Info } from "lucide-react";
import type { EditDocument, EditObject, FontId } from "@/lib/editor/model";
import { OBJECT_KIND } from "@/lib/editor/model";
import { Button, IconButton } from "@/components/ui/button";
import { Field, Select, Segmented, Switch, Textarea } from "@/components/ui/controls";
import { Badge } from "@/components/ui/feedback";
import { FONT_LABEL } from "./fonts";
import { fitText, type ToolStyle } from "./PageView";
import type { EditorApi } from "./useEditorState";
import { cn } from "@/lib/utils";

const SWATCHES = ["#1d1d1f", "#0071e3", "#d70015", "#248a3d", "#bf5af2", "#ff9f0a", "#ffffff"];
const HIGHLIGHTS = ["#ffd60a", "#34c759", "#5ac8fa", "#ff9fb2", "#bf9fff"];

const KIND_INFO = {
  overlay: { label: "Overlay", tone: "accent" as const, text: "Drawn on top of the page. The original content underneath is unchanged." },
  annotation: { label: "Annotation", tone: "success" as const, text: "A standard PDF annotation. Other viewers can show, edit or hide it unless you flatten on export." },
  content: { label: "Content change", tone: "warning" as const, text: "Removes the original page content in this area for real (redaction), then places your replacement." },
};

const NAMES: Record<EditObject["type"], string> = {
  text: "Text",
  replace: "Replaced text",
  image: "Image",
  signature: "Signature",
  ink: "Drawing",
  rect: "Rectangle",
  ellipse: "Ellipse",
  line: "Line",
  arrow: "Arrow",
  highlight: "Highlight",
  underline: "Underline",
  strike: "Strikethrough",
  comment: "Comment",
  erase: "Erased area",
};

function Swatches({ value, onChange, colors = SWATCHES, label }: { value: string; onChange: (c: string) => void; colors?: string[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value.toLowerCase() === c}
          aria-label={c}
          onClick={() => onChange(c)}
          className={cn("size-6 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)] transition-transform hover:scale-110", value.toLowerCase() === c && "ring-2 ring-accent ring-offset-2 ring-offset-surface")}
          style={{ background: c }}
        />
      ))}
      <label className="relative size-6 cursor-pointer overflow-hidden rounded-full bg-[conic-gradient(red,yellow,lime,cyan,blue,magenta,red)] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)]" title="Custom color">
        <input type="color" value={value.startsWith("#") ? value : "#000000"} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Custom color" />
      </label>
    </div>
  );
}

function Slider({ label, value, min, max, step = 1, unit, onChange }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-sm">
        <span className="font-medium text-ink">{label}</span>
        <span className="tabular-nums text-ink-3">
          {Math.round(value * 100) / 100}
          {unit}
        </span>
      </div>
      <input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-1 w-full cursor-pointer accent-[rgb(var(--accent))]" />
    </div>
  );
}

export function Inspector({
  object,
  editor,
  doc,
  style,
  setStyle,
  onDelete,
  mode,
}: {
  object: EditObject | null;
  editor: EditorApi;
  doc: EditDocument;
  style: ToolStyle;
  setStyle: (s: Partial<ToolStyle>) => void;
  onDelete: () => void;
  mode: "edit" | "sign";
}) {
  if (!object) {
    const counts = { overlay: 0, annotation: 0, content: 0 };
    doc.objects.forEach((o) => counts[OBJECT_KIND[o.type]]++);
    return (
      <div className="space-y-6 p-4">
        <div>
          <p className="eyebrow mb-3">Default style</p>
          <div className="space-y-4">
            <Field label="Color">
              <Swatches label="Default color" value={style.stroke} onChange={(c) => setStyle({ stroke: c, color: c })} />
            </Field>
            <Field label="Highlight">
              <Swatches label="Highlight color" value={style.highlight} colors={HIGHLIGHTS} onChange={(c) => setStyle({ highlight: c })} />
            </Field>
            <Slider label="Line width" value={style.width} min={0.5} max={12} step={0.5} unit=" pt" onChange={(width) => setStyle({ width })} />
            <Slider label="Text size" value={style.size} min={6} max={72} unit=" pt" onChange={(size) => setStyle({ size })} />
          </div>
        </div>
        <div>
          <p className="eyebrow mb-2">Changes</p>
          <ul className="space-y-2 text-sm">
            {(Object.keys(counts) as (keyof typeof counts)[]).map((k) => (
              <li key={k} className="flex items-center justify-between">
                <Badge tone={KIND_INFO[k].tone}>{KIND_INFO[k].label}</Badge>
                <span className="tabular-nums text-ink-2">{counts[k]}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex items-start justify-between gap-3">
          <label htmlFor="flatten" className="text-sm text-ink">
            Flatten on export
            <span className="mt-0.5 block text-xs text-ink-3">Bakes annotations and form fields into the page so they can&apos;t be edited.</span>
          </label>
          <Switch id="flatten" checked={!!doc.flattenAnnotations} onCheckedChange={editor.setFlatten} />
        </div>
        <div className="rounded-xl bg-surface-2 p-3 text-xs leading-5 text-ink-2">
          <Info className="mb-1 size-3.5 text-ink-3" aria-hidden />
          {mode === "sign" ? (
            <>This places a <strong className="text-ink">visual signature</strong>. It is not a cryptographic digital signature and does not certify the document.</>
          ) : (
            <>To change existing text, choose <strong className="text-ink">Edit text</strong> and click a line: the original glyphs are removed and your replacement is placed with a matching size. Fonts are substituted, and surrounding text won&apos;t reflow. Scanned pages have no text to edit — run OCR first.</>
          )}
        </div>
      </div>
    );
  }

  const o = object;
  const kind = KIND_INFO[OBJECT_KIND[o.type]];
  const set = (p: Partial<EditObject>) => editor.patch(o.id, p);
  return (
    <div className="space-y-5 p-4">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-ink">{NAMES[o.type]}</p>
        <IconButton label="Delete" onClick={onDelete} className="hover:text-danger">
          <Trash2 className="size-4" />
        </IconButton>
      </div>
      <div className="flex gap-2 rounded-xl bg-surface-2 p-3 text-xs leading-4 text-ink-2">
        {OBJECT_KIND[o.type] === "overlay" ? <Layers3 className="size-4 shrink-0 text-accent" /> : OBJECT_KIND[o.type] === "annotation" ? <PenTool className="size-4 shrink-0 text-success" /> : <Eraser className="size-4 shrink-0 text-warning" />}
        <span>
          <strong className="text-ink">{kind.label}.</strong> {kind.text}
        </span>
      </div>

      {(o.type === "text" || o.type === "replace") && (
        <>
          {o.type === "replace" && (
            <p className="text-xs text-ink-3">
              Original: <span className="text-ink-2">“{o.original}”</span>
            </p>
          )}
          <Field label="Text" htmlFor="insp-text">
            <Textarea id="insp-text" rows={3} value={o.text} onChange={(e) => editor.patch(o.id, fitText({ ...o, text: e.target.value }) as Partial<EditObject>, `text:${o.id}`)} onBlur={editor.commit} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Font" htmlFor="insp-font">
              <Select id="insp-font" value={o.font} onChange={(e) => set(fitText({ ...o, font: e.target.value as FontId }) as Partial<EditObject>)}>
                {(Object.keys(FONT_LABEL) as FontId[]).map((f) => (
                  <option key={f} value={f}>
                    {FONT_LABEL[f]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Size" htmlFor="insp-size">
              <Select id="insp-size" value={String(o.size)} onChange={(e) => set(fitText({ ...o, size: Number(e.target.value) }) as Partial<EditObject>)}>
                {[...new Set([6, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64, 72, o.size])].sort((a, b) => a - b).map((s) => (
                  <option key={s} value={s}>
                    {s} pt
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="flex items-center gap-2">
            <Segmented
              label="Alignment"
              value={o.align}
              onChange={(align) => set({ align })}
              className="flex-1"
              options={[
                { value: "left", label: <AlignLeft className="mx-auto size-3.5" />, title: "Align left" },
                { value: "center", label: <AlignCenter className="mx-auto size-3.5" />, title: "Center" },
                { value: "right", label: <AlignRight className="mx-auto size-3.5" />, title: "Align right" },
              ]}
            />
            <IconButton label="Bold" active={o.bold} onClick={() => set(fitText({ ...o, bold: !o.bold }) as Partial<EditObject>)}>
              <Bold className="size-4" />
            </IconButton>
          </div>
          <Field label="Color">
            <Swatches label="Text color" value={o.color} onChange={(color) => set({ color })} />
          </Field>
        </>
      )}

      {(o.type === "image" || o.type === "signature") && (
        <>
          <Slider label="Rotation" value={o.rotation} min={0} max={359} unit="°" onChange={(rotation) => editor.patch(o.id, { rotation }, `rot:${o.id}`)} />
          <Slider label="Opacity" value={Math.round(o.opacity * 100)} min={10} max={100} unit="%" onChange={(v) => editor.patch(o.id, { opacity: v / 100 }, `op:${o.id}`)} />
          <Button size="sm" onClick={() => set({ rotation: 0 })}>
            Reset rotation
          </Button>
        </>
      )}

      {(o.type === "rect" || o.type === "ellipse") && (
        <>
          <Field label="Stroke">
            <Swatches label="Stroke color" value={o.stroke} onChange={(stroke) => set({ stroke })} />
          </Field>
          <Field label="Fill">
            <div className="flex items-center gap-2">
              <Swatches label="Fill color" value={o.fill ?? ""} onChange={(fill) => set({ fill })} />
              <Button size="sm" variant="ghost" onClick={() => set({ fill: null })} aria-pressed={o.fill === null}>
                None
              </Button>
            </div>
          </Field>
          <Slider label="Border width" value={o.width} min={0} max={12} step={0.5} unit=" pt" onChange={(width) => editor.patch(o.id, { width }, `w:${o.id}`)} />
          <Slider label="Opacity" value={Math.round(o.opacity * 100)} min={10} max={100} unit="%" onChange={(v) => editor.patch(o.id, { opacity: v / 100 }, `op:${o.id}`)} />
        </>
      )}

      {(o.type === "line" || o.type === "arrow" || o.type === "ink") && (
        <>
          <Field label="Color">
            <Swatches label="Line color" value={o.color} onChange={(color) => set({ color })} />
          </Field>
          <Slider label="Width" value={o.width} min={0.5} max={12} step={0.5} unit=" pt" onChange={(width) => editor.patch(o.id, { width }, `w:${o.id}`)} />
          <Slider label="Opacity" value={Math.round(o.opacity * 100)} min={10} max={100} unit="%" onChange={(v) => editor.patch(o.id, { opacity: v / 100 }, `op:${o.id}`)} />
        </>
      )}

      {(o.type === "highlight" || o.type === "underline" || o.type === "strike") && (
        <Field label="Color">
          <Swatches label="Markup color" value={o.color} colors={o.type === "highlight" ? HIGHLIGHTS : SWATCHES} onChange={(color) => set({ color })} />
        </Field>
      )}

      {o.type === "comment" && (
        <>
          <Field label="Comment" htmlFor="insp-comment">
            <Textarea id="insp-comment" autoFocus rows={5} value={o.text} placeholder="Write a note…" onChange={(e) => editor.patch(o.id, { text: e.target.value }, `c:${o.id}`)} onBlur={editor.commit} />
          </Field>
          <Field label="Color">
            <Swatches label="Note color" value={o.color} colors={HIGHLIGHTS} onChange={(color) => set({ color })} />
          </Field>
        </>
      )}

      {o.type === "erase" && (
        <Field label="Fill after removal" hint="Everything under this area — text, images and drawings — is permanently removed on export.">
          <Swatches label="Fill color" value={o.fill} colors={["#ffffff", "#000000", "#f2f2f4"]} onChange={(fill) => set({ fill })} />
        </Field>
      )}
    </div>
  );
}
