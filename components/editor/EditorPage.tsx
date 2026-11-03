"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PDFDocumentProxy, PageViewport } from "pdfjs-dist";
import {
  MousePointer2, Type, TextCursorInput, Highlighter, Underline, Strikethrough, PenLine, Square, Circle, Minus, MoveUpRight, MessageSquare,
  Eraser, Image as ImageIcon, Signature, CalendarDays, Undo2, Redo2, Hand, Download, Save, Files, Stamp, Maximize2, Minimize2, Keyboard, FilePlus2, FileOutput, Scissors, File as FileBlank, Hash, ChevronLeft, PanelLeft, PanelRight, MoreHorizontal, X, Loader2,
} from "lucide-react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { getTool } from "@/lib/tools/catalog";
import { ToolHeader, UploadErrors } from "@/components/tool/ToolWorkspace";
import { Container } from "@/components/shell/AppShell";
import { DropZone } from "@/components/files/DropZone";
import { useUploader } from "@/components/files/useUploader";
import { useSelectedFiles } from "@/components/tool/useSelectedFiles";
import { useJob } from "@/components/tool/useJob";
import { Processing, Result, Failure } from "@/components/tool/JobPanel";
import { Button, IconButton } from "@/components/ui/button";
import { Notice, toast } from "@/components/ui/feedback";
import { Sheet, useConfirm } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/controls";
import { api, download, uploadFiles } from "@/lib/client/api";
import { call, useAccount } from "@/lib/client/account";
import { loadPdf } from "@/lib/client/pdfjs";
import type { EditDocument, EditObject, EditPage, TextObj } from "@/lib/editor/model";
import { useEditorState, initialDoc, loadSaved, clearSaved, uid } from "./useEditorState";
import { PageView, fitText, translate, type ToolId, type ToolStyle } from "./PageView";
import { Inspector } from "./Inspector";
import { Thumbnails } from "./Thumbnails";
import { SignatureDialog } from "./SignatureDialog";
import { ZoomBar, MIN_ZOOM, MAX_ZOOM } from "./ZoomBar";
import { WatermarkDialog, PageNumbersDialog } from "./StampDialogs";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { parseRanges } from "@/lib/pdf/pages";
import { Input, Field } from "@/components/ui/controls";
import { loadEditorFonts } from "./fonts";
import { textItems, pointToPdf, type TextItem } from "./geometry";
import { cn } from "@/lib/utils";
import type { StoredFile } from "@/types";

