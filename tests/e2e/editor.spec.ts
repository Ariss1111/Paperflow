import { test, expect, type Page } from "@playwright/test";
import { upload, pdf, texts, firstLines } from "./helpers";
import fs from "node:fs";

async function openEditor(page: Page, file = "text-3pages.pdf") {
  await page.goto("/editor");
  await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("pf-editor")).forEach((k) => localStorage.removeItem(k)));
  await upload(page, file);
  const first = page.locator("[data-page-key]").first();
  await expect(first).toBeVisible();
  // wait for the bitmap to render
  await expect(first.locator("canvas")).toHaveClass(/opacity-100/);
  return first;
}

async function exportAndDownload(page: Page, label = /Export/): Promise<Uint8Array> {
  await page.getByRole("button", { name: label }).first().click();
  await expect(page.getByText(/Your file is ready/)).toBeVisible({ timeout: 120_000 });
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /^Download PDF$/ }).click()]);
  return new Uint8Array(fs.readFileSync((await dl.path())!));
}

test("add text, highlight, draw a rectangle, export and verify the PDF", async ({ page }) => {
  const p1 = await openEditor(page);
  const box = (await p1.boundingBox())!;

  // text overlay with diacritics
  await page.getByRole("button", { name: /^Add text/ }).click();
  await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.6);
  await page.keyboard.type("Aprobat: Ștefan");
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.9);

  // highlight across the "MEMO 1" heading (top-left of the page)
  await page.getByRole("button", { name: /^Highlight/ }).click();
  await page.mouse.move(box.x + box.width * 0.08, box.y + box.height * 0.1);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.11, { steps: 5 });
  await page.mouse.up();

  // rectangle
  await page.getByRole("button", { name: /^Rectangle/ }).click();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.7);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.8, { steps: 5 });
  await page.mouse.up();

  await expect(page.locator("[data-obj]")).toHaveCount(3);
  const bytes = await exportAndDownload(page);
  const d = pdf(bytes);
  expect(texts(bytes)[0]).toContain("Aprobat: Ștefan");
  expect(d.loadPage(0).getAnnotations().map((a) => a.getType())).toContain("Highlight");
  expect(d.countPages()).toBe(3);
});

test("replace existing text removes the original from the exported PDF", async ({ page }) => {
  const p1 = await openEditor(page);
  await page.getByRole("button", { name: /^Edit text/ }).click();
  const box = (await p1.boundingBox())!;
  // hover the heading so the text run is detected, then click it
  const heading = { x: box.x + box.width * 0.13, y: box.y + box.height * 0.085 };
  await page.mouse.move(heading.x, heading.y);
  await page.mouse.click(heading.x, heading.y);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("NOTE 1");
  await page.keyboard.press("Escape");
  const bytes = await exportAndDownload(page);
  const t = texts(bytes)[0];
  expect(t).toContain("NOTE 1");
  expect(t).not.toContain("MEMO 1");
});

test("undo/redo and page operations, then autosave restores after reload", async ({ page }) => {
  const p1 = await openEditor(page);
  const box = (await p1.boundingBox())!;
  await page.getByRole("button", { name: /^Rectangle/ }).click();
  await page.mouse.move(box.x + 100, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 260, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator("[data-obj]")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator("[data-obj]")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(page.locator("[data-obj]")).toHaveCount(1);

  // rotate page 2 and delete page 3 from the thumbnail rail
  await page.getByRole("button", { name: "Rotate page 2" }).click({ force: true });
  await page.getByRole("button", { name: "Delete page 3" }).click({ force: true });
  await expect(page.locator("[data-page-key]")).toHaveCount(2);

  // autosave → reload (the file id is kept in the URL) → restored
  await expect(page).toHaveURL(/files=/);
  await page.waitForTimeout(700);
  await page.reload();
  await expect(page.getByText("Restored your unsaved edits")).toBeVisible();
  await expect(page.locator("[data-page-key]")).toHaveCount(2);
  await expect(page.locator("[data-obj]")).toHaveCount(1);

  const bytes = await exportAndDownload(page);
  expect(firstLines(bytes)).toEqual(["MEMO 1", "MEMO 2"]);
  expect(pdf(bytes).loadPage(1).getObject().get("Rotate").valueOf()).toBe(90);
});

test("sign: draw a signature, place it, export a PDF containing the image", async ({ page }) => {
  await page.goto("/tools/sign");
  await upload(page, "text-1page.pdf");
  await expect(page.locator("[data-page-key]").first().locator("canvas")).toHaveClass(/opacity-100/);
  await page.getByRole("button", { name: "Signature", exact: true }).click();
  const pad = page.getByLabel(/Signature pad/);
  const b = (await pad.boundingBox())!;
  await page.mouse.move(b.x + 40, b.y + 120);
  await page.mouse.down();
  for (let i = 0; i < 12; i++) await page.mouse.move(b.x + 40 + i * 25, b.y + 120 - Math.sin(i) * 30, { steps: 2 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Use signature" }).click();
  await expect(page.locator("[data-obj]")).toHaveCount(1);
  await page.getByRole("button", { name: "Date" }).click();
  await expect(page.locator("[data-obj]")).toHaveCount(2);
  const bytes = await exportAndDownload(page, /Export signed PDF/);
  let images = 0;
  pdf(bytes).loadPage(0).getObject().get("Resources").get("XObject").forEach(() => images++);
  expect(images).toBe(1);
  expect(texts(bytes)[0]).toContain(String(new Date().getFullYear()));
});
