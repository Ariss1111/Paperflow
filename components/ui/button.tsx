"use client";
import * as React from "react";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "plain";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-ink shadow-[inset_0_0.5px_0_rgb(255_255_255/0.25),0_1px_2px_rgb(0_0_0/0.12)] hover:brightness-[1.06] active:brightness-95",
  secondary: "bg-surface text-ink shadow-card hover:bg-surface-2 active:bg-surface-3",
  ghost: "text-ink-2 hover:bg-ink/[0.05] hover:text-ink active:bg-ink/[0.08]",
  danger: "bg-danger text-white hover:brightness-110 active:brightness-95",
  plain: "text-accent hover:underline underline-offset-2 px-0 h-auto",
};
const sizes: Record<Size, string> = {
  sm: "h-7 px-2.5 text-sm gap-1.5 rounded-[7px]",
  md: "h-8 px-3.5 text-sm gap-2 rounded-lg",
  lg: "h-11 px-5 text-base gap-2 rounded-[11px] font-medium",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition-[background,filter,box-shadow,color] duration-150 ease-mac",
        "disabled:pointer-events-none disabled:opacity-45",
        variants[variant],
        variant !== "plain" && sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export const IconButton = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; size?: "sm" | "md" }>(
  function IconButton({ label, active, size = "md", className, children, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        title={label}
        aria-pressed={active}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-[7px] text-ink-2 transition-colors duration-150",
          "hover:bg-ink/[0.06] hover:text-ink active:bg-ink/[0.1] disabled:pointer-events-none disabled:opacity-35",
          size === "sm" ? "size-7" : "size-8",
          active && "bg-accent/[0.12] text-accent hover:bg-accent/[0.16] hover:text-accent",
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    );
  },
);
