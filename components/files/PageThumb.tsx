"use client";
import * as React from "react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/client/api";
import { loadPdf, renderThumb } from "@/lib/client/pdfjs";

/** One rendered PDF page. Rendering is deferred until visible; rotation re-renders crisp rather than CSS-rotating. */
export function PageThumb({ fileId, page, rotation = 0, width = 132, className }: { fileId: string; page: number; rotation?: number; width?: number; className?: string }) {
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const holder = React.useRef<HTMLDivElement>(null);
  const [ready, setReady] = React.useState(false);
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  React.useEffect(() => {
    if (!visible) return;
    let live = true;
    loadPdf(api.fileUrl(fileId), fileId)
      .then((doc) => canvas.current && renderThumb(doc, page, canvas.current, width, rotation))
      .then(() => live && setReady(true))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [visible, fileId, page, rotation, width]);

  const sideways = rotation % 180 !== 0;
  return (
    <div
      ref={holder}
      className={cn("relative flex items-center justify-center overflow-hidden rounded-[4px] bg-white shadow-[0_0_0_0.5px_rgb(0_0_0/0.14),0_2px_6px_-1px_rgb(0_0_0/0.1)]", className)}
      style={{ width, minHeight: ready ? undefined : Math.round(width * (sideways ? 0.75 : 1.32)) }}
    >
      <canvas ref={canvas} aria-hidden className={cn("block transition-opacity duration-300", ready ? "opacity-100" : "opacity-0")} />
      {!ready && <div className="absolute inset-0 animate-pulse bg-surface-2" />}
    </div>
  );
}
