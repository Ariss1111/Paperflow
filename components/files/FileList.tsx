"use client";
import * as React from "react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, X, Pencil, Lock, ScanText } from "lucide-react";
import { cn, formatBytes } from "@/lib/utils";
import { FORMATS } from "@/lib/formats";
import { FileThumb } from "./Thumb";
import { IconButton } from "@/components/ui/button";
import { Badge } from "@/components/ui/feedback";
import { api } from "@/lib/client/api";
import { toast } from "@/components/ui/feedback";
import type { StoredFile } from "@/types";

function Row({ file, index, ordered, onRemove, onRenamed, disabled }: { file: StoredFile; index: number; ordered: boolean; onRemove: () => void; onRenamed: (f: StoredFile) => void; disabled?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: file.id, disabled: !ordered || disabled });
  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState(file.name);
  const commit = async () => {
    setEditing(false);
    if (name.trim() && name !== file.name) {
      try {
        onRenamed((await api.renameFile(file.id, name)).file);
      } catch (e) {
        toast((e as Error).message, "danger");
        setName(file.name);
      }
    } else setName(file.name);
  };
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "group flex items-center gap-3 rounded-xl bg-surface px-3 py-2.5 shadow-card transition-shadow",
        isDragging && "relative z-10 shadow-raised",
      )}
    >
      {ordered && (
        <button
          type="button"
          aria-label={`Reorder ${file.name}. Use space to pick up and arrow keys to move.`}
          className="-ml-1 cursor-grab touch-none rounded p-0.5 text-ink-3 hover:text-ink-2 active:cursor-grabbing disabled:opacity-30"
          disabled={disabled}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
      )}
      {ordered && <span className="w-4 text-center text-xs tabular-nums text-ink-3">{index + 1}</span>}
      <FileThumb file={file} width={36} />
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            autoFocus
            value={name}
            aria-label="File name"
            onChange={(e) => setName(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") {
                setName(file.name);
                setEditing(false);
              }
            }}
            className="h-6 w-full rounded-md bg-surface-2 px-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
        ) : (
          <p className="truncate text-sm font-medium text-ink" title={file.name}>
            {file.name}
          </p>
        )}
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-3">
          <span>{FORMATS[file.format].label}</span>
          <span aria-hidden>·</span>
          <span>{formatBytes(file.size)}</span>
          {file.pages !== undefined && (
            <>
              <span aria-hidden>·</span>
              <span>
                {file.pages} page{file.pages === 1 ? "" : "s"}
              </span>
            </>
          )}
          {file.encrypted && (
            <Badge tone="warning" className="ml-1">
              <Lock className="size-2.5" /> Protected
            </Badge>
          )}
          {file.scanned && (
            <Badge tone="accent" className="ml-1">
              <ScanText className="size-2.5" /> Scanned
            </Badge>
          )}
        </p>
      </div>
      {!disabled && (
        <div className="flex items-center opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
          <IconButton size="sm" label={`Rename ${file.name}`} onClick={() => setEditing(true)}>
            <Pencil className="size-3.5" />
          </IconButton>
          <IconButton size="sm" label={`Remove ${file.name}`} onClick={onRemove}>
            <X className="size-4" />
          </IconButton>
        </div>
      )}
    </li>
  );
}

export function FileList({ files, onChange, ordered = false, disabled }: { files: StoredFile[]; onChange: (f: StoredFile[]) => void; ordered?: boolean; disabled?: boolean }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = files.findIndex((f) => f.id === e.active.id);
    const to = files.findIndex((f) => f.id === e.over!.id);
    onChange(arrayMove(files, from, to));
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={files.map((f) => f.id)} strategy={verticalListSortingStrategy}>
        <ul className="space-y-2" aria-label="Selected files">
          {files.map((f, i) => (
            <Row
              key={f.id}
              file={f}
              index={i}
              ordered={ordered}
              disabled={disabled}
              onRemove={() => onChange(files.filter((x) => x.id !== f.id))}
              onRenamed={(nf) => onChange(files.map((x) => (x.id === nf.id ? nf : x)))}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
