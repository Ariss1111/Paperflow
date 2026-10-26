import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { convert, sanitizeHtml } from "@/lib/conversion/registry";
import { CONVERSIONS, findConversion } from "@/lib/conversion/catalog";
import { sofficePath } from "@/lib/server/libreoffice";
import type { FormatId } from "@/lib/formats";
import { fixturePath, reopen, pageTexts, unzip, isPdf } from "../helpers/util";

const hasLO = !!sofficePath();
let work: string;
beforeAll(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "pf-conv-"));
});

const ctx = (options: Record<string, unknown> = {}) => ({
  workDir: path.join(work, String(Math.random()).slice(2)),
  signal: new AbortController().signal,
  options,
  progress: () => undefined,
});

const run = (file: string, format: FormatId, to: FormatId, options = {}) => convert({ path: fixturePath(file), name: file, format }, to, ctx(options));

describe("conversion registry", () => {
  it("every catalog entry has a unique source/target pair", () => {
    const pairs = CONVERSIONS.flatMap((c) => c.from.map((f) => `${f}->${c.to}`));
    expect(new Set(pairs).size).toBe(pairs.length);
  });
  it("rejects unsupported pairs", async () => {
    await expect(run("data.csv", "csv", "docx")).rejects.toThrow(/isn't supported/);
    expect(findConversion("docx", "xlsx")).toBeUndefined();
  });
});

describe.runIf(hasLO)("Office → PDF (LibreOffice)", () => {
  const cases: [string, FormatId, string][] = [
    ["report.docx", "docx", "Quarterly Report"],
    ["report.doc", "doc", "Quarterly Report"],
    ["report.odt", "odt", "Quarterly Report"],
    ["letter.rtf", "rtf", "Hello from"],
    ["deck.pptx", "pptx", "Slide 1"],
    ["deck.ppt", "ppt", "Slide 1"],
    ["deck.odp", "odp", "Slide 1"],
    ["sales.xlsx", "xlsx", "Item 20"],
    ["sales.xls", "xls", "Item 20"],
    ["sales.ods", "ods", "Item 20"],
    ["data.csv", "csv", "Bogdan"],
    ["plain.txt", "txt", "Plain text fixture"],
    ["notes.md", "md", "Meeting notes"],
    ["page.html", "html", "HTML fixture"],
  ];
  it.each(cases)("%s → valid PDF containing its text", async (file, format, needle) => {
    const [out] = await run(file, format, "pdf");
    expect(out.name).toMatch(/\.pdf$/);
    expect(isPdf(out.data)).toBe(true);
    expect(pageTexts(out.data).join("\n")).toContain(needle);
  });
  it("keeps one page per slide", async () => {
    const [out] = await run("deck.pptx", "pptx", "pdf");
    expect(reopen(out.data).countPages()).toBe(3);
  });
  it("preserves Romanian diacritics from DOCX", async () => {
    const [out] = await run("report.docx", "docx", "pdf");
    expect(pageTexts(out.data).join()).toContain("ăâîșț");
  });
  it("fails clearly on a corrupted DOCX", async () => {
    await expect(run("corrupt.docx", "docx", "pdf")).rejects.toThrow(/couldn't/);
  });
  it("PDF → Word exact layout via LibreOffice produces a DOCX", async () => {
    const [out] = await run("text-3pages.pdf", "pdf", "docx", { docxMode: "layout" });
    const files = unzip(out.data);
    expect(files.has("word/document.xml")).toBe(true);
    expect(files.get("word/document.xml")!.toString()).toContain("MEMO");
  });
});

describe("PDF → images / text / html / svg / docx", () => {
  it.each(["jpg", "png", "webp", "tiff"] as const)("PDF → %s renders each selected page", async (to) => {
    const outs = await run("text-5pages.pdf", "pdf", to, { dpi: 72, pages: "1-2" });
    expect(outs.map((o) => o.name)).toEqual([`text-5pages-page-1.${to === "jpg" ? "jpg" : to}`, `text-5pages-page-2.${to === "jpg" ? "jpg" : to}`]);
    const meta = await sharp(outs[0].data).metadata();
    expect(meta.format).toBe(to === "jpg" ? "jpeg" : to);
    expect(meta.width).toBe(595);
    // the rotated page renders rotated (landscape at 72 dpi)
    const m2 = await sharp(outs[1].data).metadata();
    expect(m2.width).toBe(842);
  });
  it("PDF → SVG", async () => {
    const [svg] = await run("text-1page.pdf", "pdf", "svg");
    expect(Buffer.from(svg.data).toString()).toMatch(/^<svg/);
  });
  it("PDF → TXT and refuses scans with an OCR hint", async () => {
    const [txt] = await run("text-3pages.pdf", "pdf", "txt");
    expect(Buffer.from(txt.data).toString()).toContain("MEMO 2");
    await expect(run("scanned.pdf", "pdf", "txt")).rejects.toThrow(/OCR/);
  });
  it("PDF → HTML", async () => {
    const [html] = await run("text-3pages.pdf", "pdf", "html");
    const s = Buffer.from(html.data).toString();
    expect(s).toContain("<html");
    expect(s).toContain("MEMO");
  });
  it("PDF → DOCX (editable text) builds paragraphs", async () => {
    const [docx] = await run("text-5pages.pdf", "pdf", "docx");
    const xml = unzip(docx.data).get("word/document.xml")!.toString();
    expect(xml).toContain("PAGE 1");
    expect(xml).toContain("PAGE 5");
    expect(xml).toContain("w:br"); // page breaks
  });
});

describe("images", () => {
  it.each([
    ["photo.jpg", "jpg"],
    ["alpha.png", "png"],
    ["photo.webp", "webp"],
    ["photo.tiff", "tiff"],
  ] as const)("%s → PDF", async (file, format) => {
    const [out] = await run(file, format, "pdf");
    const d = reopen(out.data);
    expect(d.countPages()).toBe(1);
  });
  it.each([
    ["photo.png", "png", "jpg", "jpeg"],
    ["photo.jpg", "jpg", "png", "png"],
    ["photo.jpg", "jpg", "webp", "webp"],
    ["photo.webp", "webp", "tiff", "tiff"],
  ] as const)("%s → %s", async (file, from, to, expected) => {
    const [out] = await run(file, from, to);
    expect((await sharp(out.data).metadata()).format).toBe(expected);
  });
});

describe("HTML sanitising", () => {
  it("strips scripts, handlers and remote resources", () => {
    const s = sanitizeHtml('<p onclick="x()">a</p><script>alert(1)</script><img src="https://evil.test/x.png"><link rel=stylesheet href="http://x"><div style="background:url(https://x/y)">');
    expect(s).not.toMatch(/script|onclick|evil\.test|<link|https:\/\/x/);
  });
});
