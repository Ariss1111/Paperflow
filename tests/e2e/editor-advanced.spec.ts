import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { upload, pdf, texts, firstLines, fx } from "./helpers";

async function openEditor(page: Page, files: string | string[] = "text-3pages.pdf") {
  await page.goto("/editor");
  await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("pf-editor")).forEach((k) => localStorage.removeItem(k)));
  await page.locator('input[type="file"]').first().setInputFiles(Array.isArray(files) ? files : fx(files));
  const first = page.locator("[data-page-key]").first();
  await expect(first.locator("canvas")).toHaveClass(/opacity-100/);
  return first;
}

async function readDownload(page: Page, click: () => Promise<void>) {
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 120_000 }), click()]);
  return { name: dl.suggestedFilename(), bytes: new Uint8Array(fs.readFileSync((await dl.path())!)) };
}

const downloadPdf = (page: Page) => readDownload(page, () => page.getByRole("button", { name: "Download PDF", exact: true }).first().click());

test("full screen and the keyboard shortcut list", async ({ page }) => {
  await openEditor(page);
  await page.keyboard.press("f");
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.getAttribute("data-testid"))).toBe("editor-root");
  await expect(page.getByTestId("editor-root")).toHaveClass(/h-dvh/);
  await expect(page.getByRole("button", { name: "Exit full screen (F)" })).toBeVisible();
  await page.getByRole("button", { name: "Exit full screen (F)" }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();

  await page.keyboard.press("?");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  await expect(page.getByText("Save to My Documents")).toBeVisible();
});

test("insert a blank page and pages from another PDF, then export", async ({ page }) => {
  await openEditor(page);
  await page.getByRole("button", { name: "Pages", exact: true }).click();
  await page.getByRole("menuitem", { name: "Insert blank page" }).click();
  await expect(page.locator("[data-page-key]")).toHaveCount(4);
  // added after the current page (page 1)
  await expect(page.getByRole("button", { name: /^Go to page 2\./ })).toBeVisible();

  await page.getByTestId("insert-pdf-input").setInputFiles(fx("text-1page.pdf"));
  await expect(page.getByText(/Added 1 page/)).toBeVisible();
  await expect(page.locator("[data-page-key]")).toHaveCount(5);
  // every page renders, including the ones from the other files
  for (let i = 0; i < 5; i++) {
    await page.locator("[data-page-key]").nth(i).scrollIntoViewIfNeeded();
    await expect(page.locator("[data-page-key]").nth(i).locator("canvas")).toHaveClass(/opacity-100/);
  }

  const { bytes } = await downloadPdf(page);
  const other = firstLines(new Uint8Array(fs.readFileSync(fx("text-1page.pdf")[0])))[0];
  const lines = firstLines(bytes);
  expect(lines).toHaveLength(5);
  expect(lines.filter((l) => l.startsWith("MEMO"))).toEqual(["MEMO 1", "MEMO 2", "MEMO 3"]);
  expect(lines[0]).toBe("MEMO 1");
  expect(lines).toContain(other);
  expect(lines.filter((l) => l === "")).toHaveLength(1);
  // the blank page matches the size of the page it follows
  const d = pdf(bytes);
  const blank = lines.indexOf("");
  expect(d.loadPage(blank).getBounds()).toEqual(d.loadPage(0).getBounds());
});

test("extract selected pages and split into ranges", async ({ page }) => {
  await openEditor(page, "text-5pages.pdf");
  await page.getByLabel("Select page 2").check({ force: true });
  await page.getByLabel("Select page 4").check({ force: true });
  await page.getByRole("button", { name: "Extract 2" }).click();
  await expect(page.getByRole("dialog", { name: "Extract pages" })).toBeVisible();
  await expect(page.getByText("Your file is ready")).toBeVisible({ timeout: 120_000 });
  const ex = await readDownload(page, () => page.getByRole("dialog").getByRole("button", { name: "Download PDF", exact: true }).click());
  expect(firstLines(ex.bytes)).toEqual(["PAGE 2", "PAGE 4"]);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Pages", exact: true }).click();
  await page.getByRole("menuitem", { name: /Split document/ }).click();
  await page.getByLabel("Page ranges").fill("1-9");
  await page.getByRole("button", { name: "Split", exact: true }).click();
  await expect(page.getByText(/is out of range/)).toBeVisible();
  await page.getByLabel("Page ranges").fill("1-2, 3-5");
  await page.getByRole("button", { name: "Split", exact: true }).click();
  await expect(page.getByText("2 files ready")).toBeVisible({ timeout: 120_000 });
  const parts = page.getByRole("dialog").getByRole("button", { name: /^Download .*\.pdf$/ });
  await expect(parts).toHaveCount(2);
  const a = await readDownload(page, () => parts.nth(0).click());
  const b = await readDownload(page, () => parts.nth(1).click());
  expect(firstLines(a.bytes)).toEqual(["PAGE 1", "PAGE 2"]);
  expect(firstLines(b.bytes)).toEqual(["PAGE 3", "PAGE 4", "PAGE 5"]);
});

