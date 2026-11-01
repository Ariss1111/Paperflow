"use client";
import * as React from "react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, rectSortingStrategy, arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { RotateCw, Trash2, Pencil, RefreshCcw, Plus, Download, ChevronDown, Loader2, ArrowRight } from "lucide-react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import type { ScanPage } from "@/lib/scanner/client";
import { Button, IconButton } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/controls";
import { Badge, Notice, EmptyState } from "@/components/ui/feedback";
import { cn } from "@/lib/utils";
import { ScanLine } from "lucide-react";

const CONTINUE = [
  { label: "PDF Editor", href: "/editor" },
  { label: "Organize Pages", href: "/tools/organize" },
  { label: "OCR (make searchable)", href: "/tools/ocr" },
  { label: "Compress PDF", href: "/tools/compress" },
  { label: "Sign PDF", href: "/tools/sign" },
  { label: "Protect PDF", href: "/tools/protect" },
];

function Tile({ page, index, busy, onRotate, onEdit, onRetake, onDelete }: { page: ScanPage; index: number; busy: boolean; onRotate: () => void; onEdit: () => void; onRetake: () => void; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: page.id });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn("flex flex-col rounded-[16px] bg-surface p-3 shadow-card", isDragging && "relative z-10 shadow-raised")} data-testid="scan-page">
      <button type="button" {...attributes} {...listeners} aria-label={`Page ${index + 1}. Drag, or press space and use arrow keys, to reorder.`} className="relative flex aspect-[3/4] cursor-grab touch-none items-center justify-center overflow-hidden rounded-lg bg-surface-2 active:cursor-grabbing">
        {page.resultUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={page.resultUrl} alt="" draggable={false} className="max-h-full max-w-full bg-white object-contain shadow-[0_0_0_0.5px_rgb(0_0_0/0.12)]" />
        )}
        {busy && (
          <span className="absolute inset-0 flex items-center justify-center bg-surface/60">
            <Loader2 className="size-5 animate-spin text-ink-2" />
          </span>
        )}
      </button>
      <div className="mt-2 flex items-center justify-between gap-1">
        <span className="pl-1 text-xs font-semibold tabular-nums text-ink-2">{index + 1}</span>
        {!page.detected && <Badge tone="warning">Check crop</Badge>}
        <div className="flex">
          <IconButton size="sm" label={`Rotate page ${index + 1}`} onClick={onRotate} disabled={busy}>
            <RotateCw className="size-3.5" />
          </IconButton>
          <IconButton size="sm" label={`Edit page ${index + 1}`} onClick={onEdit} disabled={busy}>
            <Pencil className="size-3.5" />
          </IconButton>
          <IconButton size="sm" label={`Retake page ${index + 1}`} onClick={onRetake} disabled={busy}>
            <RefreshCcw className="size-3.5" />
          </IconButton>
          <IconButton size="sm" label={`Delete page ${index + 1}`} onClick={onDelete} className="hover:text-danger">
            <Trash2 className="size-3.5" />
          </IconButton>
        </div>
      </div>
    </li>
  );
}

export function PagesView({
  pages,
  title,
  busyId,
  exporting,
  error,
  onTitle,
  onReorder,
  onRotate,
  onEdit,
  onRetake,
  onDelete,
  onAdd,
  onDownload,
  onContinue,
}: {
  pages: ScanPage[];
  title: string;
  busyId: string | null;
  exporting: "download" | "continue" | null;
  error: string | null;
  onTitle: (t: string) => void;
  onReorder: (p: ScanPage[]) => void;
  onRotate: (p: ScanPage) => void;
  onEdit: (p: ScanPage) => void;
  onRetake: (p: ScanPage) => void;
  onDelete: (p: ScanPage) => void;
  onAdd: () => void;
  onDownload: () => void;
  onContinue: (href: string) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    onReorder(arrayMove(pages, pages.findIndex((p) => p.id === e.active.id), pages.findIndex((p) => p.id === e.over!.id)));
  };
  return (
    <div className="scroll-thin h-full overflow-y-auto bg-canvas">
      <div className="mx-auto grid max-w-[1180px] gap-6 p-4 sm:p-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section aria-label="Scanned pages" className="min-w-0">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-[-0.022em] text-ink">Your scan</h1>
              <p className="text-sm text-ink-2">
                {pages.length} page{pages.length === 1 ? "" : "s"} · drag to reorder
              </p>
            </div>
            <Button icon={<Plus className="size-4" />} onClick={onAdd}>
              Add page
            </Button>
          </div>
          {pages.length === 0 ? (
            <div className="rounded-[18px] bg-surface shadow-card">
              <EmptyState icon={<ScanLine className="size-5" />} title="No pages yet" action={<Button variant="primary" onClick={onAdd}>Scan a page</Button>}>
                Every page you keep appears here.
              </EmptyState>
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={pages.map((p) => p.id)} strategy={rectSortingStrategy}>
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(210px,1fr))]" aria-label="Pages">
                  {pages.map((p, i) => (
                    <Tile key={p.id} page={p} index={i} busy={busyId === p.id} onRotate={() => onRotate(p)} onEdit={() => onEdit(p)} onRetake={() => onRetake(p)} onDelete={() => onDelete(p)} />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          )}
        </section>

        <aside aria-label="Export" className="lg:sticky lg:top-8 lg:self-start">
          <div className="space-y-4 rounded-[18px] bg-surface p-5 shadow-card">
            <Field label="File name" htmlFor="scan-title">
              <div className="relative">
                <Input id="scan-title" value={title} maxLength={120} onChange={(e) => onTitle(e.target.value)} className="pr-11" />
                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-ink-3">.pdf</span>
              </div>
            </Field>
            {error && <Notice tone="danger">{error}</Notice>}
            <Button variant="primary" size="lg" className="w-full" icon={<Download className="size-4" />} loading={exporting === "download"} disabled={!pages.length || !!exporting} onClick={onDownload}>
              Download PDF
            </Button>
            <Menu.Root>
              <Menu.Trigger asChild>
                <Button size="lg" className="w-full" loading={exporting === "continue"} disabled={!pages.length || !!exporting} icon={<ArrowRight className="size-4" />}>
                  Continue editing <ChevronDown className="size-3.5 opacity-60" />
                </Button>
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Content align="end" sideOffset={6} className="glass z-50 w-60 animate-rise-in rounded-xl p-1.5 shadow-overlay">
                  {CONTINUE.map((c) => (
                    <Menu.Item key={c.href} onSelect={() => onContinue(c.href)} className="cursor-default rounded-lg px-2.5 py-1.5 text-sm text-ink outline-none data-[highlighted]:bg-accent data-[highlighted]:text-white">
                      {c.label}
                    </Menu.Item>
                  ))}
                </Menu.Content>
              </Menu.Portal>
            </Menu.Root>
            <p className="text-xs leading-4 text-ink-3">Scanning and the PDF happen on this device. A file is only uploaded if you choose Continue editing.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
