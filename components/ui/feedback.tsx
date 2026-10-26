"use client";
import * as React from "react";
import { cn } from "@/lib/utils";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";

/** Honest progress: a real fraction renders a determinate bar; `null` renders an indeterminate one. */
export function Progress({ value, className, label }: { value: number | null; className?: string; label?: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label ?? "Progress"}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === null ? undefined : Math.round(value * 100)}
      className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-ink/[0.08]", className)}
    >
      {value === null ? (
        <div className="absolute inset-y-0 w-2/5 animate-indeterminate rounded-full bg-accent" />
      ) : (
        <div className="h-full rounded-full bg-accent transition-[width] duration-300 ease-mac" style={{ width: `${Math.max(2, value * 100)}%` }} />
      )}
    </div>
  );
}

export function Badge({ tone = "neutral", children, className }: { tone?: "neutral" | "accent" | "success" | "warning" | "danger"; children: React.ReactNode; className?: string }) {
  const tones = {
    neutral: "bg-ink/[0.06] text-ink-2",
    accent: "bg-accent/[0.12] text-accent",
    success: "bg-success/[0.12] text-success",
    warning: "bg-warning/[0.14] text-warning",
    danger: "bg-danger/[0.1] text-danger",
  };
  return <span className={cn("inline-flex h-5 items-center gap-1 rounded-full px-2 text-2xs font-semibold", tones[tone], className)}>{children}</span>;
}

export function Notice({ tone = "info", title, children, className }: { tone?: "info" | "warning" | "danger" | "success"; title?: React.ReactNode; children?: React.ReactNode; className?: string }) {
  const Icon = tone === "success" ? CheckCircle2 : tone === "info" ? Info : AlertTriangle;
  const tones = {
    info: "bg-accent/[0.07] text-accent",
    warning: "bg-warning/[0.09] text-warning",
    danger: "bg-danger/[0.07] text-danger",
    success: "bg-success/[0.08] text-success",
  };
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("flex gap-2.5 rounded-[11px] px-3.5 py-3 text-sm", tones[tone], className)}>
      <Icon className="mt-px size-4 shrink-0" aria-hidden />
      <div className="min-w-0 space-y-0.5 text-ink">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className="text-ink-2">{children}</div>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ toasts

type Toast = { id: number; tone: "success" | "danger" | "info"; text: string };
const listeners = new Set<(t: Toast[]) => void>();
let toasts: Toast[] = [];
let nextId = 1;

export function toast(text: string, tone: Toast["tone"] = "info") {
  const t = { id: nextId++, tone, text };
  toasts = [...toasts.slice(-3), t];
  listeners.forEach((l) => l(toasts));
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    listeners.forEach((l) => l(toasts));
  }, 4200);
}

export function Toaster() {
  const [items, setItems] = React.useState<Toast[]>([]);
  React.useEffect(() => {
    listeners.add(setItems);
    return () => {
      listeners.delete(setItems);
    };
  }, []);
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 left-1/2 z-[100] flex w-[min(420px,calc(100vw-32px))] -translate-x-1/2 flex-col items-center gap-2">
      {items.map((t) => (
        <div key={t.id} className="glass pointer-events-auto flex w-full animate-sheet-in items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm text-ink shadow-overlay">
          {t.tone === "success" ? <CheckCircle2 className="size-4 text-success" /> : t.tone === "danger" ? <AlertTriangle className="size-4 text-danger" /> : <Info className="size-4 text-accent" />}
          <span className="flex-1">{t.text}</span>
          <button
            type="button"
            aria-label="Dismiss"
            className="text-ink-3 hover:text-ink"
            onClick={() => {
              toasts = toasts.filter((x) => x.id !== t.id);
              listeners.forEach((l) => l(toasts));
            }}
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon: React.ReactNode; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-ink/[0.05] text-ink-3">{icon}</div>
      <p className="text-base font-semibold text-ink">{title}</p>
      {children && <p className="mt-1 max-w-sm text-sm text-ink-2">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
