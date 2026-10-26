"use client";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { toolHref, type ToolDef } from "@/lib/tools/catalog";
import { ToolGlyph } from "@/components/ToolIcon";
import { Badge } from "@/components/ui/feedback";
import { useCapabilities } from "@/lib/client/capabilities";

export function ToolCard({ tool, query, compact }: { tool: ToolDef; query?: string; compact?: boolean }) {
  const caps = useCapabilities();
  const unavailable = tool.requires === "libreoffice" && caps && !caps.libreoffice.available;
  const href = toolHref(tool) + (query ?? "");
  if (compact) {
    return (
      <Link
        href={href}
        className="group flex items-center gap-3 rounded-xl px-2.5 py-2 transition-colors duration-150 hover:bg-ink/[0.04] focus-visible:bg-ink/[0.04]"
      >
        <ToolGlyph icon={tool.icon} category={tool.category} size="sm" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{tool.name}</span>
        <ChevronRight className="size-3.5 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
      </Link>
    );
  }
  return (
    <Link
      href={href}
      className={cn(
        "group relative flex h-full flex-col gap-3 rounded-[16px] bg-surface p-4 shadow-card transition-all duration-200 ease-mac",
        "hover:-translate-y-px hover:shadow-raised focus-visible:shadow-raised",
        unavailable && "opacity-60",
      )}
    >
      <div className="flex items-start justify-between">
        <ToolGlyph icon={tool.icon} category={tool.category} />
        {unavailable && <Badge tone="warning">Needs setup</Badge>}
      </div>
      <div>
        <p className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{tool.name}</p>
        <p className="mt-0.5 text-sm leading-5 text-ink-2">{tool.tagline}</p>
      </div>
    </Link>
  );
}
