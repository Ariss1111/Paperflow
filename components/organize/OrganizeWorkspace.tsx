"use client";
import * as React from "react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, rectSortingStrategy, arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { RotateCw, RotateCcw, Copy, Trash2, FilePlus2, Undo2, Redo2, FileOutput, CheckSquare } from "lucide-react";
import type { ToolDef } from "@/lib/tools/catalog";
import { Container } from "@/components/shell/AppShell";
import { ToolHeader, UploadErrors } from "@/components/tool/ToolWorkspace";
import { DropZone } from "@/components/files/DropZone";
import { useUploader } from "@/components/files/useUploader";
import { PageThumb } from "@/components/files/PageThumb";
import { Button, IconButton } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { useConfirm } from "@/components/ui/dialog";
import { Processing, Result, Failure } from "@/components/tool/JobPanel";
import { useJob } from "@/components/tool/useJob";
import { useSelectedFiles } from "@/components/tool/useSelectedFiles";
import { cn, baseName } from "@/lib/utils";
import type { StoredFile } from "@/types";

interface Item {
  key: string;
  file: string; // file id
  page: number; // zero-based
  rotate: number;
}

let seq = 0;
const k = () => `p${++seq}`;
const itemsFor = (f: StoredFile): Item[] => Array.from({ length: f.pages ?? 0 }, (_, i) => ({ key: k(), file: f.id, page: i, rotate: 0 }));

function useHistory<T>(initial: T) {
  const [stack, setStack] = React.useState<{ past: T[]; present: T; future: T[] }>({ past: [], present: initial, future: [] });
  const set = (next: T | ((p: T) => T)) =>
    setStack((s) => ({ past: [...s.past.slice(-99), s.present], present: typeof next === "function" ? (next as (p: T) => T)(s.present) : next, future: [] }));
  const undo = () => setStack((s) => (s.past.length ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future] } : s));
  const redo = () => setStack((s) => (s.future.length ? { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) } : s));
  const reset = (v: T) => setStack({ past: [], present: v, future: [] });
  return { value: stack.present, set, undo, redo, reset, canUndo: stack.past.length > 0, canRedo: stack.future.length > 0 };
}

function Tile({ item, index, selected, onToggle, onRotate, onDuplicate, onDelete, sourceLabel }: {
  item: Item;
  index: number;
  selected: boolean;
  onToggle: (e: React.MouseEvent | React.KeyboardEvent) => void;
  onRotate: (d: number) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  sourceLabel?: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.key });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("group relative flex flex-col items-center gap-2 rounded-xl p-2.5 transition-colors", selected ? "bg-accent/[0.1]" : "hover:bg-ink/[0.03]", isDragging && "z-10 opacity-90")}
    >
      <div
        {...attributes}
        {...listeners}
        role="button"
        aria-pressed={selected}
        aria-label={`Page ${index + 1}${sourceLabel ? ` from ${sourceLabel}` : ""}. Press space to pick up and move, Enter to select.`}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter") onToggle(e);
          if (e.key === "Delete" || e.key === "Backspace") onDelete();
        }}
        className={cn("cursor-grab touch-none rounded-[5px] outline-offset-4 active:cursor-grabbing", selected && "ring-2 ring-accent ring-offset-2 ring-offset-canvas")}
      >
        <PageThumb fileId={item.file} page={item.page + 1} rotation={item.rotate} width={120} />
      </div>
      <div className="flex w-full items-center justify-between gap-1">
        <span className="pl-1 text-xs font-medium tabular-nums text-ink-2">
          {index + 1}
          {sourceLabel && <span className="ml-1 font-normal text-ink-3">· {sourceLabel}</span>}
        </span>
        <div className="flex opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
          <IconButton size="sm" label="Rotate left" onClick={() => onRotate(-90)}>
            <RotateCcw className="size-3.5" />
          </IconButton>
          <IconButton size="sm" label="Rotate right" onClick={() => onRotate(90)}>
            <RotateCw className="size-3.5" />
          </IconButton>
          <IconButton size="sm" label="Duplicate page" onClick={onDuplicate}>
            <Copy className="size-3.5" />
          </IconButton>
          <IconButton size="sm" label="Delete page" onClick={onDelete} className="hover:text-danger">
            <Trash2 className="size-3.5" />
          </IconButton>
        </div>
      </div>
    </li>
  );
}

