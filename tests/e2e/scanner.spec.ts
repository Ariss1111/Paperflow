import fs from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";
import * as mupdf from "mupdf";
import { createWorker, OEM, PSM } from "tesseract.js";
import { pdf, texts } from "./helpers";

const DIR = path.resolve("tests/fixtures/generated/scanner");
const photo = (n: string) => path.join(DIR, n);
const CAMERA = path.join(DIR, "camera.mjpeg");

const review = (page: Page) => page.getByRole("img", { name: "Scanned page preview" });

/** Records every camera track so we can assert the stream gets released. */
async function trackStreams(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __tracks: MediaStreamTrack[] };
    w.__tracks = [];
    const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => {
      const s = await orig(c);
      w.__tracks.push(...s.getTracks());
      return s;
    };
  });
}

const liveTracks = (page: Page) => page.evaluate(() => (window as unknown as { __tracks: MediaStreamTrack[] }).__tracks.filter((t) => t.readyState === "live").length);

async function toggleAutoOff(page: Page) {
  const b = page.getByRole("button", { name: /Auto on/ });
  await b.click();
  await expect(page.getByRole("button", { name: /Auto off/ })).toBeVisible();
}

async function downloadPdf(page: Page): Promise<{ bytes: Uint8Array; name: string }> {
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download PDF" }).click()]);
  return { bytes: new Uint8Array(fs.readFileSync((await dl.path())!)), name: dl.suggestedFilename() };
}

/** Renders a PDF page and checks a band along every edge: paper colours only, no wood. */
async function assertNoDesk(bytes: Uint8Array, index: number) {
  const pix = pdf(bytes).loadPage(index).toPixmap(mupdf.Matrix.scale(1.5, 1.5), mupdf.ColorSpace.DeviceRGB, false, true);
  const { data, info } = await sharp(Buffer.from(pix.getPixels()), { raw: { width: pix.getWidth(), height: pix.getHeight(), channels: 3 } }).raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const band = Math.round(Math.min(w, h) * 0.012);
  const mean = (x0: number, y0: number, x1: number, y1: number) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const k = (y * w + x) * 3;
      r += data[k]; g += data[k + 1]; b += data[k + 2]; n++;
    }
    return [r / n, g / n, b / n];
  };
  for (const [x0, y0, x1, y1] of [[0, 0, w, band], [0, h - band, w, h], [0, 0, band, h], [w - band, 0, w, h]]) {
    const [r, g, b] = mean(x0, y0, x1, y1);
    expect((r + g + b) / 3).toBeGreaterThan(190);
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(30);
  }
}

async function ocrPage(bytes: Uint8Array, index: number) {
  const png = pdf(bytes).loadPage(index).toPixmap(mupdf.Matrix.scale(2.5, 2.5), mupdf.ColorSpace.DeviceRGB, false, true).asPNG();
  const w = await createWorker("eng", OEM.LSTM_ONLY, { langPath: path.resolve("node_modules/@tesseract.js-data/eng/4.0.0_best_int"), gzip: true, cacheMethod: "none" });
  await w.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
  const text = (await w.recognize(Buffer.from(png))).data.text;
  await w.terminate();
  return text;
}

