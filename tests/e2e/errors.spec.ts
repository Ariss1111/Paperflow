import fs from "node:fs";
import { test, expect } from "@playwright/test";
import { upload, runAndWait } from "./helpers";

test("unsupported and empty files are rejected with a reason", async ({ page }) => {
  await page.goto("/tools/merge");
  await upload(page, "program.exe");
  await expect(page.getByText(/couldn't be added/)).toBeVisible();
  await upload(page, "empty.pdf");
  await expect(page.getByText(/is empty/)).toBeVisible();
});

test("a file with the wrong extension is identified by content", async ({ page }) => {
  await page.goto("/tools/merge");
  await upload(page, "image-named.pdf");
  // it's really a PNG, which Merge doesn't accept
  await expect(page.getByText(/actually a PNG/)).toBeVisible();
});

test("wrong password shows a clear error and offers retry", async ({ page }) => {
  await page.goto("/tools/unlock");
  await upload(page, "encrypted.pdf");
  await page.getByLabel("Current password").fill("wrong");
  await expect(runAndWait(page, "Unlock PDF")).rejects.toThrow(/isn't correct/);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await page.getByRole("button", { name: "Change files or options" }).click();
  await page.getByLabel("Current password").fill("secret");
  await runAndWait(page, "Unlock PDF");
});

test("mismatched confirmation password is caught before upload", async ({ page }) => {
  await page.goto("/tools/protect");
  await upload(page, "text-1page.pdf");
  await page.getByLabel("Password", { exact: true }).fill("one");
  await page.getByLabel("Confirm password").fill("two");
  await page.getByRole("button", { name: "Protect PDF" }).click();
  await expect(page.getByText("The passwords don't match.")).toBeVisible();
});

test("invalid page ranges are explained inline", async ({ page }) => {
  await page.goto("/tools/split");
  await upload(page, "text-3pages.pdf");
  await page.getByLabel("Page ranges").fill("2-9");
  await page.getByRole("button", { name: "Split PDF" }).click();
  await expect(page.getByText(/out of range/)).toBeVisible();
});

test("password-protected input is blocked with a link to unlock", async ({ page }) => {
  await page.goto("/tools/compress");
  await upload(page, "encrypted.pdf");
  await expect(page.getByText(/must be unlocked first/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Compress PDF" })).toBeDisabled();
});

test("corrupted office file fails with an explanation", async ({ page }) => {
  await page.goto("/tools/word-to-pdf");
  await upload(page, "corrupt.docx");
  // the content check rejects it at upload, or LibreOffice rejects it at conversion — either way the user is told why
  const uploadErr = page.getByText(/couldn't be added/);
  const action = page.getByRole("button", { name: "Convert to PDF" });
  await expect(uploadErr.or(action)).toBeVisible();
  if (await uploadErr.isVisible()) {
    await expect(page.getByText(/isn't a supported document|damaged/)).toBeVisible();
    return;
  }
  await expect(runAndWait(page, "Convert to PDF")).rejects.toThrow(/couldn't|damaged/);
});

test("large uploads stream through (60 MB PDF) and report real progress", async ({ page }) => {
  const { PDFDocument, PDFName } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  // an incompressible 60 MB payload stored as a (valid) unreferenced stream
  const big = new Uint8Array(60 * 1024 * 1024);
  for (let i = 0; i < big.length; i += 65536) crypto.getRandomValues(big.subarray(i, i + 65536));
  doc.context.register(doc.context.stream(big, { Type: PDFName.of("XObject") }));
  const bytes = await doc.save({ useObjectStreams: false });
  const file = test.info().outputPath("big.pdf");
  fs.writeFileSync(file, bytes);
  await page.goto("/tools/rotate");
  await page.locator('input[type="file"]').first().setInputFiles(file);
  await expect(page.getByText("big.pdf")).toBeVisible({ timeout: 120_000 });
  await runAndWait(page, "Rotate PDF");
});

test("scanned PDFs get an OCR hint in text tools", async ({ page }) => {
  await page.goto("/tools/extract-text");
  await upload(page, "scanned.pdf");
  await expect(page.getByText("This looks like a scanned document")).toBeVisible();
});
