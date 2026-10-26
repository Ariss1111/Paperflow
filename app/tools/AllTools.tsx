"use client";
import * as React from "react";
import { Search } from "lucide-react";
import { Container, PageHeader } from "@/components/shell/AppShell";
import { ToolCard } from "@/components/tool/ToolCard";
import { CATEGORIES, TOOLS, type ToolCategory } from "@/lib/tools/catalog";
import { Segmented } from "@/components/ui/controls";
import { EmptyState } from "@/components/ui/feedback";

export function AllTools() {
  const [q, setQ] = React.useState("");
  const [cat, setCat] = React.useState<ToolCategory | "all">("all");
  const s = q.trim().toLowerCase();
  const match = TOOLS.filter((t) => (cat === "all" || t.category === cat) && (!s || `${t.name} ${t.tagline} ${t.description}`.toLowerCase().includes(s)));
  return (
    <Container wide>
      <PageHeader title="All tools" subtitle={`${TOOLS.length} tools that run real document processing — nothing is simulated.`} />
      <div className="mb-8 flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative md:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find a tool"
            aria-label="Find a tool"
            className="h-9 w-full rounded-[10px] bg-surface pl-9 pr-3 text-sm text-ink shadow-card placeholder:text-ink-3 focus:outline-none focus:ring-[3px] focus:ring-accent/25"
          />
        </div>
        <div className="scroll-thin -mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
          <Segmented
            label="Category"
            value={cat}
            onChange={setCat}
            className="w-auto min-w-max"
            options={[{ value: "all" as const, label: "All" }, ...CATEGORIES.map((c) => ({ value: c.id, label: c.label }))]}
          />
        </div>
      </div>
      {match.length === 0 ? (
        <EmptyState icon={<Search className="size-5" />} title="No tools found">
          Try a different word, like “merge”, “password” or “image”.
        </EmptyState>
      ) : (
        <div className="space-y-10">
          {CATEGORIES.filter((c) => match.some((t) => t.category === c.id)).map((c) => (
            <section key={c.id} aria-labelledby={`cat-${c.id}`}>
              <div className="mb-3 flex items-baseline gap-3">
                <h2 id={`cat-${c.id}`} className="text-lg font-semibold text-ink">
                  {c.label}
                </h2>
                <p className="text-sm text-ink-3">{c.blurb}</p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {match
                  .filter((t) => t.category === c.id)
                  .map((t) => (
                    <ToolCard key={t.id} tool={t} />
                  ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </Container>
  );
}
