"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PDFDocumentProxy, PageViewport } from "pdfjs-dist";
import {
  MousePointer2, Type, TextCursorInput, Highlighter, Underline, Strikethrough, PenLine, Square, Circle, Minus, MoveUpRight, MessageSquare,
  Eraser, Image as ImageIcon, Signature, CalendarDays, Undo2, Redo2, ZoomIn, ZoomOut, Download, ChevronLeft, PanelLeft, PanelRight, MoreHorizontal, X, Loader2,
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
import { api } from "@/lib/client/api";
import { loadPdf } from "@/lib/client/pdfjs";
import type { EditDocument, EditObject, TextObj } from "@/lib/editor/model";
import { useEditorState, initialDoc, loadSaved, clearSaved, uid } from "./useEditorState";
import { PageView, fitText, translate, type ToolId, type ToolStyle } from "./PageView";
import { Inspector } from "./Inspector";
import { Thumbnails } from "./Thumbnails";
import { SignatureDialog } from "./SignatureDialog";
import { loadEditorFonts } from "./fonts";
import { textItems, pointToPdf, type TextItem } from "./geometry";
import { cn } from "@/lib/utils";
import type { StoredFile } from "@/types";

const CSS_UNITS = 96 / 72;
const ZOOMS = [0.25, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];

type ToolDefn = { id: ToolId; label: string; icon: React.ComponentType<{ className?: string }>; key: string };
const EDIT_TOOLS: ToolDefn[][] = [
  [{ id: "select", label: "Select", icon: MousePointer2, key: "V" }],
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
const SIGN_TOOLS: ToolDefn[][] = [[{ id: "select", label: "Select", icon: MousePointer2, key: "V" }], [{ id: "text", label: "Add text", icon: Type, key: "T" }]];

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
  return <Workspace key={file.id} file={file} mode={mode} onClose={() => setFiles([])} />;
}

function Workspace({ file, mode, onClose }: { file: StoredFile; mode: "edit" | "sign"; onClose: () => void }) {
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
  const scroller = React.useRef<HTMLDivElement>(null);
  const views = React.useRef(new Map<string, { el: HTMLElement; vp: PageViewport }>());
  const textCache = React.useRef(new Map<number, Promise<TextItem[]>>());
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
        if (saved && saved.pages.every((pg) => pg.src < p.numPages)) {
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

  const fit = React.useCallback(
    async (kind: "width" | "page") => {
      if (!pdf || !scroller.current) return;
      // fit to the widest page (mixed portrait/landscape documents), page-fit to the current one
      let maxW = 1;
      let curH = 1;
      for (const p of doc.pages.slice(0, 60)) {
        const page = await pdf.getPage(p.src + 1);
        const vp = page.getViewport({ scale: 1, rotation: (page.rotate + p.rotate) % 360 });
        maxW = Math.max(maxW, vp.width);
        if (p.key === (currentKey ?? doc.pages[0]?.key)) curH = vp.height;
      }
      const w = (scroller.current.clientWidth - 64) / maxW;
      const h = (scroller.current.clientHeight - 48) / curH;
      setScale(Math.max(0.2, Math.min(4 * CSS_UNITS, kind === "width" ? w : Math.min(w, h))));
    },
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
    (src: number) => {
      if (!textCache.current.has(src) && pdf) textCache.current.set(src, pdf.getPage(src + 1).then((p) => p.getTextContent()).then(textItems));
      return textCache.current.get(src) ?? Promise.resolve([]);
    },
    [pdf],
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
    if (next) setScale(next * CSS_UNITS);
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

  const exportPdf = () => {
    setEditingId(null);
    const clean = cleanForExport(doc);
    const images = [...new Set(clean.objects.flatMap((o) => (o.type === "image" || o.type === "signature" ? [o.fileId] : [])))];
    setExportOpen(true);
    job.start(mode === "sign" ? "sign" : "edit", [file.id, ...images], { edit: clean, suffix: mode === "sign" ? "signed" : "edited" });
  };

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
        exportPdf();
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
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const toolGroups = mode === "sign" ? SIGN_TOOLS : EDIT_TOOLS;
  const zoomPct = Math.round((scale / CSS_UNITS) * 100);
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
    <div className="flex h-[calc(100dvh-48px)] min-h-0 flex-col lg:h-dvh">
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
        <div className="hidden items-center gap-0.5 sm:flex">
          <IconButton label="Zoom out (⌘−)" onClick={() => zoomBy(-1)}>
            <ZoomOut className="size-4" />
          </IconButton>
          <Menu.Root>
            <Menu.Trigger className="h-7 w-14 rounded-md text-xs font-medium tabular-nums text-ink-2 hover:bg-ink/[0.06]" aria-label="Zoom options">
              {zoomPct}%
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Content sideOffset={6} className="glass z-50 w-44 animate-rise-in rounded-xl p-1.5 shadow-overlay">
                {[
                  ["Fit width", () => fit("width"), "⌘0"],
                  ["Fit page", () => fit("page"), ""],
                  ["Actual size", () => setScale(CSS_UNITS), ""],
                ].map(([label, fn, k]) => (
                  <Menu.Item key={label as string} onSelect={fn as () => void} className="flex cursor-default items-center justify-between rounded-lg px-2 py-1.5 text-sm text-ink outline-none data-[highlighted]:bg-accent data-[highlighted]:text-white">
                    {label as string}
                    {k && <span className="text-xs opacity-60">{k as string}</span>}
                  </Menu.Item>
                ))}
                <Menu.Separator className="my-1 h-px bg-ink/10" />
                {[50, 75, 100, 125, 150, 200].map((z) => (
                  <Menu.Item key={z} onSelect={() => setScale((z / 100) * CSS_UNITS)} className="cursor-default rounded-lg px-2 py-1.5 text-sm text-ink outline-none data-[highlighted]:bg-accent data-[highlighted]:text-white">
                    {z}%
                  </Menu.Item>
                ))}
              </Menu.Content>
            </Menu.Portal>
          </Menu.Root>
          <IconButton label="Zoom in (⌘+)" onClick={() => zoomBy(1)}>
            <ZoomIn className="size-4" />
          </IconButton>
        </div>
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
              <Menu.Separator className="my-1 h-px bg-ink/10" />
              <div className="space-y-1 px-2 py-1.5 text-xs text-ink-3">
                <p className="flex justify-between">Undo / redo <span><Kbd>⌘Z</Kbd> <Kbd>⇧⌘Z</Kbd></span></p>
                <p className="flex justify-between">Zoom <span><Kbd>⌘+</Kbd> <Kbd>⌘−</Kbd></span></p>
                <p className="flex justify-between">Pages <span><Kbd>PgUp</Kbd> <Kbd>PgDn</Kbd></span></p>
                <p className="flex justify-between">Duplicate <Kbd>⌘D</Kbd></p>
                <p className="flex justify-between">Export <Kbd>⌘S</Kbd></p>
              </div>
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
        <Button variant="primary" size="sm" className="ml-1" icon={<Download className="size-3.5" />} onClick={exportPdf} disabled={!pdf}>
          <span className="hidden sm:inline">{mode === "sign" ? "Export signed PDF" : "Export PDF"}</span>
          <span className="sm:hidden">Export</span>
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
            <Thumbnails doc={doc} editor={editor} fileId={file.id} current={currentKey} onGo={goTo} onDeletePage={deletePage} />
          </aside>
        )}

        {/* ---------------------------------------------------------------- canvas */}
        <div ref={scroller} onScroll={onScroll} className="checker scroll-thin relative min-w-0 flex-1 overflow-auto" onPointerDown={(e) => e.target === e.currentTarget && setSelectedId(null)}>
          {!pdf ? (
            <div className="flex h-full items-center justify-center text-sm text-ink-3">
              <Loader2 className="mr-2 size-4 animate-spin" /> Opening document…
            </div>
          ) : (
            <div className="flex min-w-max flex-col items-center gap-6 px-8 py-6">
              {doc.pages.map((p, i) => (
                <div key={p.key} className="flex flex-col items-center gap-1.5">
                  <PageView
                    pdf={pdf}
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
                  />
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
              <span className="ml-2 text-ink-3">Esc to stop</span>
            </div>
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

      <Sheet open={exportOpen} onOpenChange={(o) => { if (!o && job.state.phase !== "running") { setExportOpen(false); job.reset(); } }} title={mode === "sign" ? "Export signed PDF" : "Export PDF"} className="w-[min(560px,calc(100vw-32px))]">
        {(job.state.phase === "running" || job.state.phase === "starting") && <Processing state={job.state} onCancel={job.cancel} />}
        {job.state.phase === "done" && (
          <div className="space-y-3">
            <Result job={job.state.job} onStartOver={() => { setExportOpen(false); job.reset(); }} />
            <Button variant="ghost" onClick={openResult}>
              Open the exported PDF in the editor
            </Button>
          </div>
        )}
        {job.state.phase === "failed" && <Failure error={job.state.error} onRetry={exportPdf} onEdit={() => { setExportOpen(false); job.reset(); }} />}
      </Sheet>
    </div>
  );
}
