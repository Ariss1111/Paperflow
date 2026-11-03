import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/brand";

// Same geometry as public/brand/* (scripts/make-brand.mjs): a P whose bowl is a page with a folded corner.
export const P_SHAPE =
  "M10.6 6.5H19.3L24.5 11.7V14.6A5.9 5.9 0 0 1 18.6 20.5H14.3V24.1A1.9 1.9 0 0 1 12.4 26H10.6A1.9 1.9 0 0 1 8.7 24.1V8.4A1.9 1.9 0 0 1 10.6 6.5Z" +
  "M14.3 10.6V16.4H18.2A2.1 2.1 0 0 0 20.3 14.3V12.7A2.1 2.1 0 0 0 18.2 10.6Z";
export const FOLD = "M19.3 6.5V10.2A1.5 1.5 0 0 0 20.8 11.7H24.5Z";

/** The app icon: white mark on the blue tile. */
export function AppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-8 shrink-0 drop-shadow-[0_1px_1.5px_rgb(31_95_217/0.35)]", className)}>
      <defs>
        <linearGradient id="pg-tile" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4F8BFF" />
          <stop offset="1" stopColor="#1F5FD9" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="7.2" fill="url(#pg-tile)" />
      <path fill="#fff" fillRule="evenodd" d={P_SHAPE} />
      <path fill="#BCD3FF" d={FOLD} />
    </svg>
  );
}

/** The bare mark in the accent colour (follows light/dark through the accent token). */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-8 shrink-0", className)}>
      <path className="fill-accent" fillRule="evenodd" d={P_SHAPE} />
      <path className="fill-accent/40" d={FOLD} />
    </svg>
  );
}

/** Horizontal logo: app icon + wordmark. */
export function Logo({ className, iconClassName }: { className?: string; iconClassName?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <AppIcon className={cn("size-7", iconClassName)} />
      <span className="text-[17px] font-semibold tracking-[-0.02em] text-ink">{APP_NAME}</span>
    </span>
  );
}
