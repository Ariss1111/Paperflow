import "server-only";
import sharp from "sharp";
import { openDoc, renderPage, pixmapRaw, pageText } from "@/lib/pdf/mu";
import { throwIfAborted } from "./errors";

type Op = { kind: "same" | "add" | "del"; line: string };

/** Line diff via LCS; falls back to a coarse comparison for very long pages. */
export function diffLines(a: string[], b: string[]): Op[] {
  if (a.length * b.length > 4_000_000) {
    const sb = new Set(b);
    const sa = new Set(a);
    return [...a.filter((l) => !sb.has(l)).map((line) => ({ kind: "del" as const, line })), ...b.filter((l) => !sa.has(l)).map((line) => ({ kind: "add" as const, line }))];
  }
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: "same", line: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push({ kind: "del", line: a[i++] });
    else ops.push({ kind: "add", line: b[j++] });
  }
  while (i < n) ops.push({ kind: "del", line: a[i++] });
  while (j < m) ops.push({ kind: "add", line: b[j++] });
  return ops;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const lines = (t: string) => t.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);

async function visualDiff(aDoc: ReturnType<typeof openDoc>, bDoc: ReturnType<typeof openDoc>, i: number) {
  const ra = pixmapRaw(renderPage(aDoc, i, 60));
  const rb = pixmapRaw(renderPage(bDoc, i, 60));
  const w = ra.width;
  const h = ra.height;
  const toRgb = (r: typeof ra, rw: number, rh: number) =>
    sharp(r.data, { raw: { width: r.width, height: r.height, channels: r.channels } }).resize(rw, rh, { fit: "fill" }).removeAlpha().raw().toBuffer();
  const [pa, pb] = await Promise.all([toRgb(ra, w, h), toRgb(rb, w, h)]);
  const out = Buffer.alloc(w * h * 3);
  let changed = 0;
  for (let p = 0; p < w * h; p++) {
    const k = p * 3;
    const d = Math.abs(pa[k] - pb[k]) + Math.abs(pa[k + 1] - pb[k + 1]) + Math.abs(pa[k + 2] - pb[k + 2]);
    const g = Math.round((pa[k] + pa[k + 1] + pa[k + 2]) / 3);
    if (d > 60) {
      changed++;
      out[k] = 230;
      out[k + 1] = 30;
      out[k + 2] = 40;
    } else {
      // faded original for context
      const v = 200 + Math.round((g / 255) * 55);
      out[k] = out[k + 1] = out[k + 2] = v;
    }
  }
  const png = await sharp(out, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
  return { ratio: changed / (w * h), png };
}

export async function compareReport(a: Uint8Array, b: Uint8Array, nameA: string, nameB: string, signal: AbortSignal, progress: (p: number, m: string) => void) {
  const da = openDoc(a);
  const db = openDoc(b);
  const na = da.countPages();
  const nb = db.countPages();
  const n = Math.max(na, nb);
  const rows: string[] = [];
  let changedPages = 0;
  let added = 0;
  let removed = 0;
  for (let i = 0; i < n; i++) {
    throwIfAborted(signal);
    progress(i / n, `Comparing page ${i + 1} of ${n}…`);
    if (i >= na || i >= nb) {
      changedPages++;
      rows.push(`<section><h2>Page ${i + 1}</h2><p class="badge warn">Only in ${esc(i >= na ? nameB : nameA)}</p></section>`);
      continue;
    }
    const diff = diffLines(lines(pageText(da, i)), lines(pageText(db, i)));
    const adds = diff.filter((d) => d.kind === "add").length;
    const dels = diff.filter((d) => d.kind === "del").length;
    added += adds;
    removed += dels;
    const vis = await visualDiff(da, db, i);
    const textChanged = adds + dels > 0;
    const visChanged = vis.ratio > 0.0005;
    if (!textChanged && !visChanged) {
      rows.push(`<section class="same"><h2>Page ${i + 1}</h2><p class="badge ok">No differences</p></section>`);
      continue;
    }
    changedPages++;
    const body = diff
      .filter((d) => d.kind !== "same")
      .slice(0, 400)
      .map((d) => `<div class="${d.kind}">${d.kind === "add" ? "+" : "−"} ${esc(d.line)}</div>`)
      .join("");
    rows.push(`<section><h2>Page ${i + 1}</h2>
      <p class="badge warn">${textChanged ? `${adds} line(s) added, ${dels} removed` : "Text identical"} · ${(vis.ratio * 100).toFixed(2)}% of pixels differ</p>
      <div class="grid"><div class="diff">${body || "<em>Only visual differences (images, layout or styling).</em>"}</div>
      <figure><img alt="Visual differences on page ${i + 1}" src="data:image/png;base64,${vis.png.toString("base64")}"><figcaption>Red: pixels that differ</figcaption></figure></div></section>`);
  }
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Comparison</title>
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#1d1d1f;--mute:#6e6e73;--line:#e5e5ea;--add:#e3f5e8;--del:#fde8e8}
@media (prefers-color-scheme:dark){:root{--bg:#1c1c1e;--fg:#f5f5f7;--mute:#a1a1a6;--line:#38383a;--add:#16351f;--del:#3d1717}}
body{font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--fg);max-width:1100px;margin:0 auto;padding:32px 16px}
h1{font-size:24px;margin:0 0 4px}h2{font-size:16px;margin:0 0 8px}.mute{color:var(--mute)}
section{border-top:1px solid var(--line);padding:20px 0}.same{opacity:.6}
.badge{display:inline-block;font-size:12px;padding:2px 8px;border-radius:99px;background:var(--line);margin:0 0 12px}
.grid{display:grid;grid-template-columns:1fr 280px;gap:16px}@media(max-width:700px){.grid{grid-template-columns:1fr}}
.diff{font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-word}
.add{background:var(--add)}.del{background:var(--del)}img{width:100%;border:1px solid var(--line);border-radius:6px}figcaption{font-size:12px;color:var(--mute)}
</style></head><body>
<h1>Document comparison</h1>
<p class="mute">${esc(nameA)} (${na} pages) → ${esc(nameB)} (${nb} pages) · ${changedPages} page(s) differ · ${added} line(s) added · ${removed} removed</p>
${rows.join("\n")}
</body></html>`;
  return { html, summary: { pagesCompared: n, pagesChanged: changedPages, linesAdded: added, linesRemoved: removed } };
}
