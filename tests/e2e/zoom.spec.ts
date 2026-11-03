import fs from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { upload, pdf, texts } from "./helpers";

async function open(page: Page, file = "text-5pages.pdf") {
  await page.goto("/editor");
  await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("pf-editor")).forEach((k) => localStorage.removeItem(k)));
  await upload(page, file);
  const first = page.locator("[data-page-key]").first();
  await expect(first.locator("canvas")).toHaveClass(/opacity-100/);
  await expect(zoomInput(page)).toBeVisible();
  return first;
}

const zoomInput = (page: Page) => page.getByLabel("Zoom percentage");
const percent = async (page: Page) => Number(await zoomInput(page).inputValue());
const scroller = (page: Page) => page.getByTestId("editor-scroller");
const scrollPos = (page: Page) => scroller(page).evaluate((s) => ({ left: s.scrollLeft, top: s.scrollTop, maxLeft: s.scrollWidth - s.clientWidth, maxTop: s.scrollHeight - s.clientHeight, w: s.clientWidth, h: s.clientHeight }));

async function setZoom(page: Page, value: string) {
  await zoomInput(page).fill(value);
  await zoomInput(page).press("Enter");
}

async function zoomMenu(page: Page, item: string | RegExp) {
  await page.getByRole("button", { name: "Zoom options" }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

test("buttons, typed percentage, presets, fit width, fit page and reset", async ({ page }) => {
  const first = await open(page);
  await setZoom(page, "100");
  expect(await percent(page)).toBe(100);
  // 100% = true physical size: the 595 pt wide page is 793.3 CSS px
  await expect.poll(async () => Math.round((await first.boundingBox())!.width)).toBe(793);

  await page.getByRole("button", { name: /^Zoom in/ }).click();
  await expect.poll(() => percent(page)).toBe(110);
  await page.getByRole("button", { name: /^Zoom out/ }).click();
  await page.getByRole("button", { name: /^Zoom out/ }).click();
  await expect.poll(() => percent(page)).toBe(90);

  await setZoom(page, "150%");
  await expect.poll(() => percent(page)).toBe(150);
  await expect.poll(async () => Math.round((await first.boundingBox())!.width)).toBe(1190);

  // junk is ignored, out-of-range clamps
  await setZoom(page, "abc");
  expect(await percent(page)).toBe(150);
  await setZoom(page, "9000");
  await expect.poll(() => percent(page)).toBe(500);
  await setZoom(page, "1");
  await expect.poll(() => percent(page)).toBe(10);

  await zoomMenu(page, "200%");
  await expect.poll(() => percent(page)).toBe(200);

  await page.getByRole("button", { name: /^Fit to width/ }).click();
  await expect.poll(async () => (await scrollPos(page)).maxLeft).toBeLessThanOrEqual(1);
  const widthFit = await percent(page);

  await setZoom(page, "300");
  await page.getByRole("button", { name: /^Fit to page/ }).click();
  await expect.poll(() => percent(page)).toBeLessThanOrEqual(widthFit);
  // the page shown in the page box fits inside the viewer, both ways, and is in view
  const current = page.locator("[data-page-key]").nth(Number(await page.getByLabel("Page number").inputValue()) - 1);
  const viewer = (await scroller(page).boundingBox())!;
  await expect.poll(async () => (await current.boundingBox())!.height <= viewer.height).toBe(true);
  const b = (await current.boundingBox())!;
  expect(b.width).toBeLessThanOrEqual(viewer.width);
  expect(b.y).toBeGreaterThanOrEqual(viewer.y - 1);
  expect(b.y + b.height).toBeLessThanOrEqual(viewer.y + viewer.height + 1);

  await page.getByRole("button", { name: /^Reset zoom/ }).click();
  await expect.poll(() => percent(page)).toBe(100);
});

test("the page bitmap is re-rendered sharply, never just stretched", async ({ page }) => {
  const first = await open(page);
  const canvas = first.locator("canvas");
  for (const z of ["100", "300", "500"]) {
    await setZoom(page, z);
    await expect
      .poll(() =>
        canvas.evaluate((c: HTMLCanvasElement) => {
          const css = c.getBoundingClientRect().width;
          return Math.abs(c.width - css * Math.max(1, devicePixelRatio)) < 2;
        }),
      )
      .toBe(true);
  }
  // and it has real content at the deepest zoom
  const dark = await canvas.evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4 * 97) if (d[i] < 80) n++;
    return n;
  });
  expect(dark).toBeGreaterThan(100);
});

test("Ctrl + wheel zooms around the cursor; a plain wheel still scrolls pages", async ({ page }) => {
  const first = await open(page);
  await setZoom(page, "100");
  await expect.poll(() => percent(page)).toBe(100);
  const box = (await first.boundingBox())!;
  const at = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.2 };
  const before = { fx: (at.x - box.x) / box.width, fy: (at.y - box.y) / box.height };

  await page.mouse.move(at.x, at.y);
  await page.keyboard.down("Control");
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  await expect.poll(() => percent(page)).toBeGreaterThan(150);
  // wait for the gesture to commit, then the same document point must still be under the cursor
  await page.waitForTimeout(400);
  const after = (await first.boundingBox())!;
  expect(after.width).toBeGreaterThan(box.width * 1.4);
  expect(Math.abs((at.x - after.x) / after.width - before.fx)).toBeLessThan(0.015);
  expect(Math.abs((at.y - after.y) / after.height - before.fy)).toBeLessThan(0.015);

  const z = await percent(page);
  const top = (await scrollPos(page)).top;
  await page.mouse.wheel(0, 600);
  await expect.poll(async () => (await scrollPos(page)).top).toBeGreaterThan(top);
  expect(await percent(page)).toBe(z);
});

