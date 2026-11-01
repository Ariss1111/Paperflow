"use client";
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { CameraView } from "./CameraView";
import { CornerEditor } from "./CornerEditor";
import { ReviewView } from "./ReviewView";
import { PagesView } from "./PagesView";
import { useConfirm } from "@/components/ui/dialog";
import { toast } from "@/components/ui/feedback";
import { api, uploadFiles } from "@/lib/client/api";
import { analyzePhoto, encodeImage, FULL_FRAME, MODE_DEFAULTS, newPageId, prepareVision, renderPage, type Corners, type ScanPage } from "@/lib/scanner/client";
import { safePdfName, scanToPdf } from "@/lib/scanner/pdf";

type View = "camera" | "analyzing" | "review" | "corners" | "pages";

const defaultTitle = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `Scan ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}`;
};

async function finalize(p: ScanPage): Promise<ScanPage> {
  const img = await renderPage(p);
  const result = await encodeImage(img, p.mode);
  if (p.resultUrl) URL.revokeObjectURL(p.resultUrl);
  return { ...p, result, resultUrl: URL.createObjectURL(result), width: img.width, height: img.height };
}

// Survives moving to another page of the app, so a stray click on the sidebar doesn't lose a scan.
const session: { pages: ScanPage[]; title: string | null } = { pages: [], title: null };

