import fs from "node:fs";
import path from "node:path";
import { expect, type Page, type Download } from "@playwright/test";
import * as mupdf from "mupdf";

export const FIX = path.resolve("tests/fixtures/generated");
export const fx = (...names: string[]) => names.map((n) => path.join(FIX, n));

export async function upload(page: Page, ...names: string[]) {
  await page.locator('input[type="file"]').first().setInputFiles(fx(...names));
}

/** Clicks the primary action and waits for the result card (or fails with the on-screen error). */
export async function runAndWait(page: Page, action: string | RegExp) {
  await page.getByRole("button", { name: action }).click();
  const done = page.getByText(/Your file is ready|files ready/);
  const failed = page.getByText("That didn't work");
  await expect(done.or(failed)).toBeVisible({ timeout: 150_000 });
  if (await failed.isVisible()) {
    const msg = await page.getByRole("alert").first().textContent();
    throw new Error(`Job failed: ${msg}`);
  }
}

export async function downloadFirst(page: Page, name: RegExp = /^Download/): Promise<{ download: Download; bytes: Uint8Array }> {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name }).first().click()]);
  const p = await download.path();
  return { download, bytes: new Uint8Array(fs.readFileSync(p!)) };
}

export function pdf(bytes: Uint8Array) {
  return mupdf.Document.openDocument(bytes, "application/pdf").asPDF() as mupdf.PDFDocument;
}

export function texts(bytes: Uint8Array): string[] {
  const d = pdf(bytes);
  return Array.from({ length: d.countPages() }, (_, i) => d.loadPage(i).toStructuredText("preserve-whitespace").asText());
}

export function firstLines(bytes: Uint8Array) {
  return texts(bytes).map((t) => t.trim().split("\n")[0].trim());
}
