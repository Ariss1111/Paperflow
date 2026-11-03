"use client";
import * as React from "react";
import { renderMarkdown } from "@/lib/client/markdown";
import { cn } from "@/lib/utils";

// "(p. 3)", "pp. 4–5", "page 7", "pagina 2": the AI's page citations, turned into buttons that jump the viewer.
const CITE = /\b(pp?\.|pages?|pag\.|pagina|paginile|seite|seiten|página|páginas|pagina)\s?(\d{1,4})((?:\s?[–-]\s?\d{1,4})?)/gi;

/** Adds page buttons to rendered HTML, only in text (never inside tags or links). */
function linkPages(html: string, pages: number): string {
  return html.replace(/(<a\b[\s\S]*?<\/a>)|(<[^>]+>)|([^<]+)/g, (m, link, tag, text) => {
    if (link || tag || !text) return m;
    return text.replace(CITE, (whole: string, _w: string, n: string) => {
      const page = Number(n);
      return page >= 1 && page <= pages ? `<button type="button" class="page-ref" data-page="${page}">${whole}</button>` : whole;
    });
  });
}

export function Answer({ text, streaming, pages, onPage, className }: { text: string; streaming?: boolean; pages?: number; onPage?: (page: number) => void; className?: string }) {
  const html = React.useMemo(() => {
    const h = renderMarkdown(text);
    return onPage && pages ? linkPages(h, pages) : h;
  }, [text, pages, onPage]);
  return (
    <div
      onClick={(e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>("[data-page]");
        if (b && onPage) onPage(Number(b.dataset.page));
      }}
      className={cn(
        "prose-pagelyt min-w-0 text-[15px] leading-7 text-ink",
        "[&_.page-ref]:rounded [&_.page-ref]:bg-accent/10 [&_.page-ref]:px-1 [&_.page-ref]:font-medium [&_.page-ref]:text-accent hover:[&_.page-ref]:bg-accent/20",
        streaming && "after:ml-0.5 after:inline-block after:h-4 after:w-1.5 after:translate-y-0.5 after:animate-pulse after:rounded-sm after:bg-accent after:content-['']",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