export function OrganizeWorkspace({ tool }: { tool: ToolDef }) {
  const { files, setFiles } = useSelectedFiles();
  const uploader = useUploader(["pdf"]);
  const history = useHistory<Item[]>([]);
  const items = history.value;
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const anchor = React.useRef<string | null>(null);
  const { state, start, cancel, retry, reset } = useJob();
  const { confirm, element: confirmEl } = useConfirm();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const seeded = React.useRef(false);

  // seed the grid when files arrive via ?files=
  React.useEffect(() => {
    if (!seeded.current && files.length && items.length === 0) {
      seeded.current = true;
      history.reset(files.filter((f) => !f.encrypted).flatMap(itemsFor));
    }
  }, [files]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea")) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) history.redo();
        else history.undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        history.redo();
      } else if (mod && e.key.toLowerCase() === "a" && items.length) {
        e.preventDefault();
        setSelected(new Set(items.map((i) => i.key)));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const addPdfs = async (list: File[], insertAt?: number) => {
    const up = (await uploader.upload(list)).filter((f) => f.format === "pdf");
    const usable = up.filter((f) => !f.encrypted);
    if (!usable.length) return;
    setFiles((prev) => [...prev, ...usable.filter((u) => !prev.some((p) => p.id === u.id))]);
    const newItems = usable.flatMap(itemsFor);
    history.set((prev) => {
      const at = insertAt ?? prev.length;
      return [...prev.slice(0, at), ...newItems, ...prev.slice(at)];
    });
  };

  const toggle = (key: string, e: React.MouseEvent | React.KeyboardEvent) => {
    setSelected((prev) => {
      const next = new Set(e.metaKey || e.ctrlKey || e.shiftKey ? prev : []);
      if (e.shiftKey && anchor.current) {
        const a = items.findIndex((i) => i.key === anchor.current);
        const b = items.findIndex((i) => i.key === key);
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(items[i].key);
      } else if (prev.has(key) && (e.metaKey || e.ctrlKey)) next.delete(key);
      else if (prev.has(key) && prev.size === 1 && !(e.metaKey || e.ctrlKey)) next.delete(key);
      else next.add(key);
      anchor.current = key;
      return next;
    });
  };

  const rotate = (keys: Set<string>, d: number) => history.set((p) => p.map((i) => (keys.has(i.key) ? { ...i, rotate: (((i.rotate + d) % 360) + 360) % 360 } : i)));
  const duplicate = (key: string) => history.set((p) => p.flatMap((i) => (i.key === key ? [i, { ...i, key: k() }] : [i])));
  const remove = async (keys: Set<string>) => {
    if (keys.size >= items.length) {
      await confirm("You can't delete every page", "OK");
      return;
    }
    if (keys.size > 1 && !(await confirm(`Delete ${keys.size} pages?`, "Delete", "You can undo this with ⌘Z."))) return;
    history.set((p) => p.filter((i) => !keys.has(i.key)));
    setSelected(new Set());
  };

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = items.findIndex((i) => i.key === e.active.id);
    const to = items.findIndex((i) => i.key === e.over!.id);
    history.set((p) => arrayMove(p, from, to));
  };

  const save = (only?: Set<string>) => {
    const list = only ? items.filter((i) => only.has(i.key)) : items;
    const ids = files.map((f) => f.id);
    const plan = list.map((i) => ({ src: ids.indexOf(i.file), page: i.page, rotate: i.rotate }));
    start(tool.id, ids, { plan, outputName: `${baseName(files[0]?.name ?? "document")}-${only ? "extract" : "organized"}` });
  };

  const multiSource = new Set(items.map((i) => i.file)).size > 1;
  const label = (id: string) => (multiSource ? String.fromCharCode(65 + files.findIndex((f) => f.id === id)) : undefined);
  const encrypted = files.filter((f) => f.encrypted);

  if (state.phase === "running" || state.phase === "starting")
    return (
      <Container>
        <ToolHeader tool={tool} />
        <Processing state={state} onCancel={cancel} />
      </Container>
    );
  if (state.phase === "done")
    return (
      <Container>
        <ToolHeader tool={tool} />
        <Result job={state.job} onStartOver={reset} />
      </Container>
    );
  if (state.phase === "failed")
    return (
      <Container>
        <ToolHeader tool={tool} />
        <Failure error={state.error} onRetry={state.job ? () => retry() : undefined} onEdit={reset} />
      </Container>
    );

  return (
    <Container wide>
      <ToolHeader tool={tool} />
      {confirmEl}
      {items.length === 0 ? (
        <>
          <DropZone onFiles={(l) => addPdfs(l)} accepts={["pdf"]} uploading={uploader.uploading} progress={uploader.progress} onCancel={uploader.cancel} />
          <UploadErrors errors={uploader.errors} onDismiss={uploader.clearErrors} />
          {encrypted.length > 0 && (
            <Notice tone="warning" className="mt-4" title="Password-protected">
              Unlock {encrypted[0].name} first.
            </Notice>
          )}
        </>
      ) : (
        <>
          <div className="glass sticky top-12 z-20 -mx-4 mb-4 flex flex-wrap items-center gap-2 border-b px-4 py-2.5 sm:mx-0 sm:rounded-xl sm:border-0 sm:shadow-card lg:top-3">
            <IconButton label="Undo (⌘Z)" onClick={history.undo} disabled={!history.canUndo}>
              <Undo2 className="size-4" />
            </IconButton>
            <IconButton label="Redo (⇧⌘Z)" onClick={history.redo} disabled={!history.canRedo}>
              <Redo2 className="size-4" />
            </IconButton>
            <span className="mx-1 h-5 w-px bg-ink/10" aria-hidden />
            {selected.size > 0 ? (
              <>
                <span className="text-sm font-medium text-ink">{selected.size} selected</span>
                <IconButton label="Rotate selected left" onClick={() => rotate(selected, -90)}>
                  <RotateCcw className="size-4" />
                </IconButton>
                <IconButton label="Rotate selected right" onClick={() => rotate(selected, 90)}>
                  <RotateCw className="size-4" />
                </IconButton>
                <IconButton label="Delete selected" onClick={() => remove(selected)} className="hover:text-danger">
                  <Trash2 className="size-4" />
                </IconButton>
                <Button size="sm" variant="ghost" icon={<FileOutput className="size-3.5" />} onClick={() => save(selected)}>
                  Extract selected
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                  Deselect
                </Button>
              </>
            ) : (
              <>
                <span className="text-sm text-ink-2">
                  {items.length} page{items.length === 1 ? "" : "s"}
                </span>
                <Button size="sm" variant="ghost" icon={<CheckSquare className="size-3.5" />} onClick={() => setSelected(new Set(items.map((i) => i.key)))}>
                  Select all
                </Button>
              </>
            )}
            <div className="ml-auto flex items-center gap-2">
              <label className="inline-flex">
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  multiple
                  className="peer sr-only"
                  onChange={(e) => {
                    const l = Array.from(e.target.files ?? []);
                    e.target.value = "";
                    const lastSel = items.reduce((m, it, i) => (selected.has(it.key) ? i : m), -1);
                    if (l.length) addPdfs(l, lastSel >= 0 ? lastSel + 1 : undefined);
                  }}
                />
                <span className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-lg bg-surface px-3 text-sm font-medium text-ink shadow-card hover:bg-surface-2 peer-focus-visible:ring-[3px] peer-focus-visible:ring-accent/40">
                  <FilePlus2 className="size-4" /> {uploader.uploading ? "Uploading…" : "Insert PDF"}
                </span>
              </label>
              <Button variant="primary" onClick={() => save()}>
                Save PDF
              </Button>
            </div>
          </div>
          <UploadErrors errors={uploader.errors} onDismiss={uploader.clearErrors} />
          <p className="mb-3 text-xs text-ink-3">Click to select, ⇧/⌘-click for more. Drag to reorder. Inserted pages go after the last selected page.</p>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={items.map((i) => i.key)} strategy={rectSortingStrategy}>
              <ul className="grid grid-cols-2 gap-1 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))]" aria-label="Pages">
                {items.map((it, i) => (
                  <Tile
                    key={it.key}
                    item={it}
                    index={i}
                    selected={selected.has(it.key)}
                    sourceLabel={label(it.file)}
                    onToggle={(e) => toggle(it.key, e)}
                    onRotate={(d) => rotate(new Set([it.key]), d)}
                    onDuplicate={() => duplicate(it.key)}
                    onDelete={() => remove(new Set([it.key]))}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        </>
      )}
    </Container>
  );
}
