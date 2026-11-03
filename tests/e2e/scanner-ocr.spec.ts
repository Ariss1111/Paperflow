import fs from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { pdf, texts } from "./helpers";

const DIR = path.resolve("tests/fixtures/generated/scanner");
const photo = (n: string) => path.join(DIR, n);
const review = (page: Page) => page.getByRole("img", { name: "Scanned page preview" });
// Tesseract may write ş/ţ with a cedilla; Romanian proper uses the comma below
const ro = (s: string) => s.replace(/ş/g, "ș").replace(/ţ/g, "ț").replace(/Ş/g, "Ș").replace(/Ţ/g, "Ț");

test.use({ channel: "chrome", permissions: ["clipboard-read", "clipboard-write"] });

/** Opens the scanner without a camera and turns uploaded photos into pages. */
async function scanPhotos(page: Page, ...names: string[]) {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("none", "NotFoundError"));
    localStorage.removeItem("pf-scan-ocr");
  });
  await page.goto("/scan");
  await page.getByTestId("scan-upload").setInputFiles(names.map(photo));
  if (names.length === 1) {
    await expect(review(page)).toBeVisible({ timeout: 30_000 });
    return;
  }
  await expect(page.getByTestId("scan-page")).toHaveCount(names.length, { timeout: 60_000 });
}

async function download(page: Page, name: string | RegExp) {
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 150_000 }), page.getByRole("button", { name }).click()]);
  return { bytes: new Uint8Array(fs.readFileSync((await dl.path())!)), name: dl.suggestedFilename() };
}

