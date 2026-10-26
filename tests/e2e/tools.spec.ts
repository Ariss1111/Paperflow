import { test, expect, type Page } from "@playwright/test";
import { upload, runAndWait, downloadFirst, pdf, texts, firstLines } from "./helpers";

// Every generic tool: upload a real file through the UI, run it with the real backend,
// download the result and verify the *file*, not just the success message.
interface Case {
  tool: string;
  files: string[];
  action: string | RegExp;
  setup?: (page: Page) => Promise<void>;
  zip?: boolean;
  verify: (bytes: Uint8Array, page: Page) => Promise<void> | void;
}

const pdfMagic = (b: Uint8Array) => expect(Buffer.from(b.subarray(0, 5)).toString()).toBe("%PDF-");
const zipMagic = (b: Uint8Array) => expect(Buffer.from(b.subarray(0, 2)).toString()).toBe("PK");

const CASES: Case[] = [
  { tool: "merge", files: ["text-3pages.pdf", "text-1page.pdf"], action: "Merge PDFs", verify: (b) => expect(firstLines(b)).toEqual(["MEMO 1", "MEMO 2", "MEMO 3", "PAGE 1"]) },
  {
    tool: "split",
    files: ["text-5pages.pdf"],
    action: "Split PDF",
    zip: true,
    setup: async (p) => p.getByLabel("Page ranges").fill("1-2, 4"),
    verify: (b) => zipMagic(b),
  },
  { tool: "rotate", files: ["text-3pages.pdf"], action: "Rotate PDF", verify: (b) => expect(pdf(b).loadPage(0).getObject().get("Rotate").valueOf()).toBe(90) },
  { tool: "delete-pages", files: ["text-3pages.pdf"], action: "Delete pages", setup: async (p) => p.getByLabel("Pages to delete").fill("2"), verify: (b) => expect(firstLines(b)).toEqual(["MEMO 1", "MEMO 3"]) },
  { tool: "extract-pages", files: ["text-5pages.pdf"], action: "Extract pages", setup: async (p) => p.getByLabel("Pages to keep").fill("5, 1"), verify: (b) => expect(firstLines(b)).toEqual(["PAGE 5", "PAGE 1"]) },
  { tool: "remove-blank", files: ["with-blank.pdf"], action: "Remove blank pages", verify: (b) => expect(pdf(b).countPages()).toBe(3) },
  {
    tool: "compress",
    files: ["image-heavy.pdf"],
    action: "Compress PDF",
    verify: async (b, page) => {
      pdfMagic(b);
      await expect(page.getByText("Saved")).toBeVisible();
      await expect(page.getByText(/^−\d/)).toBeVisible();
    },
  },
  { tool: "repair", files: ["damaged-xref.pdf"], action: "Repair PDF", verify: async (b, page) => { expect(pdf(b).countPages()).toBe(3); await expect(page.getByText(/rebuilt/)).toBeVisible(); } },
  { tool: "word-to-pdf", files: ["report.docx"], action: "Convert to PDF", verify: (b) => expect(texts(b).join()).toContain("Quarterly Report") },
  { tool: "powerpoint-to-pdf", files: ["deck.pptx"], action: "Convert to PDF", verify: (b) => expect(pdf(b).countPages()).toBe(3) },
  { tool: "excel-to-pdf", files: ["sales.xlsx"], action: "Convert to PDF", verify: (b) => expect(texts(b).join()).toContain("Item 20") },
  { tool: "html-to-pdf", files: ["notes.md"], action: "Convert to PDF", verify: (b) => expect(texts(b).join()).toContain("Meeting notes") },
  { tool: "pdf-to-word", files: ["text-3pages.pdf"], action: "Convert to Word", verify: (b) => zipMagic(b) },
  { tool: "pdf-to-image", files: ["text-3pages.pdf"], action: "Convert to images", zip: true, verify: (b) => zipMagic(b) },
  { tool: "images-to-pdf", files: ["photo.jpg", "alpha.png"], action: "Create PDF", verify: (b) => expect(pdf(b).countPages()).toBe(2) },
  { tool: "watermark", files: ["text-1page.pdf"], action: "Add watermark", verify: (b) => expect(texts(b)[0]).toContain("CONFIDENTIAL") },
  { tool: "page-numbers", files: ["text-3pages.pdf"], action: "Add page numbers", verify: (b) => expect(texts(b)[2]).toMatch(/\b3\b/) },
  { tool: "header-footer", files: ["text-3pages.pdf"], action: "Apply", setup: async (p) => p.getByLabel("Header").fill("Draft {n}/{total}"), verify: (b) => expect(texts(b)[1]).toContain("Draft 2/3") },
  { tool: "crop", files: ["text-1page.pdf"], action: "Crop PDF", verify: (b) => expect(Math.round(pdf(b).loadPage(0).getBounds()[2])).toBeLessThan(595) },
  { tool: "resize", files: ["text-1page.pdf"], action: "Resize pages", verify: (b) => { const [x0, , x1] = pdf(b).loadPage(0).getBounds(); expect(Math.round(x1 - x0)).toBe(595); } },
  { tool: "flatten", files: ["form.pdf"], action: "Flatten PDF", verify: (b) => expect(pdf(b).loadPage(0).getWidgets().length).toBe(0) },
  { tool: "bookmarks", files: ["text-3pages.pdf"], action: "Save bookmarks", setup: async (p) => p.getByLabel("Outline").fill("Start | 1\nEnd | 3"), verify: (b) => expect(pdf(b).loadOutline()?.map((o) => o.title)).toEqual(["Start", "End"]) },
  {
    tool: "protect",
    files: ["text-1page.pdf"],
    action: "Protect PDF",
    setup: async (p) => {
      await p.getByLabel("Password", { exact: true }).fill("s3cret!");
      await p.getByLabel("Confirm password").fill("s3cret!");
    },
    verify: (b) => {
      const d = pdf(b);
      expect(d.needsPassword()).toBe(true);
      expect(d.authenticatePassword("s3cret!")).toBeGreaterThan(0);
    },
  },
  { tool: "unlock", files: ["encrypted.pdf"], action: "Unlock PDF", setup: async (p) => p.getByLabel("Current password").fill("secret"), verify: (b) => expect(pdf(b).needsPassword()).toBe(false) },
  { tool: "metadata", files: ["text-5pages.pdf"], action: "Apply", verify: async (b, page) => { expect(JSON.parse(Buffer.from(b).toString()).title).toBe("Five Page Report"); await expect(page.getByText("Five Page Report")).toBeVisible(); } },
  { tool: "ocr", files: ["scanned.pdf"], action: "Run OCR", verify: (b) => expect(texts(b)[0]).toMatch(/INVOICE/) },
  { tool: "extract-text", files: ["text-3pages.pdf"], action: "Extract text", verify: (b) => expect(Buffer.from(b).toString()).toContain("MEMO 2") },
  { tool: "extract-images", files: ["image-heavy.pdf"], action: "Extract images", verify: (b) => expect([0xff, 0x89]).toContain(b[0]) },
  { tool: "compare", files: ["text-3pages.pdf", "text-3pages-changed.pdf"], action: "Compare", verify: (b) => expect(Buffer.from(b).toString()).toContain("An added sentence on page two.") },
];

