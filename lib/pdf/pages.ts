// Page-range parsing shared by the UI (validation) and the server (processing).

export class RangeError_ extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RangeError";
  }
}

export interface PageRange {
  /** 1-based, inclusive */
  start: number;
  end: number;
}

/**
 * Parses "1-3, 5, 8-10" into ranges. Supports open ranges ("7-" = 7..last) and "last"/"end".
 * Throws a RangeError_ with a user-facing message on invalid input.
 */
export function parseRanges(spec: string, total: number): PageRange[] {
  const parts = spec
    .split(/[,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length === 0) throw new RangeError_("Enter at least one page or range.");
  const toNum = (s: string): number => {
    if (s === "last" || s === "end") return total;
    if (!/^\d+$/.test(s)) throw new RangeError_(`“${s}” isn't a page number.`);
    return Number.parseInt(s, 10);
  };
  return parts.map((part) => {
    const m = part.split(/\s*[-–]\s*/);
    if (m.length > 2) throw new RangeError_(`“${part}” isn't a valid range.`);
    const start = toNum(m[0] || "1");
    const end = m.length === 2 ? (m[1] === "" ? total : toNum(m[1])) : start;
    if (start < 1 || end < 1) throw new RangeError_("Page numbers start at 1.");
    if (start > total || end > total) throw new RangeError_(`This document has ${total} page${total === 1 ? "" : "s"}; “${part}” is out of range.`);
    if (start > end) throw new RangeError_(`“${part}” runs backwards. Write it as ${end}-${start}.`);
    return { start, end };
  });
}

/** Zero-based page indices selected by a spec, in the order written, without duplicates. Empty spec = all pages. */
export function pageIndices(spec: string | undefined | null, total: number): number[] {
  if (!spec || !spec.trim()) return Array.from({ length: total }, (_, i) => i);
  const seen = new Set<number>();
  const out: number[] = [];
  for (const r of parseRanges(spec, total)) {
    for (let p = r.start; p <= r.end; p++) {
      if (!seen.has(p - 1)) {
        seen.add(p - 1);
        out.push(p - 1);
      }
    }
  }
  return out;
}

export function describeRange(r: PageRange): string {
  return r.start === r.end ? `${r.start}` : `${r.start}-${r.end}`;
}
