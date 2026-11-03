"use client";
import Link from "next/link";
import { Check } from "lucide-react";
import { PLANS } from "@/lib/pricing";
import { useCapabilities } from "@/lib/client/capabilities";
import { formatBytes, cn } from "@/lib/utils";

export function PricingPlans() {
  const caps = useCapabilities();
  return (
    <div className={cn("mx-auto grid gap-4", PLANS.length === 1 ? "max-w-md" : PLANS.length === 2 ? "max-w-3xl sm:grid-cols-2" : "lg:grid-cols-3")}>
      {PLANS.map((p) => (
        <div key={p.id} className={cn("flex flex-col rounded-[20px] bg-surface p-6 shadow-card", p.highlighted && "ring-2 ring-accent")}>
          <p className="text-sm font-semibold text-accent">{p.name}</p>
          <p className="mt-2 flex items-baseline gap-1">
            <span className="text-4xl font-semibold tracking-[-0.03em] text-ink">{p.price}</span>
            {p.period && <span className="text-sm text-ink-3">{p.period}</span>}
          </p>
          <p className="mt-2 text-sm text-ink-2">{p.blurb}</p>
          <ul className="mt-5 flex-1 space-y-2.5 text-sm text-ink">
            {p.features.map((f) => (
              <li key={f} className="flex gap-2.5">
                <Check className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                {f}
              </li>
            ))}
            {caps && (
              <li className="flex gap-2.5 text-ink-2">
                <Check className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                Up to {formatBytes(caps.limits.maxUploadBytes, 0)} per file
              </li>
            )}
          </ul>
          <Link href={p.cta.href} className={cn("mt-6 inline-flex h-11 items-center justify-center rounded-[11px] text-[15px] font-medium transition-[filter,background]", p.highlighted ? "bg-accent text-white hover:brightness-110" : "bg-surface-2 text-ink hover:bg-surface-3")}>
            {p.cta.label}
          </Link>
        </div>
      ))}
    </div>
  );
}