test("English: recognise, select and copy text, search, export .txt and a searchable PDF", async ({ page }) => {
  test.setTimeout(240_000);
  await scanPhotos(page, "photo-desk.jpg");
  await page.getByRole("button", { name: "Done", exact: true }).click();

  await page.getByLabel("Document language").selectOption("eng");
  await page.getByRole("button", { name: "Recognise text" }).click();
  await expect(page.getByText(/Recognising page 1 of 1/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recognised text" })).toBeVisible({ timeout: 120_000 });
  const pageText = page.getByTestId("page-text").first();
  await expect(pageText).toContainText("INVOICE 2047");
  await expect(pageText).toContainText("quarterly audit");

  // search: the phrase is on the page five times, highlighted over the image
  await page.getByLabel("Search the scan").fill("Quarterly Audit");
  await expect(page.getByTestId("search-count")).toHaveText("1 of 5");
  await expect(page.locator('[data-hit="active"]')).toHaveCount(2); // two words
  await page.getByRole("button", { name: "Next match" }).click();
  await expect(page.getByTestId("search-count")).toHaveText("2 of 5");
  await page.getByLabel("Search the scan").fill("zebra");
  await expect(page.getByTestId("search-count")).toHaveText("No matches");

  // the text over the page image is real, selectable text in reading order
  const selected = await page.evaluate(() => {
    const layer = document.querySelector('[data-testid="ocr-layer"]')!;
    const r = document.createRange();
    r.selectNodeContents(layer.firstElementChild!); // the first line
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(r);
    return getSelection()!.toString();
  });
  expect(selected.replace(/\s+/g, " ").trim()).toBe("INVOICE 2047");
  // the words sit where they are in the picture: the heading is in the top part of the page
  const layerBox = (await page.getByTestId("ocr-layer").boundingBox())!;
  const heading = (await page.getByTestId("ocr-layer").locator("span", { hasText: "INVOICE" }).first().boundingBox())!;
  expect((heading.y - layerBox.y) / layerBox.height).toBeLessThan(0.15);

  await page.getByRole("button", { name: "Copy all" }).click();
  await expect(page.getByText("All text copied.")).toBeVisible();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain("——— Page 1 ———");
  expect(clip).toContain("INVOICE 2047");

  const txt = await download(page, "Export .txt");
  expect(txt.name).toMatch(/\.txt$/);
  const body = Buffer.from(txt.bytes).toString("utf8");
  expect(body).toContain("INVOICE 2047");
  expect(body).toContain("payment should be received");

  // the searchable switch turned itself on; the PDF is verified, then downloaded
  await page.getByRole("button", { name: "Pages" }).click();
  await expect(page.getByRole("switch", { name: /Searchable PDF/ })).toBeChecked();
  const out = await download(page, "Download PDF");
  await expect(page.getByText("Your PDF is downloading: 1 page, text searchable.")).toBeVisible();
  const d = pdf(out.bytes);
  expect(d.countPages()).toBe(1);
  const t = texts(out.bytes)[0];
  expect(t).toContain("INVOICE 2047");
  expect(t).toContain("quarterly audit");
  // the text layer lines up with the image: the heading is found near the top
  const pg = d.loadPage(0);
  const hit = pg.search("INVOICE", {})[0][0];
  const [, , , h] = pg.getBounds();
  expect(hit[1] / h).toBeLessThan(0.15);
  // the page is still a scan: its image is there
  let images = 0;
  pg.getObject().get("Resources").get("XObject").forEach(() => images++);
  expect(images).toBeGreaterThanOrEqual(1);
});

test("Romanian with diacritics, high contrast mode, dim light; search ignores accents", async ({ page }) => {
  test.setTimeout(240_000);
  await scanPhotos(page, "photo-romanian.jpg");
  await page.getByRole("radio", { name: "High contrast" }).click();
  await expect(page.getByRole("radio", { name: "High contrast" })).toBeChecked();
  await page.getByRole("button", { name: "Done", exact: true }).click();

  await page.getByLabel("Document language").selectOption("ron");
  await page.getByRole("button", { name: "Recognise text" }).click();
  await expect(page.getByRole("heading", { name: "Recognised text" })).toBeVisible({ timeout: 120_000 });
  const text = ro((await page.getByTestId("page-text").first().textContent()) ?? "");
  expect(text).toContain("FACTURĂ 2047");
  for (const w of ["mulțumim", "sfârșitul", "împreună", "săptămânii", "Știm", "țara"]) expect(text).toContain(w);

  // typed without diacritics, still found
  await page.getByLabel("Search the scan").fill("sfarsitul lunii");
  await expect(page.getByTestId("search-count")).toHaveText("1 of 5");

  await page.getByRole("button", { name: "Pages" }).click();
  const out = await download(page, "Download PDF");
  const t = ro(texts(out.bytes)[0]);
  expect(t).toContain("mulțumim");
  expect(t).toContain("săptămânii");
});

test("searchable PDF straight from Download, several pages in order; Continue editing keeps the text", async ({ page }) => {
  test.setTimeout(300_000);
  await scanPhotos(page, "photo-desk.jpg", "photo-romanian.jpg");
  await page.getByLabel("Document language").selectOption("eng+ron");
  await page.getByRole("switch", { name: /Searchable PDF/ }).click();
  const out = await download(page, "Download PDF");
  await expect(page.getByText("Your PDF is downloading: 2 pages, text searchable.")).toBeVisible();
  const t = texts(out.bytes);
  expect(t).toHaveLength(2);
  expect(t[0]).toContain("INVOICE 2047");
  // with both languages loaded the bold heading's Ă can come out as A; the body keeps its diacritics
  expect(ro(t[1])).toMatch(/FACTUR[AĂ] 2047/);
  expect(ro(t[1])).toContain("mulțumim");
  expect(ro(t[1])).toContain("sfârșitul lunii");
  // both pages carry a "Text" badge now
  await expect(page.getByTestId("scan-page").getByText("Text", { exact: true })).toHaveCount(2);

  // into the PDF editor: the recognised text is there to work with
  await page.getByRole("button", { name: /Continue editing/ }).click();
  await page.getByRole("menuitem", { name: "PDF Editor" }).click();
  await expect(page).toHaveURL(/\/editor\?files=/, { timeout: 60_000 });
  await expect(page.locator("[data-page-key]")).toHaveCount(2);
  const id = new URL(page.url()).searchParams.get("files")!;
  const bytes = new Uint8Array(await (await page.request.get(`/api/files/${id}/content`)).body());
  expect(texts(bytes)[0]).toContain("INVOICE 2047");
});
