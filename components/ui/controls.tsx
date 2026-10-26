"use client";
import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const fieldBase =
  "w-full rounded-lg bg-surface text-sm text-ink placeholder:text-ink-3 shadow-[inset_0_0_0_0.5px_rgb(var(--line)/0.16),0_0.5px_1px_rgb(0_0_0/0.04)] transition-shadow duration-150 focus:outline-none focus:shadow-[inset_0_0_0_1px_rgb(var(--accent)),0_0_0_3px_rgb(var(--accent)/0.2)] disabled:opacity-50";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(fieldBase, "h-8 px-2.5", className)} {...rest} />;
});

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(fieldBase, "min-h-24 px-2.5 py-2 leading-5", className)} {...rest} />;
});

export function Select({ className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={cn("relative", className)}>
      <select className={cn(fieldBase, "h-8 appearance-none pl-2.5 pr-8")} {...rest}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
    </div>
  );
}

/** macOS-style segmented control (radio group semantics). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = "md",
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode; title?: string }[];
  label: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const idx = options.findIndex((o) => o.value === value);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = (idx + (e.key === "ArrowRight" ? 1 : -1) + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} onKeyDown={onKey} className={cn("inline-flex w-full rounded-[9px] bg-ink/[0.06] p-[2px]", className)}>
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex-1 whitespace-nowrap rounded-[7px] px-2.5 font-medium transition-all duration-200 ease-mac",
              size === "sm" ? "h-6 text-xs" : "h-7 text-sm",
              active ? "bg-surface text-ink shadow-[0_0_0_0.5px_rgb(0_0_0/0.06),0_1px_3px_rgb(0_0_0/0.1)]" : "text-ink-2 hover:text-ink",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Switch({ checked, onCheckedChange, id, label }: { checked: boolean; onCheckedChange: (v: boolean) => void; id?: string; label?: string }) {
  return (
    <SwitchPrimitive.Root
      id={id}
      aria-label={label}
      checked={checked}
      onCheckedChange={onCheckedChange}
      className="relative inline-flex h-[22px] w-[38px] shrink-0 cursor-pointer items-center rounded-full bg-ink/[0.14] transition-colors duration-200 data-[state=checked]:bg-success"
    >
      <SwitchPrimitive.Thumb className="block size-[18px] translate-x-[2px] rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.25),0_0_0_0.5px_rgb(0_0_0/0.04)] transition-transform duration-200 ease-spring data-[state=checked]:translate-x-[18px]" />
    </SwitchPrimitive.Root>
  );
}

export function Field({ label, hint, error, htmlFor, children, inline }: { label: React.ReactNode; hint?: React.ReactNode; error?: string | null; htmlFor?: string; children: React.ReactNode; inline?: boolean }) {
  return (
    <div className={cn(inline ? "flex items-center justify-between gap-4" : "space-y-1.5")}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs leading-4 text-ink-3">{hint}</p>
      ) : null}
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] bg-ink/[0.06] px-1 font-sans text-2xs font-medium text-ink-2">{children}</kbd>;
}
