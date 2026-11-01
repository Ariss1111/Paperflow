"use client";
import * as React from "react";
import { ChevronUp, ChevronRight, ChevronLeft, ZoomIn, ZoomOut, Maximize, MoveHorizontal, RotateCcw } from "lucide-react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { IconButton } from "@/components/ui/button";

export const MIN_ZOOM = 10;
export const MAX_ZOOM = 500;
const PRESETS = [50, 75, 100, 125, 150, 200, 300, 400];

/** Accepts "150" or "150%". Out-of-range values clamp; anything else returns null. */
export function parseZoom(text: string): number | null {
  const n = Number.parseFloat(text.replace("%", "").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, n));
}

function NumberBox({ value, label, suffix, onCommit, width, parse }: { value: number; label: string; suffix?: string; onCommit: (n: number) => void; width: string; parse: (t: string) => number | null }) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const commit = () => {
    if (draft !== null) {
      const n = parse(draft);
      if (n !== null) onCommit(n);
    }
    setDraft(null);
  };
  return (
    <span className="relative inline-flex items-center">
      <input
        type="text"
        inputMode="numeric"
        aria-label={label}
        value={draft ?? String(value)}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(null);
            requestAnimationFrame(() => (document.activeElement as HTMLElement | null)?.blur?.());
          }
        }}
        className="h-7 rounded-md bg-ink/[0.05] pl-1.5 pr-4 text-right text-xs font-medium tabular-nums text-ink focus:outline-none focus:ring-2 focus:ring-accent/40"
        style={{ width }}
      />
      {suffix && <span className="pointer-events-none absolute right-1.5 text-xs text-ink-3">{suffix}</span>}
    </span>
  );
}

const ITEM = "flex cursor-default items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm text-ink outline-none data-[highlighted]:bg-accent data-[highlighted]:text-white";

export function ZoomBar({
  percent,
  pageIndex,
  pageCount,
  onZoom,
  onZoomIn,
  onZoomOut,
  onFitWidth,
  onFitPage,
  onReset,
  onPage,
}: {
  percent: number;
  pageIndex: number;
  pageCount: number;
  onZoom: (percent: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitWidth: () => void;
  onFitPage: () => void;
  onReset: () => void;
  onPage: (index: number) => void;
}) {
  return (
    <div role="toolbar" aria-label="Page and zoom controls" className="glass z-10 flex h-11 shrink-0 items-center justify-between gap-2 border-t px-2 sm:px-3" data-testid="zoom-bar">
      <div className="flex items-center gap-0.5">
        <IconButton size="sm" label="Previous page (PgUp)" disabled={pageIndex <= 0} onClick={() => onPage(pageIndex - 1)}>
          <ChevronLeft className="size-4" />
        </IconButton>
        <NumberBox
          value={pageIndex + 1}
          label="Page number"
          width="2.75rem"
          parse={(t) => {
            const n = Number.parseInt(t, 10);
            return Number.isFinite(n) ? Math.max(1, Math.min(pageCount, n)) : null;
          }}
          onCommit={(n) => onPage(n - 1)}
        />
        <span className="px-1 text-xs tabular-nums text-ink-3">/ {pageCount}</span>
        <IconButton size="sm" label="Next page (PgDn)" disabled={pageIndex >= pageCount - 1} onClick={() => onPage(pageIndex + 1)}>
          <ChevronRight className="size-4" />
        </IconButton>
      </div>

      <div className="flex items-center gap-0.5">
        <IconButton size="sm" label="Fit to width (⌘0)" onClick={onFitWidth} className="hidden sm:inline-flex">
          <MoveHorizontal className="size-4" />
        </IconButton>
        <IconButton size="sm" label="Fit to page" onClick={onFitPage} className="hidden sm:inline-flex">
          <Maximize className="size-4" />
        </IconButton>
        <span className="mx-1 hidden h-5 w-px bg-ink/10 sm:block" aria-hidden />
        <IconButton size="sm" label="Zoom out (⌘−)" onClick={onZoomOut} disabled={percent <= MIN_ZOOM}>
          <ZoomOut className="size-4" />
        </IconButton>
        <NumberBox value={percent} label="Zoom percentage" suffix="%" width="3.75rem" parse={parseZoom} onCommit={onZoom} />
        <Menu.Root>
          <Menu.Trigger asChild>
            <IconButton size="sm" label="Zoom options">
              <ChevronUp className="size-3.5" />
            </IconButton>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content side="top" align="end" sideOffset={8} className="glass z-50 w-48 animate-rise-in rounded-xl p-1.5 shadow-overlay">
              <Menu.Item onSelect={onFitWidth} className={ITEM}>
                Fit to width <span className="text-xs opacity-60">⌘0</span>
              </Menu.Item>
              <Menu.Item onSelect={onFitPage} className={ITEM}>
                Fit to page
              </Menu.Item>
              <Menu.Item onSelect={onReset} className={ITEM}>
                Reset zoom <span className="text-xs opacity-60">⌘1</span>
              </Menu.Item>
              <Menu.Separator className="my-1 h-px bg-ink/10" />
              {PRESETS.map((z) => (
                <Menu.Item key={z} onSelect={() => onZoom(z)} className={ITEM}>
                  {z}%
                </Menu.Item>
              ))}
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
        <IconButton size="sm" label="Zoom in (⌘+)" onClick={onZoomIn} disabled={percent >= MAX_ZOOM}>
          <ZoomIn className="size-4" />
        </IconButton>
        <IconButton size="sm" label="Reset zoom (⌘1)" onClick={onReset} className="hidden md:inline-flex">
          <RotateCcw className="size-3.5" />
        </IconButton>
      </div>
    </div>
  );
}

