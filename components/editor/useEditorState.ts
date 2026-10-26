"use client";
import * as React from "react";
import type { EditDocument, EditObject, EditPage } from "@/lib/editor/model";

interface History {
  past: EditDocument[];
  present: EditDocument;
  future: EditDocument[];
  /** coalescing key: consecutive updates with the same key (e.g. a drag) form one undo step */
  lastKey?: string;
}

type Action =
  | { type: "reset"; doc: EditDocument }
  | { type: "update"; fn: (d: EditDocument) => EditDocument; key?: string }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "commit" };

function reducer(h: History, a: Action): History {
  switch (a.type) {
    case "reset":
      return { past: [], present: a.doc, future: [] };
    case "update": {
      const next = a.fn(h.present);
      if (next === h.present) return h;
      if (a.key && a.key === h.lastKey) return { ...h, present: next };
      return { past: [...h.past.slice(-199), h.present], present: next, future: [], lastKey: a.key };
    }
    case "commit":
      return { ...h, lastKey: undefined };
    case "undo":
      return h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future], lastKey: undefined } : h;
    case "redo":
      return h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1), lastKey: undefined } : h;
  }
}

const empty: EditDocument = { version: 1, pages: [], objects: [] };
let idSeq = 0;
export const uid = (p = "o") => `${p}${Date.now().toString(36)}${(++idSeq).toString(36)}`;

export function initialDoc(pageCount: number): EditDocument {
  return { version: 1, pages: Array.from({ length: pageCount }, (_, i) => ({ key: `pg${i}`, src: i, rotate: 0 })), objects: [] };
}

const storageKey = (fileId: string) => `pf-editor:${fileId}`;

export function loadSaved(fileId: string): EditDocument | null {
  try {
    const raw = localStorage.getItem(storageKey(fileId));
    if (!raw) return null;
    const d = JSON.parse(raw) as EditDocument;
    return d.version === 1 && Array.isArray(d.pages) ? d : null;
  } catch {
    return null;
  }
}

export function clearSaved(fileId: string) {
  try {
    localStorage.removeItem(storageKey(fileId));
  } catch {
    /* ignore */
  }
}

export function useEditorState(fileId: string | null) {
  const [h, dispatch] = React.useReducer(reducer, { past: [], present: empty, future: [] });
  const doc = h.present;

  // Autosave the working state (not the PDF) so a reload doesn't lose edits.
  React.useEffect(() => {
    if (!fileId || !doc.pages.length) return;
    const t = setTimeout(() => {
      try {
        const dirty = doc.objects.length > 0 || doc.pages.some((p, i) => p.src !== i || p.rotate !== 0);
        if (dirty) localStorage.setItem(storageKey(fileId), JSON.stringify(doc));
        else localStorage.removeItem(storageKey(fileId));
      } catch {
        /* storage full or blocked: autosave is best-effort */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [doc, fileId]);

  const api = React.useMemo(
    () => ({
      reset: (d: EditDocument) => dispatch({ type: "reset", doc: d }),
      undo: () => dispatch({ type: "undo" }),
      redo: () => dispatch({ type: "redo" }),
      commit: () => dispatch({ type: "commit" }),
      update: (fn: (d: EditDocument) => EditDocument, key?: string) => dispatch({ type: "update", fn, key }),
      add: (o: EditObject) => dispatch({ type: "update", fn: (d) => ({ ...d, objects: [...d.objects, o] }) }),
      patch: (id: string, p: Partial<EditObject>, key?: string) =>
        dispatch({ type: "update", key, fn: (d) => ({ ...d, objects: d.objects.map((o) => (o.id === id ? ({ ...o, ...p } as EditObject) : o)) }) }),
      remove: (id: string) => dispatch({ type: "update", fn: (d) => ({ ...d, objects: d.objects.filter((o) => o.id !== id) }) }),
      setPages: (pages: EditPage[]) => dispatch({ type: "update", fn: (d) => ({ ...d, pages }) }),
      setFlatten: (v: boolean) => dispatch({ type: "update", fn: (d) => ({ ...d, flattenAnnotations: v }) }),
    }),
    [],
  );

  return { doc, ...api, canUndo: h.past.length > 0, canRedo: h.future.length > 0 };
}

export type EditorApi = ReturnType<typeof useEditorState>;
