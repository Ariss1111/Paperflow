"use client";
import * as React from "react";
import { DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { RotateCw, Copy, Trash2 } from "lucide-react";
import type { EditDocument, EditPage } from "@/lib/editor/model";
import { PageThumb } from "@/components/files/PageThumb";
import { IconButton } from "@/components/ui/button";
import { uid } from "./useEditorState";
import type { EditorApi } from "./useEditorState";
import { cn } from "@/lib/utils";

function Thumb({ page, index, fileId, active, onGo, onRotate, onDuplicate, onDelete, canDelete }: { page: EditPage; index: number; fileId: string; active: boolean; onGo: () => void; onRotate: () => void; onDuplicate: () => void; onDelete: () => void; canDelete: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: page.key });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn("group relative flex flex-col items-center gap-1.5 rounded-xl p-2", isDragging && "z-10 opacity-80")}>
      <button
        type="button"
        {...attributes}
        {...listeners}
        onClick={onGo}
        aria-label={`Go to page ${index + 1}. Drag or use space and arrow keys to reorder.`}
        aria-current={active ? "page" : undefined}
        className={cn("cursor-grab touch-none rounded-[5px] outline-offset-4 transition-shadow active:cursor-grabbing", active && "ring-2 ring-accent ring-offset-2 ring-offset-[rgb(var(--sidebar-bg))]")}
      >
        <PageThumb fileId={fileId} page={page.src + 1} rotation={page.rotate} width={96} />
      </button>
      <span className={cn("text-2xs font-medium tabular-nums", active ? "text-accent" : "text-ink-3")}>{index + 1}</span>
      <div className="glass absolute right-1 top-1 flex flex-col rounded-lg opacity-0 shadow-card transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <IconButton size="sm" label={`Rotate page ${index + 1}`} onClick={onRotate}>
          <RotateCw className="size-3.5" />
        </IconButton>
        <IconButton size="sm" label={`Duplicate page ${index + 1}`} onClick={onDuplicate}>
          <Copy className="size-3.5" />
        </IconButton>
        {canDelete && (
          <IconButton size="sm" label={`Delete page ${index + 1}`} onClick={onDelete} className="hover:text-danger">
            <Trash2 className="size-3.5" />
          </IconButton>
        )}
      </div>
    </li>
  );
}

export function Thumbnails({ doc, editor, fileId, current, onGo, onDeletePage }: { doc: EditDocument; editor: EditorApi; fileId: string; current: string | null; onGo: (key: string) => void; onDeletePage: (key: string) => void }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = doc.pages.findIndex((p) => p.key === e.active.id);
    const to = doc.pages.findIndex((p) => p.key === e.over!.id);
    editor.setPages(arrayMove(doc.pages, from, to));
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={doc.pages.map((p) => p.key)} strategy={verticalListSortingStrategy}>
        <ul aria-label="Pages" className="space-y-1 p-2">
          {doc.pages.map((p, i) => (
            <Thumb
              key={p.key}
              page={p}
              index={i}
              fileId={fileId}
              active={p.key === current}
              onGo={() => onGo(p.key)}
              canDelete={doc.pages.length > 1}
              onRotate={() => editor.setPages(doc.pages.map((x) => (x.key === p.key ? { ...x, rotate: (x.rotate + 90) % 360 } : x)))}
              onDuplicate={() => {
                const key = uid("pg");
                editor.update((d) => ({
                  ...d,
                  pages: d.pages.flatMap((x) => (x.key === p.key ? [x, { ...x, key }] : [x])),
                  // duplicated pages get copies of their objects
                  objects: [...d.objects, ...d.objects.filter((o) => o.pageKey === p.key).map((o) => ({ ...o, id: uid(), pageKey: key }))],
                }));
              }}
              onDelete={() => onDeletePage(p.key)}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