// launch flags apply to the whole file; the "without camera" tests override getUserMedia instead
// Chrome: Edge with these simulated-camera flags crashes about 1 tab in 60, even on pages with no camera code.
test.use({ channel: "chrome", launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream=device-count=2", `--use-file-for-fake-video-capture=${CAMERA}`] }, permissions: ["camera"] });

test.describe("with a camera", () => {

  test("Scan Document is on the home page and in the tools list", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("main").getByRole("link", { name: /Scan( Document)?$/ }).first().click();
    await expect(page).toHaveURL(/\/scan/);
    await page.goto("/tools");
    await expect(page.getByRole("link", { name: /Scan Document/ }).first()).toBeVisible();
    await page.goto("/tools/scan");
    await expect(page).toHaveURL(/\/scan$/);
  });

  test("live preview, detection outline and automatic capture", async ({ page }) => {
    await trackStreams(page);
    await page.goto("/scan");
    await expect(page.locator("video")).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.querySelector("video")!.videoWidth)).toBeGreaterThan(0);
    await expect(page.getByTestId("scan-outline")).toBeVisible();
    // hold still → captures on its own, then shows the cropped page
    await expect(review(page)).toBeVisible({ timeout: 30_000 });
    // the camera is released as soon as it isn't needed
    await expect.poll(() => liveTracks(page)).toBe(0);
  });

  test("manual capture with auto off; multi-page; retake; rotate; reorder; delete; rename; PDF output", async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto("/scan");
    await toggleAutoOff(page);
    await expect(page.getByTestId("scan-outline")).toBeVisible();
    // with auto off, nothing happens by itself
    await page.waitForTimeout(2500);
    await expect(page.locator("video")).toBeVisible();

    // page 1: camera
    await page.getByRole("button", { name: "Capture page" }).click();
    await expect(review(page)).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Add another page" }).click();

    // page 2: uploaded photo, black & white
    await expect(page.locator("video")).toBeVisible();
    await page.getByTestId("scan-upload").setInputFiles(photo("photo-rotated.jpg"));
    await expect(review(page)).toBeVisible({ timeout: 30_000 });
    await page.getByRole("radio", { name: "Black & White" }).click();
    await page.getByRole("button", { name: "Add another page" }).click();

    // page 3: another capture, deleted later
    await page.getByRole("button", { name: "Capture page" }).click();
    await expect(review(page)).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Done", exact: true }).click();

    const tiles = page.getByTestId("scan-page");
    await expect(tiles).toHaveCount(3);

    await page.getByRole("button", { name: "Delete page 3" }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(tiles).toHaveCount(2);

    // reorder by keyboard (space, arrow, space): the B&W page moves to the front
    await page.getByRole("button", { name: /^Page 2\./ }).focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(250);
    await page.keyboard.press("Space");
    await page.waitForTimeout(300);

    // rotate what's now page 2 (the colour page)
    await page.getByRole("button", { name: "Rotate page 2" }).click();
    await expect(page.getByRole("button", { name: "Rotate page 2" })).toBeEnabled({ timeout: 30_000 });

    // retake page 2, keeps its place
    await page.getByRole("button", { name: "Retake page 2" }).click();
    await page.getByRole("button", { name: "Capture page" }).click();
    await expect(review(page)).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(tiles).toHaveCount(2);

    await page.getByRole("button", { name: "Rotate page 2" }).click();
    await expect(page.getByRole("button", { name: "Rotate page 2" })).toBeEnabled({ timeout: 30_000 });

    await page.getByLabel("File name").fill("My contract");
    const { bytes, name } = await downloadPdf(page);
    expect(name).toBe("My contract.pdf");
    const doc = pdf(bytes);
    expect(doc.countPages()).toBe(2);
    expect(doc.getMetaData("info:Title")).toBe("My contract");

    // page 1: the B&W page, upright A4
    const [, , w1, h1] = doc.loadPage(0).getBounds();
    expect(Math.abs(w1 - 595.28)).toBeLessThan(1.5);
    expect(Math.abs(h1 - 841.89)).toBeLessThan(1.5);
    await assertNoDesk(bytes, 0);
    const text = await ocrPage(bytes, 0);
    expect(text).toMatch(/INVOICE 2047/);
    expect(text).toMatch(/quarterly audit/);

    // page 2: rotated once by the user → landscape A4 with correct proportions
    const [, , w2, h2] = doc.loadPage(1).getBounds();
    expect(Math.abs(w2 - 841.89)).toBeLessThan(1.5);
    expect(Math.abs(h2 - 595.28)).toBeLessThan(1.5);
    await assertNoDesk(bytes, 1);
  });

  test("modes and options re-render the preview live", async ({ page }) => {
    await page.goto("/scan");
    await toggleAutoOff(page);
    await page.getByTestId("scan-upload").setInputFiles(photo("photo-desk.jpg"));
    const preview = review(page);
    await expect(preview).toBeVisible({ timeout: 30_000 });
    const hash = () =>
      preview.evaluate((c: HTMLCanvasElement) => {
        const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
        let h = 0;
        for (let i = 0; i < d.length; i += 251) h = (h * 31 + d[i]) | 0;
        return `${c.width}x${c.height}:${h}`;
      });
    const seen = new Set([await hash()]);
    for (const name of ["Original", "Grayscale", "Black & White"]) {
      await page.getByRole("radio", { name }).click();
      await expect.poll(async () => !seen.has(await hash()), { timeout: 15_000 }).toBe(true);
      seen.add(await hash());
    }
    await page.getByRole("radio", { name: "Original" }).click();
    await expect.poll(hash, { timeout: 15_000 }).not.toBe([...seen].pop());
    const before = await hash();
    await page.getByLabel("Sharpen text").click();
    await expect.poll(hash, { timeout: 15_000 }).not.toBe(before);
    // grayscale really is gray
    await page.getByRole("radio", { name: "Grayscale" }).click();
    await expect
      .poll(() => preview.evaluate((c: HTMLCanvasElement) => {
        const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
        for (let i = 0; i < d.length; i += 4000) if (d[i] !== d[i + 1] || d[i] !== d[i + 2]) return false;
        return true;
      }), { timeout: 15_000 })
      .toBe(true);
  });

  test("no page found → manual corners; drag and keyboard both work; result is used", async ({ page }) => {
    await page.goto("/scan");
    await toggleAutoOff(page);
    await page.getByTestId("scan-upload").setInputFiles(photo("photo-no-page.jpg"));
    await expect(page.getByText(/couldn't find the page edges/)).toBeVisible({ timeout: 30_000 });
    const editor = page.getByTestId("corner-editor");
    await expect(editor).toBeVisible();

    const corner = page.locator('[data-corner="0"]');
    const start = (await corner.getAttribute("aria-valuetext"))!;
    const b = (await corner.locator("circle").last().boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + 120, b.y + 90, { steps: 6 });
    await page.mouse.up();
    await expect(corner).not.toHaveAttribute("aria-valuetext", start);

    const moved = (await corner.getAttribute("aria-valuetext"))!;
    await corner.focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowRight");
    await expect(corner).not.toHaveAttribute("aria-valuetext", moved);

    // crossing the corners is caught
    const br = (await page.locator('[data-corner="2"]').locator("circle").last().boundingBox())!;
    await page.mouse.move(br.x + br.width / 2, br.y + br.height / 2);
    await page.mouse.down();
    const box = (await editor.boundingBox())!;
    await page.mouse.move(box.x + 4, box.y + 4, { steps: 6 });
    await page.mouse.up();
    await expect(page.getByText(/corners cross each other/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Apply crop" })).toBeDisabled();
    await page.getByRole("button", { name: "Use whole photo" }).click();

    await page.getByRole("button", { name: "Apply crop" }).click();
    await expect(review(page)).toBeVisible({ timeout: 30_000 });
  });

  test("adjusting corners changes the crop", async ({ page }) => {
    await page.goto("/scan");
    await toggleAutoOff(page);
    await page.getByTestId("scan-upload").setInputFiles(photo("photo-desk.jpg"));
    const preview = review(page);
    await expect(preview).toBeVisible({ timeout: 30_000 });
    const size = () => preview.evaluate((c: HTMLCanvasElement) => `${c.width}x${c.height}`);
    const before = await size();
    await page.getByRole("button", { name: "Corners" }).click();
    await page.getByRole("button", { name: "Use whole photo" }).click();
    await page.getByRole("button", { name: "Apply crop" }).click();
    await expect.poll(size, { timeout: 15_000 }).not.toBe(before);
  });

  test("continue editing opens the scan in the PDF editor", async ({ page }) => {
    await page.goto("/scan");
    await toggleAutoOff(page);
    await page.getByTestId("scan-upload").setInputFiles(photo("photo-desk.jpg"));
    await expect(review(page)).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: /Continue editing/ }).click();
    await page.getByRole("menuitem", { name: "PDF Editor" }).click();
    await expect(page).toHaveURL(/\/editor\?files=/);
    await expect(page.locator("[data-page-key]").first().locator("canvas")).toHaveClass(/opacity-100/);
  });

  test("uploading several photos processes them as a batch", async ({ page }) => {
    await page.goto("/scan");
    await toggleAutoOff(page);
    await page.getByTestId("scan-upload").setInputFiles([photo("photo-desk.jpg"), photo("photo-rotated.jpg")]);
    await expect(page.getByTestId("scan-page")).toHaveCount(2, { timeout: 60_000 });
    const { bytes } = await downloadPdf(page);
    expect(pdf(bytes).countPages()).toBe(2);
    expect(texts(bytes).join("")).toBe("".padEnd(0)); // scans are images: no text layer until OCR
  });

  test("phone layout: large capture button, no sideways scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/scan");
    const capture = page.getByRole("button", { name: "Capture page" });
    await expect(capture).toBeVisible();
    const b = (await capture.boundingBox())!;
    expect(b.width).toBeGreaterThanOrEqual(70);
    expect(b.y + b.height).toBeLessThanOrEqual(844);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    await toggleAutoOff(page);
    await page.getByTestId("scan-upload").setInputFiles(photo("photo-desk.jpg"));
    await expect(review(page)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Done", exact: true })).toBeAttached();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page.getByRole("button", { name: "Download PDF" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  });
});

test.describe("without camera access", () => {
  test("explains what happened and upload still works", async ({ page }) => {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("denied", "NotAllowedError"));
    });
    await page.goto("/scan");
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Camera access is blocked");
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await page.getByTestId("scan-upload").setInputFiles(photo("photo-desk.jpg"));
    await expect(review(page)).toBeVisible({ timeout: 30_000 });
  });

  test("a device with no camera says so", async ({ page }) => {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("none", "NotFoundError"));
    });
    await page.goto("/scan");
    await expect(page.getByRole("main").getByRole("alert")).toContainText("No camera found");
  });

  test("an unreadable upload shows an error", async ({ page }) => {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("none", "NotFoundError"));
    });
    await page.goto("/scan");
    await page.getByTestId("scan-upload").setInputFiles({ name: "broken.jpg", mimeType: "image/jpeg", buffer: Buffer.from("not an image") });
    await expect(page.getByText(/couldn't be read/)).toBeVisible();
  });
});