export function ScannerPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [view, setView] = React.useState<View>(session.pages.length ? "pages" : "camera");
  const [pages, setPages] = React.useState<ScanPage[]>(session.pages);
  const [draft, setDraft] = React.useState<ScanPage | null>(null);
  /** an existing page the draft will replace (retake or edit) */
  const [replacing, setReplacing] = React.useState<string | null>(null);
  const [lastCaptured, setLastCaptured] = React.useState<Corners | null>(null);
  const [title, setTitle] = React.useState(() => session.title ?? defaultTitle());
  const [busy, setBusy] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [exporting, setExporting] = React.useState<"download" | "continue" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [engineError, setEngineError] = React.useState<string | null>(null);
  const [analyzing, setAnalyzing] = React.useState("");
  const { confirm, element: confirmEl } = useConfirm();
  const seeded = React.useRef(false);

  React.useEffect(() => {
    prepareVision().catch((e) => setEngineError((e as Error).message));
  }, []);

  React.useEffect(() => {
    session.pages = pages;
    session.title = title;
  }, [pages, title]);

  // scans exist only in this tab until exported
  React.useEffect(() => {
    if (!pages.length) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pages.length]);

  const makeDraft = React.useCallback(async (source: Blob, id = newPageId()): Promise<ScanPage> => {
    const r = await analyzePhoto(id, source);
    return {
      id,
      source,
      corners: r.found && r.corners ? r.corners : FULL_FRAME,
      detected: r.found,
      rotation: r.rotation ?? 0,
      mode: "color",
      options: MODE_DEFAULTS.color,
    };
  }, []);

  const openPhoto = React.useCallback(
    async (source: Blob, live: Corners | null) => {
      setError(null);
      setEngineError(null);
      setAnalyzing("Finding the page…");
      setView("analyzing");
      try {
        const d = await makeDraft(source);
        setDraft(d);
        setLastCaptured(live ?? d.corners);
        // no page found: go straight to manual corners
        setView(d.detected ? "review" : "corners");
      } catch (e) {
        setEngineError((e as Error).message);
        setView("camera");
      }
    },
    [makeDraft],
  );

  /** One photo goes through review; a batch is processed with defaults and flagged where the crop needs checking. */
  const onUpload = React.useCallback(
    async (files: File[]) => {
      if (files.length === 1) {
        await openPhoto(files[0], null);
        return;
      }
      setView("analyzing");
      const added: ScanPage[] = [];
      let failed = 0;
      for (let i = 0; i < files.length; i++) {
        setAnalyzing(`Processing photo ${i + 1} of ${files.length}…`);
        try {
          added.push(await finalize(await makeDraft(files[i])));
        } catch {
          failed++;
        }
      }
      setPages((p) => [...p, ...added]);
      if (failed) toast(`${failed} photo${failed > 1 ? "s" : ""} couldn't be read and ${failed > 1 ? "were" : "was"} skipped.`, "danger");
      setView("pages");
    },
    [makeDraft, openPhoto],
  );

  // images handed over from the home page or another tool
  React.useEffect(() => {
    if (seeded.current) return;
    const ids = (params.get("files") ?? "").split(",").filter(Boolean);
    if (!ids.length) return;
    seeded.current = true;
    Promise.all(ids.map(async (id) => new File([await (await fetch(api.fileUrl(id))).blob()], id)))
      .then(onUpload)
      .catch(() => toast("Those photos are no longer available. Upload them again.", "danger"));
  }, [params, onUpload]);

  const keep = async (next: "scan" | "finish") => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const done = await finalize(draft);
      setPages((list) => (replacing ? list.map((p) => (p.id === replacing ? done : p)) : [...list, done]));
      setDraft(null);
      setReplacing(null);
      setView(next === "scan" ? "camera" : "pages");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const rotatePage = async (p: ScanPage) => {
    setBusyId(p.id);
    try {
      const done = await finalize({ ...p, rotation: (p.rotation + 90) % 360 });
      setPages((list) => list.map((x) => (x.id === p.id ? done : x)));
    } catch (e) {
      toast((e as Error).message, "danger");
    } finally {
      setBusyId(null);
    }
  };

  const removePage = async (p: ScanPage) => {
    if (!(await confirm("Delete this page?", "Delete", "It will be removed from your scan. This can't be undone."))) return;
    if (p.resultUrl) URL.revokeObjectURL(p.resultUrl);
    setPages((list) => list.filter((x) => x.id !== p.id));
  };

  const download_ = async () => {
    setExporting("download");
    setError(null);
    try {
      const bytes = await scanToPdf(pages, title.trim() || "Scan");
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = safePdfName(title);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      toast("Your PDF is downloading.", "success");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(null);
    }
  };

  const continueEditing = async (href: string) => {
    setExporting("continue");
    setError(null);
    try {
      const bytes = await scanToPdf(pages, title.trim() || "Scan");
      const res = await uploadFiles([new File([bytes], safePdfName(title), { type: "application/pdf" })]);
      const f = res.files[0];
      if (!f) throw new Error(res.errors[0]?.error ?? "The PDF couldn't be opened in that tool.");
      session.pages = []; // now a real file in the chosen tool; a later visit starts a fresh scan
      session.title = null;
      setPages([]);
      router.push(`${href}?files=${f.id}`);
    } catch (e) {
      setError((e as Error).message);
      setExporting(null);
    }
  };

  return (
    <div className="h-[calc(100dvh-48px)] min-h-0 lg:h-dvh">
      {confirmEl}
      {view === "camera" && (
        <CameraView
          pageCount={pages.length}
          replacing={!!replacing}
          lastCaptured={lastCaptured}
          engineError={engineError}
          onCapture={openPhoto}
          onUpload={onUpload}
          onFinish={() => {
            setReplacing(null);
            setView("pages");
          }}
        />
      )}
      {view === "analyzing" && (
        <div className="flex h-full flex-col items-center justify-center gap-3 bg-[#111113] text-sm text-white/80" aria-live="polite">
          <Loader2 className="size-6 animate-spin" />
          {analyzing}
        </div>
      )}
      {view === "corners" && draft && (
        <CornerEditor
          source={draft.source}
          corners={draft.corners}
          detected={draft.detected}
          onCancel={() => {
            if (draft.detected || replacing) setView("review");
            else {
              setDraft(null);
              setView("camera");
            }
          }}
          onApply={(corners) => {
            setDraft({ ...draft, corners, detected: true });
            setView("review");
          }}
        />
      )}
      {view === "review" && draft && (
        <ReviewView
          page={draft}
          isNew={!replacing}
          busy={busy}
          error={error}
          onChange={setDraft}
          onAdjust={() => setView("corners")}
          onRetake={() => {
            setDraft(null);
            setLastCaptured(null);
            setView("camera");
          }}
          onKeep={keep}
          onCancel={() => {
            setDraft(null);
            setReplacing(null);
            setView("pages");
          }}
        />
      )}
      {view === "pages" && (
        <PagesView
          pages={pages}
          title={title}
          busyId={busyId}
          exporting={exporting}
          error={error}
          onTitle={setTitle}
          onReorder={setPages}
          onRotate={rotatePage}
          onEdit={(p) => {
            setDraft(p);
            setReplacing(p.id);
            setView("review");
          }}
          onRetake={(p) => {
            setReplacing(p.id);
            setDraft(null);
            setLastCaptured(null);
            setView("camera");
          }}
          onDelete={removePage}
          onAdd={() => {
            setReplacing(null);
            setLastCaptured(null);
            setView("camera");
          }}
          onDownload={download_}
          onContinue={continueEditing}
        />
      )}
    </div>
  );
}