const CSS_UNITS = 96 / 72;
const ZOOMS = [0.1, 0.25, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
const clampScale = (s: number) => Math.max((MIN_ZOOM / 100) * CSS_UNITS, Math.min((MAX_ZOOM / 100) * CSS_UNITS, s));

/** A document point held still on screen while the zoom changes. */
type Anchor = { key: string; fx: number; fy: number; sx: number; sy: number };
/** A zoom gesture in progress: previewed with a CSS transform, re-rendered sharply when it ends. */
type ZoomGesture = { k: number; anchor: Anchor | null; dx: number; dy: number };

type ToolDefn = { id: ToolId; label: string; icon: React.ComponentType<{ className?: string }>; key: string };
const EDIT_TOOLS: ToolDefn[][] = [
  [
    { id: "select", label: "Select", icon: MousePointer2, key: "V" },
    { id: "hand", label: "Pan (or hold Space)", icon: Hand, key: "P" },
  ],
  [
    { id: "text", label: "Add text", icon: Type, key: "T" },
    { id: "replace", label: "Edit text", icon: TextCursorInput, key: "E" },
  ],
  [
    { id: "highlight", label: "Highlight", icon: Highlighter, key: "H" },
    { id: "underline", label: "Underline", icon: Underline, key: "U" },
    { id: "strike", label: "Strikethrough", icon: Strikethrough, key: "S" },
    { id: "comment", label: "Comment", icon: MessageSquare, key: "C" },
  ],
  [
    { id: "ink", label: "Draw", icon: PenLine, key: "D" },
    { id: "rect", label: "Rectangle", icon: Square, key: "R" },
    { id: "ellipse", label: "Ellipse", icon: Circle, key: "O" },
    { id: "line", label: "Line", icon: Minus, key: "L" },
    { id: "arrow", label: "Arrow", icon: MoveUpRight, key: "A" },
  ],
  [{ id: "erase", label: "Erase area (removes content)", icon: Eraser, key: "X" }],
];
const MENU_ITEM = "flex cursor-default items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-ink outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-accent data-[highlighted]:text-white";

const SIGN_TOOLS: ToolDefn[][] = [[{ id: "select", label: "Select", icon: MousePointer2, key: "V" }, { id: "hand", label: "Pan (or hold Space)", icon: Hand, key: "P" }], [{ id: "text", label: "Add text", icon: Type, key: "T" }]];

const DEFAULT_STYLE: ToolStyle = { color: "#1d1d1f", stroke: "#d70015", fill: null, width: 2, size: 14, font: "sans", bold: false, opacity: 1, highlight: "#ffd60a" };

function isTyping(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

function cleanForExport(doc: EditDocument): EditDocument {
  return {
    ...doc,
    objects: doc.objects
      .filter((o) => !(o.type === "text" && !o.text.trim()))
      .map((o) => {
        if (o.type !== "replace") return o;
        const { previewBg: _p, ...rest } = o;
        return rest;
      }),
  };
}

export function EditorPage({ mode }: { mode: "edit" | "sign" }) {
  const tool = getTool(mode === "sign" ? "sign" : "edit")!;
  const { files, setFiles, loading } = useSelectedFiles();
  const uploader = useUploader(["pdf"]);
  const file = files[0] ?? null;

  if (!file || file.encrypted) {
    return (
      <Container>
        <ToolHeader tool={tool} />
        {file?.encrypted && (
          <Notice tone="warning" className="mb-5" title="This PDF is password-protected">
            Unlock it first with{" "}
            <Link className="font-medium text-accent hover:underline" href={`/tools/unlock?files=${file.id}`}>
              Unlock PDF
            </Link>
            , then open the result in the editor.
          </Notice>
        )}
        <DropZone multiple={false} accepts={["pdf"]} onFiles={async (l) => setFiles((await uploader.upload(l)).slice(0, 1))} uploading={uploader.uploading || loading} progress={loading ? null : uploader.progress} onCancel={uploader.cancel} title="Drop a PDF to edit" />
        <UploadErrors errors={uploader.errors} onDismiss={uploader.clearErrors} />
        <div className="mt-8 grid gap-3 text-sm text-ink-2 sm:grid-cols-3">
          <p><strong className="text-ink">Overlays</strong> — text, images, shapes and drawings placed on top of the page.</p>
          <p><strong className="text-ink">Annotations</strong> — highlights, underlines, strikethroughs and comments as standard PDF annotations.</p>
          <p><strong className="text-ink">Content changes</strong> — edited text and erased areas genuinely remove what was there.</p>
        </div>
      </Container>
    );
  }
  return <Workspace key={file.id} file={file} mode={mode} onClose={() => setFiles([])} onReplace={(f) => setFiles([f])} />;
}

type ExportKind = "download" | "save" | "extract" | "split";

/** A one-page blank PDF of the given size, made in the browser (then added like any merged PDF). */
async function blankPdf(width: number, height: number): Promise<File> {
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.addPage([width, height]);
  return new File([(await doc.save()) as Uint8Array<ArrayBuffer>], `blank-page-${Math.round(width)}x${Math.round(height)}.pdf`, { type: "application/pdf" });
}

function Workspace({ file, mode, onClose, onReplace }: { file: StoredFile; mode: "edit" | "sign"; onClose: () => void; onReplace: (f: StoredFile) => void }) {
  const router = useRouter();
  const editor = useEditorState(file.id);
  const { doc } = editor;
  const [pdf, setPdf] = React.useState<PDFDocumentProxy | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [toolId, setToolId] = React.useState<ToolId>("select");
  const [style, setStyleState] = React.useState<ToolStyle>(DEFAULT_STYLE);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [scale, setScale] = React.useState(1);
  const [currentKey, setCurrentKey] = React.useState<string | null>(null);
  const [showRail, setShowRail] = React.useState(true);
  const [showInspector, setShowInspector] = React.useState(true);
  const [sigOpen, setSigOpen] = React.useState(false);
  const [exportOpen, setExportOpen] = React.useState(false);
  const [restored, setRestored] = React.useState(false);
  const [inserting, setInserting] = React.useState(false);
  const [gestureScale, setGestureScale] = React.useState<number | null>(null);
  const [spaceHeld, setSpaceHeld] = React.useState(false);
  const scroller = React.useRef<HTMLDivElement>(null);
  const content = React.useRef<HTMLDivElement>(null);
  const pendingAnchor = React.useRef<Anchor | null>(null);
  const gesture = React.useRef<ZoomGesture | null>(null);
  const panning = React.useRef<{ x: number; y: number; left: number; top: number; id: number } | null>(null);
  const views = React.useRef(new Map<string, { el: HTMLElement; vp: PageViewport }>());
  const textCache = React.useRef(new Map<string, Promise<TextItem[]>>());
  const account = useAccount();
  const [extra, setExtra] = React.useState<Record<string, PDFDocumentProxy>>({});
  const [selectedPages, setSelectedPages] = React.useState<Set<string>>(new Set());
  const [exportKind, setExportKind] = React.useState<ExportKind>("download");
  const [wmOpen, setWmOpen] = React.useState(false);
  const [pnOpen, setPnOpen] = React.useState(false);
  const [splitOpen, setSplitOpen] = React.useState(false);
  const [splitRanges, setSplitRanges] = React.useState("");
  const [splitError, setSplitError] = React.useState<string | null>(null);
  const [keysOpen, setKeysOpen] = React.useState(false);
  const [fullscreen, setFullscreen] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const pdfInput = React.useRef<HTMLInputElement>(null);
  const blankCache = React.useRef(new Map<string, StoredFile>());
  const imageInput = React.useRef<HTMLInputElement>(null);
  const job = useJob();
  const { confirm, element: confirmEl } = useConfirm();
  const setStyle = (s: Partial<ToolStyle>) => setStyleState((p) => ({ ...p, ...s }));

  // load PDF + fonts, restore autosaved work
  React.useEffect(() => {
    let live = true;
    Promise.all([loadPdf(api.fileUrl(file.id), file.id), loadEditorFonts()])
      .then(([p]) => {
        if (!live) return;
        setPdf(p);
        const saved = loadSaved(file.id);
        if (saved && saved.pages.every((pg) => (pg.file ?? 0) > 0 || pg.src < p.numPages)) {
          editor.reset(saved);
          setRestored(true);
        } else editor.reset(initialDoc(p.numPages));
        setCurrentKey("pg0");
      })
      .catch(() => live && setLoadError("This PDF couldn't be opened in the editor. It may be damaged — try Repair PDF first."));
    return () => {
      live = false;
    };
  }, [file.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /** The PDF.js document a page is drawn from: the edited file, or a merged PDF / blank page. */
  const pdfFor = (p: EditPage): PDFDocumentProxy | null => ((p.file ?? 0) === 0 ? pdf : (extra[doc.sources?.[(p.file ?? 0) - 1] ?? ""] ?? null));
  const fileIdFor = React.useCallback((p: EditPage) => ((p.file ?? 0) === 0 ? file.id : (doc.sources?.[(p.file ?? 0) - 1] ?? file.id)), [file.id, doc.sources]);

  // load merged PDFs and blank pages as they're added (or restored from autosave)
  React.useEffect(() => {
    for (const id of doc.sources ?? []) {
      if (extra[id]) continue;
      loadPdf(api.fileUrl(id), id)
        .then((d) => setExtra((x) => ({ ...x, [id]: d })))
        .catch(() => toast("A PDF you added is no longer available. Remove its pages or add it again.", "danger"));
    }
  }, [doc.sources]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Adds pages from other PDFs right after the current page, as one undoable step. */
  const addPagesFrom = (added: StoredFile[], countOf: (f: StoredFile) => number) => {
    editor.update((d) => {
      const sources = [...(d.sources ?? [])];
      const fresh: EditPage[] = [];
      for (const f of added) {
        let n = sources.indexOf(f.id) + 1;
        if (!n) {
          sources.push(f.id);
          n = sources.length;
        }
        for (let i = 0; i < countOf(f); i++) fresh.push({ key: uid("pg"), file: n, src: i, rotate: 0 });
      }
      const at = Math.max(0, d.pages.findIndex((p) => p.key === currentKey)) + 1;
      return { ...d, sources, pages: [...d.pages.slice(0, at), ...fresh, ...d.pages.slice(at)] };
    });
  };

  const insertPdf = async (list: File[]) => {
    setAdding(true);
    try {
      const res = await uploadFiles(list);
      res.errors.forEach((e) => toast(e.error, "danger"));
      const pdfs = res.files.filter((f) => f.format === "pdf");
      const locked = pdfs.filter((f) => f.encrypted);
      if (locked.length) toast(`${locked[0].name} is password-protected. Unlock it first.`, "danger");
      const ok = pdfs.filter((f) => !f.encrypted && f.pages);
      if (res.files.length > pdfs.length) toast("Only PDFs can be inserted as pages.", "danger");
      if (ok.length) {
        addPagesFrom(ok, (f) => f.pages ?? 0);
        toast(`Added ${ok.reduce((n, f) => n + (f.pages ?? 0), 0)} page(s).`, "success");
      }
    } catch (e) {
      toast((e as Error).message, "danger");
    } finally {
      setAdding(false);
    }
  };

  const insertBlank = async () => {
    const cur = doc.pages.find((p) => p.key === currentKey) ?? doc.pages[0];
    const source = cur && pdfFor(cur);
    let w = 595.28;
    let h = 841.89;
    if (cur && source) {
      const pg = await source.getPage(cur.src + 1);
      // same visual size and orientation as the page it follows
      const vp = pg.getViewport({ scale: 1, rotation: (pg.rotate + cur.rotate) % 360 });
      w = vp.width;
      h = vp.height;
    }
    const sizeKey = `${Math.round(w)}x${Math.round(h)}`;
    setAdding(true);
    try {
      let stored = blankCache.current.get(sizeKey);
      if (!stored) {
        const res = await uploadFiles([await blankPdf(w, h)]);
        stored = res.files[0];
        if (!stored) throw new Error(res.errors[0]?.error ?? "The blank page couldn't be created.");
        blankCache.current.set(sizeKey, stored);
      }
      addPagesFrom([stored], () => 1);
    } catch (e) {
      toast((e as Error).message, "danger");
    } finally {
      setAdding(false);
    }
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await rootRef.current?.requestFullscreen();
    } catch {
      toast("Full screen isn't available in this browser.", "danger");
    }
  };
  React.useEffect(() => {
    const on = () => setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  /** The document point under a screen position (or the nearest page's edge when between pages). */
  const anchorAt = (clientX: number, clientY: number): Anchor | null => {
    const sc = scroller.current;
    if (!sc) return null;
    const box = sc.getBoundingClientRect();
    let best: Anchor | null = null;
    let bestDist = Infinity;
    views.current.forEach(({ el }, key) => {
      const r = el.getBoundingClientRect();
      const d = clientY < r.top ? r.top - clientY : clientY > r.bottom ? clientY - r.bottom : 0;
      if (d < bestDist) {
        bestDist = d;
        best = { key, fx: (clientX - r.left) / r.width, fy: (clientY - r.top) / r.height, sx: clientX - box.left, sy: clientY - box.top };
      }
    });
    return best;
  };

  const zoomTo = (next: number, at?: Anchor | null) => {
    const sc = scroller.current;
    if (!sc) return;
    const box = sc.getBoundingClientRect();
    pendingAnchor.current = at ?? anchorAt(box.left + box.width / 2, box.top + box.height / 2);
    setScale(clampScale(next));
  };

  // after a zoom commits, scroll so the anchored document point is back under the same screen position
  React.useLayoutEffect(() => {
    const a = pendingAnchor.current;
    const sc = scroller.current;
    pendingAnchor.current = null;
    if (!a || !sc) return;
    const el = views.current.get(a.key)?.el;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const box = sc.getBoundingClientRect();
    sc.scrollLeft += r.left + a.fx * r.width - (box.left + a.sx);
    sc.scrollTop += r.top + a.fy * r.height - (box.top + a.sy);
  }, [scale]);

  const scaleRef = React.useRef(scale);
  scaleRef.current = scale;

  const beginGesture = (clientX: number, clientY: number) => {
    const c = content.current!.getBoundingClientRect();
    gesture.current = { k: 1, anchor: anchorAt(clientX, clientY), dx: 0, dy: 0 };
    content.current!.style.transformOrigin = `${clientX - c.left}px ${clientY - c.top}px`;
    content.current!.style.willChange = "transform";
  };

  const paintGesture = () => {
    const g = gesture.current;
    if (!g) return;
    content.current!.style.transform = `translate(${g.dx}px, ${g.dy}px) scale(${g.k})`;
    setGestureScale(clampScale(scaleRef.current * g.k));
  };

  const endGesture = (clientX?: number, clientY?: number) => {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    const box = scroller.current!.getBoundingClientRect();
    content.current!.style.transform = "";
    content.current!.style.transformOrigin = "";
    content.current!.style.willChange = "";
    setGestureScale(null);
    const anchor = g.anchor && clientX !== undefined && clientY !== undefined ? { ...g.anchor, sx: clientX - box.left, sy: clientY - box.top } : g.anchor;
    zoomTo(scaleRef.current * g.k, anchor);
  };

  // Ctrl/⌘ + wheel and trackpad pinch (which browsers report as ctrl+wheel). A plain wheel keeps scrolling pages.
  React.useEffect(() => {
    const sc = scroller.current;
    if (!sc) return;
    let timer = 0;
    let last = [0, 0];
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      if (!gesture.current) beginGesture(e.clientX, e.clientY);
      last = [e.clientX, e.clientY];
      const g = gesture.current!;
      const delta = Math.max(-120, Math.min(120, e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY));
      const limit = clampScale(scaleRef.current * g.k * Math.exp(-delta * 0.0028));
      g.k = limit / scaleRef.current;
      paintGesture();
      window.clearTimeout(timer);
      timer = window.setTimeout(() => endGesture(last[0], last[1]), 140);
    };
    sc.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      sc.removeEventListener("wheel", onWheel);
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf]);

  // two-finger pinch on phones and tablets
  React.useEffect(() => {
    const sc = scroller.current;
    if (!sc) return;
    let start: { d: number; x: number; y: number } | null = null;
    let mid = [0, 0];
    const measure = (t: TouchList) => ({
      d: Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) || 1,
      x: (t[0].clientX + t[1].clientX) / 2,
      y: (t[0].clientY + t[1].clientY) / 2,
    });
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2 || start) return;
      start = measure(e.touches);
      mid = [start.x, start.y];
      beginGesture(start.x, start.y);
    };
    const onMove = (e: TouchEvent) => {
      if (!start || e.touches.length < 2 || !gesture.current) return;
      e.preventDefault();
      const m = measure(e.touches);
      const g = gesture.current;
      g.k = clampScale((scaleRef.current * m.d) / start.d) / scaleRef.current;
      g.dx = m.x - start.x;
      g.dy = m.y - start.y;
      mid = [m.x, m.y];
      paintGesture();
    };
    const onEnd = (e: TouchEvent) => {
      if (!start || e.touches.length >= 2) return;
      start = null;
      endGesture(mid[0], mid[1]);
    };
    sc.addEventListener("touchstart", onStart, { passive: true });
    sc.addEventListener("touchmove", onMove, { passive: false });
    sc.addEventListener("touchend", onEnd);
    sc.addEventListener("touchcancel", onEnd);
    return () => {
      sc.removeEventListener("touchstart", onStart);
      sc.removeEventListener("touchmove", onMove);
      sc.removeEventListener("touchend", onEnd);
      sc.removeEventListener("touchcancel", onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf]);

  // drag-to-pan with a mouse or stylus: the hand tool, holding Space, the middle button, or the select tool on empty page
  const onPanStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch") return; // one finger already scrolls natively
    const onObject = !!(e.target as HTMLElement).closest("[data-obj],[data-handle],textarea");
    const force = toolId === "hand" || spaceHeld || e.button === 1;
    if (!force && !(toolId === "select" && e.button === 0 && !onObject)) return;
    const sc = e.currentTarget;
    panning.current = { x: e.clientX, y: e.clientY, left: sc.scrollLeft, top: sc.scrollTop, id: e.pointerId };
    sc.setPointerCapture(e.pointerId);
    if (force) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  const onPanMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = panning.current;
    if (!p) return;
    e.currentTarget.scrollLeft = p.left - (e.clientX - p.x);
    e.currentTarget.scrollTop = p.top - (e.clientY - p.y);
  };
  const onPanEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (panning.current?.id === e.pointerId) panning.current = null;
  };

  const fit = React.useCallback(
    async (kind: "width" | "page") => {
      if (!pdf || !scroller.current) return;
      // fit-to-width uses the widest page (mixed portrait/landscape documents), fit-to-page the current one
      let maxW = 1;
      let curW = 1;
      let curH = 1;
      for (const p of doc.pages.slice(0, 60)) {
        const page = await pdf.getPage(p.src + 1);
        const vp = page.getViewport({ scale: 1, rotation: (page.rotate + p.rotate) % 360 });
        maxW = Math.max(maxW, vp.width);
        if (p.key === (currentKey ?? doc.pages[0]?.key)) {
          curW = vp.width;
          curH = vp.height;
        }
      }
      const room = scroller.current.clientWidth - 64;
      const next = clampScale(kind === "width" ? room / maxW : Math.min(room / curW, (scroller.current.clientHeight - 48) / curH));
      const key = currentKey ?? doc.pages[0]?.key;
      const box = scroller.current.getBoundingClientRect();
      // fit-to-page centres the current page; fit-to-width keeps the reading position
      pendingAnchor.current = kind === "page" && key ? { key, fx: 0.5, fy: 0.5, sx: box.width / 2, sy: box.height / 2 } : anchorAt(box.left + box.width / 2, box.top + box.height / 3);
      setScale(next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pdf, doc.pages, currentKey],
  );
  const fitted = React.useRef(false);
  React.useEffect(() => {
    if (pdf && doc.pages.length && !fitted.current) {
      fitted.current = true;
      fit("width").then(() => setScale((s) => Math.min(s, 1.5 * CSS_UNITS)));
    }
  }, [pdf, doc.pages.length, fit]);

  const registerView = React.useCallback((key: string, el: HTMLElement | null, vp: PageViewport | null) => {
    if (el && vp) views.current.set(key, { el, vp });
    else views.current.delete(key);
  }, []);
  const getText = React.useCallback(
    (page: EditPage) => {
      const source = pdfFor(page);
      const key = `${page.file ?? 0}:${page.src}`;
      if (!textCache.current.has(key) && source) textCache.current.set(key, source.getPage(page.src + 1).then((p) => p.getTextContent()).then(textItems));
      return textCache.current.get(key) ?? Promise.resolve([]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pdf, extra, doc.sources],
  );

  // track the page in view
  const onScroll = React.useCallback(() => {
    const sc = scroller.current;
    if (!sc) return;
    const mid = sc.getBoundingClientRect().top + sc.clientHeight / 3;
    let best: string | null = null;
    let dist = Infinity;
    views.current.forEach(({ el }, key) => {
      const r = el.getBoundingClientRect();
      const d = r.top <= mid && r.bottom >= mid ? 0 : Math.min(Math.abs(r.top - mid), Math.abs(r.bottom - mid));
      if (d < dist) {
        dist = d;
        best = key;
      }
    });
    if (best) setCurrentKey(best);
  }, []);

  const goTo = (key: string) => views.current.get(key)?.el.scrollIntoView({ behavior: "smooth", block: "start" });

  const zoomBy = (dir: 1 | -1) => {
    const pct = scale / CSS_UNITS;
    const next = dir > 0 ? ZOOMS.find((z) => z > pct + 0.001) : [...ZOOMS].reverse().find((z) => z < pct - 0.001);
    if (next) zoomTo(next * CSS_UNITS);
  };

  const selected = doc.objects.find((o) => o.id === selectedId) ?? null;
  const deleteSelected = () => {
    if (!selectedId) return;
    editor.remove(selectedId);
    setSelectedId(null);
    setEditingId(null);
  };
  const deletePage = async (key: string) => {
    if (doc.pages.length <= 1) return;
    const n = doc.objects.filter((o) => o.pageKey === key).length;
    if (n && !(await confirm("Delete this page?", "Delete page", `Its ${n} object${n > 1 ? "s" : ""} will be removed too. You can undo this.`))) return;
    editor.update((d) => ({ ...d, pages: d.pages.filter((p) => p.key !== key), objects: d.objects.filter((o) => o.pageKey !== key) }));
  };

  /** Places an object centred on the page currently in view. */
  const placeOnCurrentPage = (w: number, h: number) => {
    const key = currentKey ?? doc.pages[0].key;
    const view = views.current.get(key);
    if (!view) return null;
    const sc = scroller.current!.getBoundingClientRect();
    const r = view.el.getBoundingClientRect();
    // centre of the visible part of the page
    const vx = (Math.max(r.left, sc.left) + Math.min(r.right, sc.right)) / 2 - r.left;
    const vy = (Math.max(r.top, sc.top) + Math.min(r.bottom, sc.bottom)) / 2 - r.top;
    const [cx, cy] = pointToPdf(view.vp, vx, vy);
    return { pageKey: key, x: cx - w / 2, y: cy - h / 2, w, h };
  };

  const insertImage = async (f: File, kind: "image" | "signature") => {
    setInserting(true);
    try {
      const up = await import("@/lib/client/api").then((m) => m.uploadFiles([f]));
      const stored = up.files[0];
      if (!stored) throw new Error(up.errors[0]?.error ?? "The image couldn't be added.");
      const img = new Image();
      img.src = api.fileUrl(stored.id);
      await img.decode();
      const maxW = kind === "signature" ? 170 : 240;
      const w = Math.min(maxW, img.naturalWidth * 0.75);
      const h = (w * img.naturalHeight) / img.naturalWidth;
      const at = placeOnCurrentPage(w, h);
      if (!at) return;
      const id = uid("i");
      editor.add({ id, type: kind, fileId: stored.id, rotation: 0, opacity: 1, ...at });
      setSelectedId(id);
      setToolId("select");
    } catch (e) {
      toast((e as Error).message, "danger");
    } finally {
      setInserting(false);
    }
  };

  const addDate = () => {
    const text = new Date().toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
    const at = placeOnCurrentPage(100, style.size * 1.25);
    if (!at) return;
    const o = fitText<TextObj>({ id: uid("t"), type: "text", text, size: style.size, color: style.color, font: style.font, bold: false, align: "left", ...at });
    editor.add(o);
    setSelectedId(o.id);
    setToolId("select");
  };

  /** Every export runs the real edit job on the server; nothing reports success until the file exists. */
  const runExport = (kind: ExportKind, extraOptions: Record<string, unknown> = {}) => {
    setEditingId(null);
    const clean = cleanForExport(doc);
    const images = [...new Set(clean.objects.flatMap((o) => (o.type === "image" || o.type === "signature" ? [o.fileId] : [])))];
    const used = new Set(clean.pages.map((p) => p.file ?? 0));
    // only send the merged PDFs still in use
    const sources = (clean.sources ?? []).filter((_, i) => used.has(i + 1));
    const remap = new Map((clean.sources ?? []).map((id, i) => [i + 1, sources.indexOf(id) + 1]));
    const edit = { ...clean, sources, pages: clean.pages.map((p) => ((p.file ?? 0) ? { ...p, file: remap.get(p.file!) } : p)) };
    setExportKind(kind);
    if (kind !== "save") setExportOpen(true);
    const suffix = kind === "extract" ? "extract" : kind === "split" ? "part" : mode === "sign" ? "signed" : "edited";
    job.start(mode === "sign" ? "sign" : "edit", [file.id, ...sources, ...images], { edit, suffix, ...extraOptions });
  };
  const exportPdf = () => runExport("download");
  const savePdf = () => runExport("save");
  const extractSelected = () => {
    const keys = doc.pages.filter((p) => selectedPages.has(p.key)).map((p) => p.key);
    if (!keys.length) {
      toast("Select pages first: tick the checkbox on their thumbnails.", "info");
      return;
    }
    runExport("extract", { only: keys });
  };
  const startSplit = () => {
    try {
      parseRanges(splitRanges, doc.pages.length);
    } catch (e) {
      setSplitError((e as Error).message);
      return;
    }
    setSplitOpen(false);
    runExport("split", { split: splitRanges });
  };

  // finishing an export: Download saves the file, Save swaps the editor to the saved version
  const handled = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (job.state.phase === "failed" && exportKind === "save") {
      toast(`Couldn't save: ${job.state.error}`, "danger");
      job.reset();
    }
    if (job.state.phase !== "done" || handled.current === job.state.job.id) return;
    const done = job.state.job;
    handled.current = done.id;
    if (exportKind === "download" && done.outputs.length === 1) download(api.downloadUrl(done.id, 0));
    if (exportKind === "save") {
      api
        .useOutput(done.id, 0)
        .then(async ({ file: saved }) => {
          clearSaved(file.id);
          const q = new URLSearchParams(window.location.search);
          const docId = q.get("doc");
          if (account.user?.verified) {
            // signed in: the save goes to the account (a new version when the editor opened a saved document)
            try {
              const r = docId
                ? await call<{ document: { id: string; name: string; version: number } }>(`/api/docs/${docId}/versions`, "POST", { fileId: saved.id, note: "Edited in the PDF editor" })
                : await call<{ document: { id: string; name: string; version: number } }>("/api/docs", "POST", { fileId: saved.id });
              q.set("doc", r.document.id);
              window.history.replaceState(window.history.state, "", `${window.location.pathname}?${q.toString().replace(/%2C/g, ",")}`);
              toast(docId ? `Saved version ${r.document.version} of ${r.document.name}.` : `Saved to My Documents as ${r.document.name}.`, "success");
            } catch (e) {
              toast(`Couldn't save to your documents: ${(e as Error).message}`, "danger");
            }
          } else toast(`Saved to My Documents as ${saved.name}.`, "success");
          onReplace(saved);
        })
        .catch((e) => toast((e as Error).message, "danger"));
    }
  }, [job.state, exportKind]); // eslint-disable-line react-hooks/exhaustive-deps

  const openResult = async () => {
    if (job.state.phase !== "done") return;
    try {
      const { file: nf } = await api.useOutput(job.state.job.id, 0);
      router.push(`${mode === "sign" ? "/tools/sign" : "/editor"}?files=${nf.id}`);
    } catch (e) {
      toast((e as Error).message, "danger");
    }
  };

  // keyboard shortcuts
  React.useEffect(() => {
    const tools = (mode === "sign" ? SIGN_TOOLS : EDIT_TOOLS).flat();
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        zoomBy(1);
        return;
      }
      if (mod && e.key === "-") {
        e.preventDefault();
        zoomBy(-1);
        return;
      }
      if (mod && e.key === "0") {
        e.preventDefault();
        fit("width");
        return;
      }
      if (mod && e.key === "1") {
        e.preventDefault();
        zoomTo(CSS_UNITS);
        return;
      }
      if (isTyping(e.target)) return;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) editor.redo();
        else editor.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        editor.redo();
        return;
      }
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (job.state.phase !== "running" && job.state.phase !== "starting") savePdf();
        return;
      }
      if (mod && e.key.toLowerCase() === "d" && selected) {
        e.preventDefault();
        const copy = { ...translate(selected, 12, -12), id: uid() } as EditObject;
        editor.add(copy);
        setSelectedId(copy.id);
        return;
      }
      if (mod) return;
      if (e.code === "Space") {
        e.preventDefault();
        setSpaceHeld(true);
        return;
      }
      if (e.key === "?") {
        setKeysOpen(true);
        return;
      }
      if (e.key.toLowerCase() === "f" && !e.altKey) {
        toggleFullscreen();
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        deleteSelected();
      } else if (e.key === "Escape") {
        setSelectedId(null);
        setToolId("select");
      } else if (e.key.startsWith("Arrow") && selected) {
        e.preventDefault();
        const d = e.shiftKey ? 10 : 1;
        const [dx, dy] = e.key === "ArrowLeft" ? [-d, 0] : e.key === "ArrowRight" ? [d, 0] : e.key === "ArrowUp" ? [0, d] : [0, -d];
        editor.update((doc) => ({ ...doc, objects: doc.objects.map((o) => (o.id === selected.id ? translate(o, dx, dy) : o)) }), `nudge:${selected.id}`);
      } else if (e.key === "PageDown" || e.key === "PageUp") {
        e.preventDefault();
        const i = doc.pages.findIndex((p) => p.key === currentKey);
        const next = doc.pages[Math.max(0, Math.min(doc.pages.length - 1, i + (e.key === "PageDown" ? 1 : -1)))];
        if (next) goTo(next.key);
      } else {
        const t = tools.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
        if (t) setToolId(t.id);
        else if (e.key.toLowerCase() === "g" && mode === "edit") setSigOpen(true);
        else if (e.key.toLowerCase() === "i") imageInput.current?.click();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceHeld(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  });

  const toolGroups = mode === "sign" ? SIGN_TOOLS : EDIT_TOOLS;
  const zoomPct = Math.round(((gestureScale ?? scale) / CSS_UNITS) * 100);
  const currentIndex = Math.max(0, doc.pages.findIndex((p) => p.key === currentKey));
  const changes = doc.objects.length;

  if (loadError)
    return (
      <Container>
        <Notice tone="danger" className="mt-10" title="Couldn't open this PDF">
          {loadError}
        </Notice>
        <Button className="mt-4" onClick={onClose}>
          Choose another file
        </Button>
      </Container>
    );

  return (
    <div ref={rootRef} className={cn("flex min-h-0 flex-col bg-canvas", fullscreen ? "h-dvh" : "h-[calc(100dvh-56px)]")} data-testid="editor-root">
      {confirmEl}
      {/* ---------------------------------------------------------------- toolbar */}
      <div className="glass z-20 flex h-12 shrink-0 items-center gap-1 border-b px-2">
        <IconButton label="Close document" onClick={async () => {
          if (changes && !(await confirm("Close this document?", "Close", "Your edits are autosaved in this browser and will be restored if you open the same file again."))) return;
          onClose();
        }}>
          <ChevronLeft className="size-4" />
        </IconButton>
        <IconButton label={showRail ? "Hide pages" : "Show pages"} active={showRail} onClick={() => setShowRail((s) => !s)} className="hidden md:inline-flex">
          <PanelLeft className="size-4" />
        </IconButton>
        <div className="hidden min-w-0 max-w-[220px] px-1 xl:block">
          <p className="truncate text-sm font-medium text-ink" title={file.name}>
            {file.name}
          </p>
        </div>
        <span className="mx-1 h-5 w-px bg-ink/10" aria-hidden />
        <IconButton label="Undo (⌘Z)" onClick={editor.undo} disabled={!editor.canUndo}>
          <Undo2 className="size-4" />
        </IconButton>
        <IconButton label="Redo (⇧⌘Z)" onClick={editor.redo} disabled={!editor.canRedo}>
          <Redo2 className="size-4" />
        </IconButton>
        <span className="mx-1 h-5 w-px bg-ink/10" aria-hidden />
        <div role="toolbar" aria-label="Editing tools" className="scroll-thin flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {toolGroups.map((g, gi) => (
            <React.Fragment key={gi}>
              {gi > 0 && <span className="mx-1 h-5 w-px shrink-0 bg-ink/10" aria-hidden />}
              {g.map((t) => (
                <IconButton key={t.id} label={`${t.label} (${t.key})`} active={toolId === t.id} onClick={() => setToolId(t.id)}>
                  <t.icon className="size-4" />
                </IconButton>
              ))}
            </React.Fragment>
          ))}
          <span className="mx-1 h-5 w-px shrink-0 bg-ink/10" aria-hidden />
          {mode === "sign" ? (
            <>
              <Button size="sm" variant="ghost" icon={<Signature className="size-4" />} onClick={() => setSigOpen(true)}>
                Signature
              </Button>
              <Button size="sm" variant="ghost" icon={<CalendarDays className="size-4" />} onClick={addDate}>
                Date
              </Button>
            </>
          ) : (
            <IconButton label="Signature (G)" onClick={() => setSigOpen(true)}>
              <Signature className="size-4" />
            </IconButton>
          )}
          <span className="mx-1 h-5 w-px shrink-0 bg-ink/10" aria-hidden />
          <Menu.Root>
            <Menu.Trigger asChild>
              <IconButton label="Pages" disabled={adding}>
                {adding ? <Loader2 className="size-4 animate-spin" /> : <Files className="size-4" />}
              </IconButton>
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Content align="start" sideOffset={6} className="glass z-50 w-64 animate-rise-in rounded-xl p-1.5 shadow-overlay">
                <Menu.Item onSelect={insertBlank} className={MENU_ITEM}>
                  <FileBlank className="size-4 opacity-70" /> Insert blank page
                </Menu.Item>
                <Menu.Item onSelect={() => pdfInput.current?.click()} className={MENU_ITEM}>
                  <FilePlus2 className="size-4 opacity-70" /> Insert pages from a PDF…
                </Menu.Item>
                <Menu.Separator className="my-1 h-px bg-ink/10" />
                <Menu.Item onSelect={extractSelected} className={MENU_ITEM}>
                  <FileOutput className="size-4 opacity-70" /> Extract selected pages{selectedPages.size ? ` (${selectedPages.size})` : ""}
                </Menu.Item>
                <Menu.Item onSelect={() => { setSplitError(null); setSplitOpen(true); }} className={MENU_ITEM}>
                  <Scissors className="size-4 opacity-70" /> Split document…
                </Menu.Item>
                <p className="px-2 pb-1 pt-1.5 text-2xs leading-4 text-ink-3">Rotate, duplicate, delete and drag pages from the thumbnail rail.</p>
              </Menu.Content>
            </Menu.Portal>
          </Menu.Root>
          <Menu.Root>
            <Menu.Trigger asChild>
              <IconButton label="Watermark and numbering" active={!!doc.watermark || !!doc.pageNumbers}>
                <Stamp className="size-4" />
              </IconButton>
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Content align="start" sideOffset={6} className="glass z-50 w-56 animate-rise-in rounded-xl p-1.5 shadow-overlay">
                <Menu.Item onSelect={() => setWmOpen(true)} className={MENU_ITEM}>
                  <Stamp className="size-4 opacity-70" /> {doc.watermark ? "Edit watermark…" : "Add watermark…"}
                </Menu.Item>
                <Menu.Item onSelect={() => setPnOpen(true)} className={MENU_ITEM}>
                  <Hash className="size-4 opacity-70" /> {doc.pageNumbers ? "Edit page numbers…" : "Add page numbers…"}
                </Menu.Item>
              </Menu.Content>
            </Menu.Portal>
          </Menu.Root>
          <input
            ref={pdfInput}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            className="sr-only"
            tabIndex={-1}
            data-testid="insert-pdf-input"
            onChange={(e) => {
              const l = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (l.length) insertPdf(l);
            }}
          />
          <IconButton label="Insert image (I)" onClick={() => imageInput.current?.click()} disabled={inserting}>
            {inserting ? <Loader2 className="size-4 animate-spin" /> : <ImageIcon className="size-4" />}
          </IconButton>
          <input
            ref={imageInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) insertImage(f, "image");
            }}
          />
        </div>
        <IconButton label={fullscreen ? "Exit full screen (F)" : "Full screen (F)"} active={fullscreen} onClick={toggleFullscreen} className="hidden sm:inline-flex">
          {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </IconButton>
        <IconButton label={showInspector ? "Hide inspector" : "Show inspector"} active={showInspector} onClick={() => setShowInspector((s) => !s)} className="hidden lg:inline-flex">
          <PanelRight className="size-4" />
        </IconButton>
        <Menu.Root>
          <Menu.Trigger asChild>
            <IconButton label="More">
              <MoreHorizontal className="size-4" />
            </IconButton>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content align="end" sideOffset={6} className="glass z-50 w-60 animate-rise-in rounded-xl p-1.5 shadow-overlay">
              <Menu.Item
                onSelect={async () => {
                  if (await confirm("Discard all edits?", "Discard", "This removes every change and restores the original pages. It can't be undone.")) {
                    clearSaved(file.id);
                    editor.reset(initialDoc(pdf?.numPages ?? doc.pages.length));
                    setSelectedId(null);
                  }
                }}
                className="cursor-default rounded-lg px-2 py-1.5 text-sm text-danger outline-none data-[highlighted]:bg-danger data-[highlighted]:text-white"
              >
                Discard all edits…
              </Menu.Item>
              <Menu.Item onSelect={() => setKeysOpen(true)} className={MENU_ITEM}>
                <Keyboard className="size-4 opacity-70" /> Keyboard shortcuts <span className="ml-auto text-xs opacity-60">?</span>
              </Menu.Item>
              <Menu.Separator className="my-1 h-px bg-ink/10" />
              <div className="space-y-1 px-2 py-1.5 text-xs text-ink-3">
                <p className="flex justify-between">Undo / redo <span><Kbd>⌘Z</Kbd> <Kbd>⇧⌘Z</Kbd></span></p>
                <p className="flex justify-between">Zoom <span><Kbd>⌘+</Kbd> <Kbd>⌘−</Kbd></span></p>
                <p className="flex justify-between">Zoom with wheel <Kbd>⌘ scroll</Kbd></p>
                <p className="flex justify-between">Pan <Kbd>Space drag</Kbd></p>
                <p className="flex justify-between">Pages <span><Kbd>PgUp</Kbd> <Kbd>PgDn</Kbd></span></p>
                <p className="flex justify-between">Duplicate <Kbd>⌘D</Kbd></p>
                <p className="flex justify-between">Save <Kbd>⌘S</Kbd></p>
              </div>
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
        <Button size="sm" className="ml-1" icon={job.state.phase !== "idle" && exportKind === "save" && job.state.phase !== "done" && job.state.phase !== "failed" ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} onClick={savePdf} disabled={!pdf || job.state.phase === "running" || job.state.phase === "starting"} aria-label="Save (⌘S)" title="Save a new version to My Documents (⌘S)">
          <span className="hidden md:inline">Save</span>
        </Button>
        <Button variant="primary" size="sm" className="ml-1" icon={<Download className="size-3.5" />} onClick={exportPdf} disabled={!pdf || job.state.phase === "running" || job.state.phase === "starting"} aria-label={mode === "sign" ? "Download signed PDF" : "Download PDF"}>
          <span className="hidden sm:inline">{mode === "sign" ? "Download signed PDF" : "Download"}</span>
        </Button>
      </div>

      {restored && (
        <div className="flex items-center gap-3 border-b bg-accent/[0.06] px-4 py-2 text-sm text-ink">
          Restored your unsaved edits from this browser.
          <button
            type="button"
            className="font-medium text-accent hover:underline"
            onClick={() => {
              clearSaved(file.id);
              editor.reset(initialDoc(pdf?.numPages ?? doc.pages.length));
              setRestored(false);
            }}
          >
            Start fresh
          </button>
          <IconButton size="sm" label="Dismiss" className="ml-auto" onClick={() => setRestored(false)}>
            <X className="size-3.5" />
          </IconButton>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* ---------------------------------------------------------------- page rail */}
        {showRail && pdf && (
          <aside aria-label="Page thumbnails" className="sidebar-surface scroll-thin hidden w-[136px] shrink-0 overflow-y-auto border-r md:block">
            <Thumbnails
              doc={doc}
              editor={editor}
              fileIdFor={fileIdFor}
              current={currentKey}
              selected={selectedPages}
              onSelect={(key, on) => setSelectedPages((sel) => { const n = new Set(sel); if (on) n.add(key); else n.delete(key); return n; })}
              onGo={goTo}
              onDeletePage={deletePage}
            />
            {selectedPages.size > 0 && (
              <div className="sticky bottom-0 space-y-1 border-t bg-[rgb(var(--sidebar-bg))] p-2">
                <Button size="sm" variant="primary" className="w-full" onClick={extractSelected}>
                  Extract {selectedPages.size}
                </Button>
                <Button size="sm" variant="ghost" className="w-full" onClick={() => setSelectedPages(new Set())}>
                  Clear
                </Button>
              </div>
            )}
          </aside>
        )}

        {/* ---------------------------------------------------------------- canvas */}
        <div className="flex min-w-0 flex-1 flex-col">
        <div
          ref={scroller}
          onScroll={onScroll}
          data-testid="editor-scroller"
          className={cn("checker scroll-thin relative min-h-0 flex-1 touch-pan-x touch-pan-y overflow-auto", (toolId === "hand" || spaceHeld) && "cursor-grab active:cursor-grabbing [&_*]:cursor-[inherit]")}
          onPointerDownCapture={onPanStart}
          onPointerMove={onPanMove}
          onPointerUp={onPanEnd}
          onPointerCancel={onPanEnd}
          onPointerDown={(e) => e.target === e.currentTarget && setSelectedId(null)}
        >
          {!pdf ? (
            <div className="flex h-full items-center justify-center text-sm text-ink-3">
              <Loader2 className="mr-2 size-4 animate-spin" /> Opening document…
            </div>
          ) : (
            <div ref={content} className="flex min-w-max flex-col items-center gap-6 px-8 py-6">
              {doc.pages.map((p, i) => (
                <div key={p.key} className="flex flex-col items-center gap-1.5">
                  {!pdfFor(p) ? (
                    <div className="h-[600px] w-[440px] animate-pulse rounded-[3px] bg-surface-2" aria-label="Loading page" />
                  ) : (
                  <PageView
                    pdf={pdfFor(p)!}
                    page={p}
                    index={i}
                    scale={scale}
                    objects={doc.objects.filter((o) => o.pageKey === p.key)}
                    tool={toolId}
                    style={style}
                    selectedId={selectedId}
                    editingId={editingId}
                    editor={editor}
                    onSelect={setSelectedId}
                    onEdit={setEditingId}
                    onToolDone={() => setToolId("select")}
                    getText={getText}
                    registerView={registerView}
                    stamps={doc.watermark || doc.pageNumbers ? { watermark: doc.watermark, pageNumbers: doc.pageNumbers, total: doc.pages.length } : undefined}
                  />
                  )}
                  <span className="text-2xs tabular-nums text-ink-3">
                    {i + 1} / {doc.pages.length}
                  </span>
                </div>
              ))}
            </div>
          )}
          {toolId !== "select" && (
            <div className="glass pointer-events-none sticky bottom-4 left-1/2 mx-auto w-fit -translate-y-0 rounded-full px-4 py-1.5 text-xs text-ink-2 shadow-raised">
              {toolId === "replace" && "Click a line of text to replace it. The original text is removed on export."}
              {toolId === "text" && "Click anywhere to add text."}
              {(toolId === "highlight" || toolId === "underline" || toolId === "strike") && "Drag across text to mark it."}
              {toolId === "ink" && "Draw with mouse, trackpad or stylus."}
              {(toolId === "rect" || toolId === "ellipse" || toolId === "line" || toolId === "arrow") && "Drag to draw."}
              {toolId === "comment" && "Click to place a comment."}
              {toolId === "erase" && "Drag over an area to remove everything inside it on export."}
              {toolId === "hand" && "Drag to move around the document."}
              <span className="ml-2 text-ink-3">Esc to stop</span>
            </div>
          )}
        </div>

        {pdf && (
          <ZoomBar
            percent={zoomPct}
            pageIndex={currentIndex}
            pageCount={doc.pages.length}
            onZoom={(p) => zoomTo((p / 100) * CSS_UNITS)}
            onZoomIn={() => zoomBy(1)}
            onZoomOut={() => zoomBy(-1)}
            onFitWidth={() => fit("width")}
            onFitPage={() => fit("page")}
            onReset={() => zoomTo(CSS_UNITS)}
            onPage={(i) => {
              const key = doc.pages[i]?.key;
              if (key) goTo(key);
            }}
          />
        )}
        </div>

        {/* ---------------------------------------------------------------- inspector */}
        {showInspector && (
          <aside aria-label="Inspector" className="scroll-thin hidden w-[272px] shrink-0 overflow-y-auto border-l bg-surface lg:block">
            <Inspector object={selected} editor={editor} doc={doc} style={style} setStyle={setStyle} onDelete={deleteSelected} mode={mode} />
          </aside>
        )}
      </div>

      {/* compact inspector for small screens */}
      {selected && (
        <div className="glass fixed inset-x-0 bottom-0 z-30 max-h-[45vh] overflow-y-auto border-t shadow-overlay lg:hidden">
          <Inspector object={selected} editor={editor} doc={doc} style={style} setStyle={setStyle} onDelete={deleteSelected} mode={mode} />
        </div>
      )}

      <SignatureDialog open={sigOpen} onOpenChange={setSigOpen} onDone={(f) => insertImage(f, "signature")} />

      <Sheet open={exportOpen} onOpenChange={(o) => { if (!o && job.state.phase !== "running") { setExportOpen(false); job.reset(); } }} title={exportKind === "extract" ? "Extract pages" : exportKind === "split" ? "Split document" : mode === "sign" ? "Download signed PDF" : "Download PDF"} className="w-[min(560px,calc(100vw-32px))]">
        {(job.state.phase === "running" || job.state.phase === "starting") && <Processing state={job.state} onCancel={job.cancel} />}
        {job.state.phase === "done" && (
          <div className="space-y-3">
            <Result job={job.state.job} onStartOver={() => { setExportOpen(false); job.reset(); }} />
            <Button variant="ghost" onClick={openResult}>
              Open the exported PDF in the editor
            </Button>
          </div>
        )}
        {job.state.phase === "failed" && <Failure error={job.state.error} onRetry={() => runExport(exportKind)} onEdit={() => { setExportOpen(false); job.reset(); }} />}
      </Sheet>

      <WatermarkDialog open={wmOpen} onOpenChange={setWmOpen} value={doc.watermark} onApply={(watermark) => editor.update((d) => ({ ...d, watermark }))} />
      <PageNumbersDialog open={pnOpen} onOpenChange={setPnOpen} value={doc.pageNumbers} onApply={(pageNumbers) => editor.update((d) => ({ ...d, pageNumbers }))} />
      <ShortcutsDialog open={keysOpen} onOpenChange={setKeysOpen} />
      <Sheet
        open={splitOpen}
        onOpenChange={setSplitOpen}
        title="Split document"
        description={`Each range becomes its own PDF, with all your edits. The document has ${doc.pages.length} page${doc.pages.length === 1 ? "" : "s"}.`}
        footer={
          <>
            <Button onClick={() => setSplitOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={startSplit} disabled={!splitRanges.trim()}>
              Split
            </Button>
          </>
        }
      >
        <Field label="Page ranges" htmlFor="split-ranges" hint="Example: 1-3, 4-6, 7" error={splitError}>
          <Input id="split-ranges" value={splitRanges} onChange={(e) => { setSplitRanges(e.target.value); setSplitError(null); }} onKeyDown={(e) => e.key === "Enter" && startSplit()} placeholder="1-3, 4-6" autoFocus />
        </Field>
      </Sheet>
    </div>
  );
}