test("watermark and page numbers preview in the editor and export for real", async ({ page }) => {
  await openEditor(page);
  await page.getByRole("button", { name: "Watermark and numbering" }).click();
  await page.getByRole("menuitem", { name: "Add watermark…" }).click();
  await page.locator("#wm-text").fill("DRAFT COPY");
  await page.getByRole("button", { name: "Add watermark" }).click();
  await expect(page.getByTestId("stamp-preview").first()).toContainText("DRAFT COPY");

  await page.getByRole("button", { name: "Watermark and numbering" }).click();
  await page.getByRole("menuitem", { name: "Add page numbers…" }).click();
  await page.getByLabel("Format").fill("Page {n} of {total}");
  await page.getByRole("button", { name: "Add page numbers" }).click();
  await expect(page.getByTestId("stamp-preview").first()).toContainText("Page 1 of 3");

  const { bytes } = await downloadPdf(page);
  const t = texts(bytes);
  expect(t).toHaveLength(3);
  t.forEach((s, i) => {
    expect(s).toContain("DRAFT COPY");
    expect(s).toContain(`Page ${i + 1} of 3`);
  });
});

test("Save writes a new version and keeps editing it", async ({ page }) => {
  const p1 = await openEditor(page);
  const box = (await p1.boundingBox())!;
  await page.getByRole("button", { name: /^Add text/ }).click();
  await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.6);
  await page.keyboard.type("Saved note");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  const before = new URL(page.url()).searchParams.get("files");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByText(/Saved to My Documents as/)).toBeVisible({ timeout: 120_000 });
  // the editor now works on the saved file: the text is part of the page, not an overlay
  await expect.poll(() => new URL(page.url()).searchParams.get("files")).not.toBe(before);
  await expect(page.locator("[data-page-key]").first().locator("canvas")).toHaveClass(/opacity-100/);
  await expect(page.locator("[data-obj]")).toHaveCount(0);
  const { bytes } = await downloadPdf(page);
  expect(texts(bytes)[0]).toContain("Saved note");
});

test("image: insert, move and resize, then export at the new place", async ({ page }) => {
  const p1 = await openEditor(page, "text-1page.pdf");
  await page.locator('input[accept^="image/png"]').setInputFiles(fx("photo.png"));
  const obj = page.locator("[data-obj]");
  await expect(obj).toHaveCount(1);
  const pageBox = (await p1.boundingBox())!;
  // move the image to the top-left corner area
  const b0 = (await obj.boundingBox())!;
  await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2);
  await page.mouse.down();
  await page.mouse.move(pageBox.x + 40 + b0.width / 2, pageBox.y + 40 + b0.height / 2, { steps: 8 });
  await page.mouse.up();
  // resize from the bottom-right handle
  const se = page.locator('[data-handle="se"]');
  const h = (await se.boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + 60, h.y + 60, { steps: 6 });
  await page.mouse.up();
  const b1 = (await obj.boundingBox())!;
  expect(b1.width).toBeGreaterThan(b0.width + 20);

  const { bytes } = await downloadPdf(page);
  const pg = pdf(bytes).loadPage(0);
  const [, , pw] = pg.getBounds();
  let found: number[] | null = null;
  pg.toStructuredText("preserve-images").walk({
    onImageBlock(bbox: number[]) {
      found = bbox;
    },
  });
  expect(found).not.toBeNull();
  const [x0, y0, x1] = found! as number[];
  const scale = pageBox.width / pw;
  // within a couple of points of where it sits on screen
  expect(Math.abs(x0 - (b1.x - pageBox.x) / scale)).toBeLessThan(4);
  expect(Math.abs(y0 - (b1.y - pageBox.y) / scale)).toBeLessThan(4);
  expect(Math.abs(x1 - x0 - b1.width / scale)).toBeLessThan(4);
});

test("large PDF: 150 pages, zoom levels, edit the last page and export", async ({ page }, info) => {
  test.setTimeout(300_000);
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 150; i++) doc.addPage([612, 792]).drawText(`Large page ${i}`, { x: 72, y: 700, size: 24, font });
  const file = path.join(info.outputDir, "large-150.pdf");
  fs.mkdirSync(info.outputDir, { recursive: true });
  fs.writeFileSync(file, await doc.save());

  await openEditor(page, [file]);
  await expect(page.locator("[data-page-key]")).toHaveCount(150);
  await expect(page.getByRole("button", { name: /^Go to page 150\./ })).toHaveCount(1);

  for (const z of ["50", "200", "100"]) {
    await page.getByLabel("Zoom percentage").fill(z);
    await page.getByLabel("Zoom percentage").press("Enter");
    await expect(page.getByLabel("Zoom percentage")).toHaveValue(new RegExp(`^${z}%?$`));
  }

  await page.getByLabel("Page number").fill("150");
  await page.getByLabel("Page number").press("Enter");
  const last = page.locator("[data-page-key]").nth(149);
  await expect(last.locator("canvas")).toHaveClass(/opacity-100/);
  const box = (await last.boundingBox())!;
  await page.getByRole("button", { name: /^Add text/ }).click();
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.5);
  await page.keyboard.type("End of document");
  await page.keyboard.press("Escape");

  const { bytes } = await downloadPdf(page);
  const d = pdf(bytes);
  expect(d.countPages()).toBe(150);
  const lastText = d.loadPage(149).toStructuredText().asText();
  expect(lastText).toContain("Large page 150");
  expect(lastText).toContain("End of document");
});
