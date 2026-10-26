"use client";
import * as React from "react";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/feedback";
import { acceptAttr, FORMATS, type FormatId } from "@/lib/formats";

export function DropZone({
  onFiles,
  accepts,
  multiple = true,
  uploading,
  progress,
  onCancel,
  size = "lg",
  title,
  hint,
  className,
}: {
  onFiles: (files: File[]) => void;
  accepts?: FormatId[];
  multiple?: boolean;
  uploading?: boolean;
  progress?: number | null;
  onCancel?: () => void;
  size?: "lg" | "sm";
  title?: string;
  hint?: string;
  className?: string;
}) {
  const input = React.useRef<HTMLInputElement>(null);
  const [over, setOver] = React.useState(false);
  const depth = React.useRef(0);
  const labels = accepts ? [...new Set(accepts.map((f) => FORMATS[f].label.replace(/ 97$/, "")))] : null;

  const pick = (list: FileList | null) => {
    if (!list?.length) return;
    onFiles(Array.from(multiple ? list : [list[0]]));
  };

  return (
    <div
      onDragEnter={(e) => {
        e.preventDefault();
        depth.current++;
        setOver(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        if (!uploading) pick(e.dataTransfer.files);
      }}
      className={cn(
        "relative flex flex-col items-center justify-center rounded-[18px] border border-dashed text-center transition-all duration-200 ease-mac",
        size === "lg" ? "min-h-[260px] px-6 py-10" : "min-h-[132px] px-5 py-6",
        over ? "scale-[1.005] border-accent bg-accent/[0.06]" : "border-ink/[0.16] bg-surface hover:border-ink/[0.24]",
        className,
      )}
    >
      <input
        ref={input}
        type="file"
        className="sr-only"
        tabIndex={-1}
        multiple={multiple}
        accept={accepts ? acceptAttr(accepts) : undefined}
        onChange={(e) => {
          pick(e.target.files);
          e.target.value = "";
        }}
      />
      {uploading ? (
        <div className="w-full max-w-xs space-y-3" aria-live="polite">
          <p className="text-sm font-medium text-ink">{progress === null || progress === undefined ? "Preparing upload…" : progress >= 1 ? "Checking files…" : `Uploading… ${Math.round(progress * 100)}%`}</p>
          <Progress value={progress === undefined || (progress ?? 0) >= 1 ? null : progress} label="Upload progress" />
          {onCancel && (progress ?? 0) < 1 && (
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className={cn("mb-4 flex items-center justify-center rounded-2xl bg-accent/[0.09] text-accent transition-transform duration-300 ease-spring", size === "lg" ? "size-14" : "size-10", over && "-translate-y-1 scale-105")}>
            <Upload className={size === "lg" ? "size-6" : "size-[18px]"} strokeWidth={1.75} aria-hidden />
          </div>
          <p className={cn("font-semibold text-ink", size === "lg" ? "text-lg" : "text-base")}>{over ? "Drop to add" : (title ?? "Drop files here")}</p>
          <p className="mt-1 text-sm text-ink-2">{hint ?? (labels ? `${labels.slice(0, 6).join(", ")}${labels.length > 6 ? " and more" : ""}` : "PDF, Office documents and images")}</p>
          <Button variant="primary" size={size === "lg" ? "lg" : "md"} className="mt-5" onClick={() => input.current?.click()}>
            {multiple ? "Select files" : "Select file"}
          </Button>
        </>
      )}
    </div>
  );
}