for (const c of CASES) {
  test(`${c.tool}: produces a valid downloadable result`, async ({ page }) => {
    await page.goto(`/tools/${c.tool}`);
    await upload(page, ...c.files);
    await expect(page.getByRole("button", { name: c.action })).toBeEnabled();
    await c.setup?.(page);
    await runAndWait(page, c.action);
    const { bytes } = await downloadFirst(page, c.zip ? /Download all/ : /^Download [A-Z]{2,5}$/);
    expect(bytes.length).toBeGreaterThan(0);
    await c.verify(bytes, page);
  });
}

test("convert workspace: DOCX → PDF and PDF → PNG", async ({ page }) => {
  await page.goto("/convert");
  await upload(page, "report.odt");
  await page.getByRole("radio", { name: /PDF/ }).click();
  await runAndWait(page, "Start conversion");
  const { bytes } = await downloadFirst(page, /^Download PDF$/);
  expect(texts(bytes).join()).toContain("Quarterly Report");

  await page.getByRole("button", { name: "Start over" }).click();
  await upload(page, "text-1page.pdf");
  await page.getByRole("radio", { name: /PNG/ }).click();
  await runAndWait(page, "Start conversion");
  const png = await downloadFirst(page, /^Download PNG$/);
  expect(png.bytes[0]).toBe(0x89);
});
