"use client";
import * as React from "react";
import { FileText, FileSpreadsheet, Presentation, FileCode, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/client/api";
import { loadPdf, renderThumb } from "@/lib/client/pdfjs";
import { FORMATS } from "@/lib/formats";
import type { StoredFile } from "@/types";

/** Lazily renders the first page of a PDF (or shows an image / type icon) once it scrolls into view. */
export function FileThumb({ file, width = 44, page = 1, rotation = 0, className }: { file: StoredFile; width?: number; page?: number; rotation?: number; className?: string }) {
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const box = React.useRef<HTMLDivElement>(null);
  const [state, setState] = React.useState<"idle" | "done" | "error">("idle");
  const kind = FORMATS[file.format].kind;

  React.useEffect(() => {
    if (file.format !== "pdf" || file.encrypted) return;
    let live = true;
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(async ([entry]) => {
      if (!entry.isIntersecting) return;
      io.disconnect();
      try {
        const doc = await loadPdf(api.fileUrl(file.id), file.id);
        if (live && canvas.current) {
          await renderThumb(doc, Math.min(page, doc.numPages), canvas.current, width, rotation);
          if (live) setState("done");
        }
      } catch {
        if (live) setState("error");
      }
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => {
      live = false;
      io.disconnect();
    };
  }, [file.id, file.format, file.encrypted, page, width, rotation]);

  const height = Math.round(width * 1.3);
  if (kind === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={api.fileUrl(file.id)} alt="" loading="lazy" className={cn("rounded-[5px] object-cover shadow-hairline", className)} style={{ width, height }} />
    );
  }
  const FallbackIcon = file.encrypted ? Lock : kind === "spreadsheet" ? FileSpreadsheet : kind === "presentation" ? Presentation : kind === "text" ? FileCode : FileText;
  return (
    <div ref={box} className={cn("relative flex shrink-0 items-center justify-center overflow-hidden rounded-[5px] bg-white shadow-[0_0_0_0.5px_rgb(0_0_0/0.12),0_1px_2px_rgb(0_0_0/0.06)]", className)} style={{ width, minHeight: file.format === "pdf" && state === "done" ? undefined : height }}>
      {file.format === "pdf" && !file.encrypted && <canvas ref={canvas} className={cn("block transition-opacity duration-300", state === "done" ? "opacity-100" : "opacity-0")} aria-hidden />}
      {(file.format !== "pdf" || file.encrypted || state !== "done") && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 bg-surface-2">
          <FallbackIcon className="size-[40%] max-h-6 max-w-6 text-ink-3" strokeWidth={1.5} aria-hidden />
          {width >= 60 && <span className="text-2xs font-semibold uppercase text-ink-3">{FORMATS[file.format].ext}</span>}
        </div>
      )}
    </div>
  );
}
