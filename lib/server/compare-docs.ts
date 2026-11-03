import "server-only";
import { openDoc, structuredPage } from "@/lib/pdf/mu";
import { UserError, throwIfAborted } from "./errors";

// Paragraph-level comparison of two PDFs, done locally and exactly (no AI): what was added, removed
// or reworded, which dates and numbers changed, and where the formatting of the same text changed.

export interface Paragraph {
  text: string;
  page: number;
  size: number;
  bold: boolean;
  italic: boolean;
}

export type Seg = { op: "same" | "add" | "del"; text: string };
export type Pair = { from: string; to: string };

export interface CompareItem {
  kind: "same" | "added" | "removed" | "changed" | "format";
  a?: { text: string; page: number };
  b?: { text: string; page: number };
  /** changed: word-by-word difference */
  words?: Seg[];
  dates?: Pair[];
  numbers?: Pair[];
  /** format: what changed about the same text */
  format?: string[];
}

export interface CompareResult {
  a: { name: string; pages: number };
  b: { name: string; pages: number };
  summary: { added: number; removed: number; changed: number; formatting: number; dates: number; numbers: number; unchanged: number };
  items: CompareItem[];
}

const MAX_PARAGRAPHS = 6000;

/** Reads a PDF's paragraphs (mupdf text blocks) with their dominant formatting. */
export function paragraphs(bytes: Uint8Array, signal?: AbortSignal): { pages: number; paras: Paragraph[] } {
  const doc = openDoc(bytes);
  const pages = doc.countPages();
  const paras: Paragraph[] = [];
  for (let i = 0; i < pages; i++) {
    throwIfAborted(signal);
    for (const b of structuredPage(doc, i).blocks) {
      let text = "";
      let weight = 0;
      let size = 0;
      let bold = 0;
      let italic = 0;
      for (const l of b.lines) {
        const t = l.text.replace(/\s+/g, " ").trim();
        if (!t) continue;
        // re-join words hyphenated across lines
        text = !text ? t : /[a-zà-ž]-$/i.test(text) && /^[a-zà-ž]/.test(t) ? text.slice(0, -1) + t : `${text} ${t}`;
        weight += t.length;
        size += l.size * t.length;
        if (l.bold) bold += t.length;
        if (l.italic) italic += t.length;
      }
      if (!text) continue;
      paras.push({ text, page: i + 1, size: Math.round((size / weight) * 10) / 10, bold: bold > weight / 2, italic: italic > weight / 2 });
      if (paras.length > MAX_PARAGRAPHS) throw new UserError(`These documents are too long to compare here (over ${MAX_PARAGRAPHS} paragraphs). Compare a few pages at a time.`, "too_long", 413);
    }
  }
  return { pages, paras };
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

type Op<T> = { kind: "same"; a: T; b: T } | { kind: "del"; a: T } | { kind: "add"; b: T };

/** Longest-common-subsequence alignment; for huge inputs, anchors on lines that are unique on both sides. */
function align<T>(a: T[], b: T[], key: (x: T) => string): Op<T>[] {
  const ka = a.map(key);
  const kb = b.map(key);
  if (a.length * b.length > 9_000_000) {
    const inB = new Map<string, number[]>();
    kb.forEach((k, j) => inB.set(k, [...(inB.get(k) ?? []), j]));
    const ops: Op<T>[] = [];
    let j = 0;
    for (let i = 0; i < a.length; i++) {
      const next = (inB.get(ka[i]) ?? []).find((x) => x >= j);
      if (next === undefined) {
        ops.push({ kind: "del", a: a[i] });
        continue;
      }
      while (j < next) ops.push({ kind: "add", b: b[j++] });
      ops.push({ kind: "same", a: a[i], b: b[j++] });
    }
    while (j < b.length) ops.push({ kind: "add", b: b[j++] });
    return ops;
  }
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = ka[i] === kb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops: Op<T>[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (ka[i] === kb[j]) ops.push({ kind: "same", a: a[i++], b: b[j++] });
    else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push({ kind: "del", a: a[i++] });
    else ops.push({ kind: "add", b: b[j++] });
  }
  while (i < n) ops.push({ kind: "del", a: a[i++] });
  while (j < m) ops.push({ kind: "add", b: b[j++] });
  return ops;
}

const words = (s: string) => s.split(/\s+/).filter(Boolean);

/** How alike two paragraphs are, 0..1 (shared words). */
function similarity(a: string, b: string) {
  const wa = words(a.toLowerCase());
  const wb = words(b.toLowerCase());
  if (!wa.length || !wb.length) return 0;
  const count = new Map<string, number>();
  for (const w of wa) count.set(w, (count.get(w) ?? 0) + 1);
  let shared = 0;
  for (const w of wb) {
    const c = count.get(w) ?? 0;
    if (c > 0) {
      shared++;
      count.set(w, c - 1);
    }
  }
  return (2 * shared) / (wa.length + wb.length);
}

export function wordDiff(a: string, b: string): Seg[] {
  const wa = words(a);
  const wb = words(b);
  if (wa.length * wb.length > 250_000) return [{ op: "del", text: a }, { op: "add", text: b }];
  const segs: Seg[] = [];
  for (const o of align(wa, wb, (w) => w)) {
    const op = o.kind === "same" ? "same" : o.kind === "del" ? "del" : "add";
    const text = o.kind === "add" ? o.b : o.a;
    const last = segs[segs.length - 1];
    if (last?.op === op) last.text += ` ${text}`;
    else segs.push({ op, text });
  }
  return segs;
}

const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|ianuarie|februarie|martie|aprilie|mai|iunie|iulie|septembrie|octombrie|noiembrie|decembrie";
const DATE = new RegExp(
  [`\\b\\d{4}-\\d{1,2}-\\d{1,2}\\b`, `\\b\\d{1,2}[./-]\\d{1,2}[./-]\\d{2,4}\\b`, `\\b\\d{1,2}\\s+(?:${MONTHS})\\.?,?\\s+\\d{4}\\b`, `\\b(?:${MONTHS})\\.?\\s+\\d{1,2},?\\s+\\d{4}\\b`].join("|"),
  "gi",
);
const NUMBER = /[-+]?(?:[$€£]\s?)?\d+(?:[.,\s]\d{3})*(?:[.,]\d+)?\s?(?:%|lei|ron|eur|usd|€|\$)?/gi;

export const datesIn = (s: string) => s.match(DATE) ?? [];
export function numbersIn(s: string): string[] {
  return (s.replace(DATE, " ").match(NUMBER) ?? []).map((n) => n.trim()).filter((n) => /\d/.test(n));
}

/** Values present on one side but not the other, paired in reading order: [{from, to}]. */
function changedValues(a: string[], b: string[]): Pair[] {
  const left = [...a];
  const right = [...b];
  for (let i = left.length - 1; i >= 0; i--) {
    const j = right.indexOf(left[i]);
    if (j >= 0) {
      left.splice(i, 1);
      right.splice(j, 1);
    }
  }
  const out: Pair[] = [];
  for (let i = 0; i < Math.max(left.length, right.length); i++) out.push({ from: left[i] ?? "—", to: right[i] ?? "—" });
  return out;
}

function formatChanges(a: Paragraph, b: Paragraph): string[] {
  const out: string[] = [];
  if (Math.abs(a.size - b.size) >= 0.5) out.push(`Text size ${a.size} pt → ${b.size} pt`);
  if (a.bold !== b.bold) out.push(b.bold ? "Now bold" : "No longer bold");
  if (a.italic !== b.italic) out.push(b.italic ? "Now italic" : "No longer italic");
  return out;
}

export function compareParagraphs(pa: Paragraph[], pb: Paragraph[]): Pick<CompareResult, "summary" | "items"> {
  const ops = align(pa, pb, (p) => norm(p.text));
  const items: CompareItem[] = [];
  const at = (p: Paragraph) => ({ text: p.text, page: p.page });

  // a run of deletions and additions between unchanged paragraphs: pair up rewordings
  const flush = (dels: Paragraph[], adds: Paragraph[]) => {
    let j = 0;
    for (const d of dels) {
      let best = -1;
      let score = 0.45;
      for (let k = j; k < adds.length; k++) {
        const s = similarity(d.text, adds[k].text);
        if (s > score) {
          score = s;
          best = k;
        }
      }
      if (best < 0) {
        items.push({ kind: "removed", a: at(d) });
        continue;
      }
      while (j < best) items.push({ kind: "added", b: at(adds[j++]) });
      const add = adds[j++];
      items.push({ kind: "changed", a: at(d), b: at(add), words: wordDiff(d.text, add.text), dates: changedValues(datesIn(d.text), datesIn(add.text)), numbers: changedValues(numbersIn(d.text), numbersIn(add.text)) });
    }
    while (j < adds.length) items.push({ kind: "added", b: at(adds[j++]) });
  };

  let dels: Paragraph[] = [];
  let adds: Paragraph[] = [];
  for (const o of ops) {
    if (o.kind === "del") dels.push(o.a);
    else if (o.kind === "add") adds.push(o.b);
    else {
      flush(dels, adds);
      dels = [];
      adds = [];
      const f = formatChanges(o.a, o.b);
      items.push(f.length ? { kind: "format", a: at(o.a), b: at(o.b), format: f } : { kind: "same", a: at(o.a), b: at(o.b) });
    }
  }
  flush(dels, adds);

  const count = (k: CompareItem["kind"]) => items.filter((i) => i.kind === k).length;
  return {
    items,
    summary: {
      added: count("added"),
      removed: count("removed"),
      changed: count("changed"),
      formatting: count("format"),
      unchanged: count("same"),
      dates: items.reduce((n, i) => n + (i.dates?.length ?? 0), 0),
      numbers: items.reduce((n, i) => n + (i.numbers?.length ?? 0), 0),
    },
  };
}

export function compareDocuments(a: Uint8Array, b: Uint8Array, nameA: string, nameB: string, signal?: AbortSignal): CompareResult {
  const A = paragraphs(a, signal);
  const B = paragraphs(b, signal);
  for (const [d, name] of [[A, nameA], [B, nameB]] as const) {
    if (!d.paras.length) throw new UserError(`“${name}” has no text to compare. If it's a scan, run OCR PDF on it first.`, "no_text", 422);
  }
  return { a: { name: nameA, pages: A.pages }, b: { name: nameB, pages: B.pages }, ...compareParagraphs(A.paras, B.paras) };
}

/** A compact plain-text list of the differences, for the AI to explain (never the whole documents). */
export function changesAsText(r: CompareResult, limit = 150_000): string {
  const out: string[] = [`Original: ${r.a.name} (${r.a.pages} pages). Revised: ${r.b.name} (${r.b.pages} pages).`];
  for (const i of r.items) {
    let line = "";
    if (i.kind === "added") line = `ADDED (revised p. ${i.b!.page}): ${i.b!.text}`;
    else if (i.kind === "removed") line = `REMOVED (original p. ${i.a!.page}): ${i.a!.text}`;
    else if (i.kind === "changed") line = `CHANGED (original p. ${i.a!.page} → revised p. ${i.b!.page}):\n  before: ${i.a!.text}\n  after:  ${i.b!.text}`;
    else if (i.kind === "format") line = `FORMATTING (revised p. ${i.b!.page}): ${i.format!.join("; ")} — “${i.b!.text.slice(0, 120)}”`;
    else continue;
    out.push(line);
    if (out.join("\n").length > limit) {
      out.push("[…more changes not shown]");
      break;
    }
  }
  if (out.length === 1) out.push("No differences in the text.");
  return out.join("\n\n");
}