test("panning: hand tool, Space + drag, and dragging empty page in Select", async ({ page }) => {
  const first = await open(page);
  await setZoom(page, "300");
  await expect.poll(() => percent(page)).toBe(300);
  await page.waitForTimeout(200);
  const s = await scroller(page).boundingBox();
  const cx = s!.x + s!.width / 2;
  const cy = s!.y + s!.height / 2;

  const drag = async () => {
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx - 120, cy - 150, { steps: 6 });
    await page.mouse.up();
  };

  // Select tool on empty page
  let p = await scrollPos(page);
  await drag();
  let q = await scrollPos(page);
  expect(q.top).toBeGreaterThan(p.top + 100);
  expect(q.left).toBeGreaterThan(p.left + 80);
  await expect(page.locator("[data-obj]")).toHaveCount(0);

  // Hand tool
  await page.getByRole("button", { name: /^Pan/ }).click();
  p = q;
  await drag();
  q = await scrollPos(page);
  expect(q.top).toBeGreaterThan(p.top + 100);

  // Space + drag while another tool is active: pans and draws nothing
  await page.getByRole("button", { name: /^Rectangle/ }).click();
  await page.keyboard.down("Space");
  p = q;
  await drag();
  await page.keyboard.up("Space");
  q = await scrollPos(page);
  expect(q.top).toBeGreaterThan(p.top + 100);
  await expect(page.locator("[data-obj]")).toHaveCount(0);
  void first;
});

test("page navigation works at any zoom", async ({ page }) => {
  await open(page);
  await setZoom(page, "200");
  await expect.poll(() => percent(page)).toBe(200);
  await page.getByRole("button", { name: /^Next page/ }).click();
  await expect.poll(() => page.getByLabel("Page number").inputValue()).toBe("2");
  await page.getByLabel("Page number").fill("5");
  await page.getByLabel("Page number").press("Enter");
  await expect.poll(() => page.getByLabel("Page number").inputValue()).toBe("5");
  await page.getByRole("button", { name: /^Previous page/ }).click();
  await expect.poll(() => page.getByLabel("Page number").inputValue()).toBe("4");
  expect(await percent(page)).toBe(200);
});

test("editing while zoomed puts objects in the right place in the exported PDF", async ({ page }) => {
  const first = await open(page, "text-3pages.pdf");
  await setZoom(page, "250");
  await expect.poll(() => percent(page)).toBe(250);
  await page.waitForTimeout(300);
  // click the middle of the visible part of the page
  const s = (await scroller(page).boundingBox())!;
  const clickAt = { x: s.x + s.width / 2, y: s.y + s.height / 2 };
  const box = (await first.boundingBox())!;
  const fx = (clickAt.x - box.x) / box.width;
  const fy = (clickAt.y - box.y) / box.height;
  await page.getByRole("button", { name: /^Add text/ }).click();
  await page.mouse.click(clickAt.x, clickAt.y);
  await page.keyboard.type("Zoomed note");
  await page.keyboard.press("Escape");
  // Download exports for real and saves the file once it exists
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 120_000 }), page.getByRole("button", { name: "Download PDF", exact: true }).first().click()]);
  await expect(page.getByText(/Your file is ready/)).toBeVisible();
  const bytes = new Uint8Array(fs.readFileSync((await dl.path())!));
  expect(texts(bytes)[0]).toContain("Zoomed note");
  const pg = pdf(bytes).loadPage(0);
  const hit = pg.search("Zoomed", {})[0][0];
  const [, , w, h] = pg.getBounds();
  expect(Math.abs(hit[0] / w - fx)).toBeLessThan(0.01);
  expect(Math.abs(hit[1] / h - fy)).toBeLessThan(0.02);
});

test.describe("touch", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 }, isMobile: false });

  /** Real multi-touch through the DevTools protocol. */
  async function pinch(page: Page, from: number, to: number) {
    const s = (await scroller(page).boundingBox())!;
    const cx = s.x + s.width / 2;
    const cy = s.y + s.height / 2;
    const cdp = await page.context().newCDPSession(page);
    const points = (d: number) => [{ x: cx - d / 2, y: cy, id: 1 }, { x: cx + d / 2, y: cy, id: 2 }];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points(from) });
    for (let i = 1; i <= 8; i++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points(from + ((to - from) * i) / 8) });
      await page.waitForTimeout(16);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }

  test("pinch zooms in and out; controls fit a phone", async ({ page }) => {
    await open(page);
    await expect(page.getByRole("button", { name: /^Zoom in/ })).toBeVisible();
    await setZoom(page, "60");
    await expect.poll(() => percent(page)).toBe(60);
    await pinch(page, 80, 240); // ×3
    await expect.poll(() => percent(page)).toBeGreaterThan(160);
    const big = await percent(page);
    expect(big).toBeLessThan(200);
    await page.waitForTimeout(200);
    await pinch(page, 240, 80); // ÷3
    await expect.poll(() => percent(page)).toBeLessThan(big / 2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  });

  test("a pinch while a drawing tool is active doesn't leave a stray mark", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: /^Draw/ }).click();
    await setZoom(page, "60");
    await expect.poll(() => percent(page)).toBe(60);
    await pinch(page, 80, 160);
    await expect.poll(() => percent(page)).toBeGreaterThan(90);
    await expect(page.locator("[data-obj]")).toHaveCount(0);
  });
});
