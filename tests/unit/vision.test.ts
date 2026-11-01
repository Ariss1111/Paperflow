import { describe, it, expect, beforeAll } from "vitest";
import { createWorker, OEM, PSM } from "tesseract.js";
import path from "node:path";
import sharp from "sharp";
import { loadCv, loadVision, makeScene, STRAIGHT, PERSPECTIVE, ROTATED, type Cv, type SceneOptions } from "../helpers/scenes";

let cv: Cv;
let vision: ReturnType<typeof loadVision>;
beforeAll(async () => {
  cv = await loadCv();
  vision = loadVision(cv);
});

const maxError = (a: number[][], b: number[][]) => Math.max(...a.map((p, i) => Math.hypot(p[0] - b[i][0], p[1] - b[i][1])));

const CASES: [string, SceneOptions][] = [
  ["straight page on wood", { corners: STRAIGHT }],
  ["strong perspective", { corners: PERSPECTIVE }],
  ["rotated in frame", { corners: ROTATED }],
  ["low contrast: white page on a light desk", { corners: PERSPECTIVE, background: "light" }],
  ["shadow across page and desk", { corners: PERSPECTIVE, shadow: 0.6 }],
  ["dim room", { corners: STRAIGHT, exposure: 0.45 }],
  ["bright exposure", { corners: PERSPECTIVE, exposure: 1.15, background: "gray" }],
  ["cluttered desk", { corners: PERSPECTIVE, background: "clutter", clutter: true }],
  ["thumb over the bottom edge", { corners: PERSPECTIVE, thumb: true }],
];

describe("page detection", () => {
  it.each(CASES)("%s: live and precise detection find the four corners", async (_n, opts) => {
    const s = await makeScene(cv, opts);
    const live = vision.detect(s.image);
    expect(live.found).toBe(true);
    expect(maxError(live.corners, s.corners)).toBeLessThan(0.03);
    const precise = vision.detectPrecise(s.image);
    expect(precise.found).toBe(true);
    expect(maxError(precise.corners, s.corners)).toBeLessThan(0.018);
  });

  it("doesn't invent a page in an empty scene", async () => {
    const W = 800;
    const H = 600;
    const data = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      data[i * 4] = 92 + (i % 7);
      data[i * 4 + 1] = 60 + (i % 5);
      data[i * 4 + 2] = 38;
      data[i * 4 + 3] = 255;
    }
    expect(vision.detect({ data, width: W, height: H }).found).toBe(false);
  });

  it("is fast enough for a live preview", async () => {
    const s = await makeScene(cv, { corners: PERSPECTIVE });
    const t = Date.now();
    for (let i = 0; i < 5; i++) vision.detect(s.image);
    expect((Date.now() - t) / 5).toBeLessThan(400);
  });
});

describe("crop and perspective correction", () => {
  /** Mean colour in a thin band along each edge of the output: must be paper, never desk. */
  function edgeBands(page: { data: Uint8ClampedArray; width: number; height: number }) {
    const { data, width: w, height: h } = page;
    const band = Math.round(Math.min(w, h) * 0.012);
    const worst = { minBrightness: 255, maxSaturation: 0 };
    const stat = (x0: number, y0: number, x1: number, y1: number) => {
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const k = (y * w + x) * 4;
        r += data[k]; g += data[k + 1]; b += data[k + 2]; n++;
      }
      r /= n; g /= n; b /= n;
      worst.minBrightness = Math.min(worst.minBrightness, (r + g + b) / 3);
      worst.maxSaturation = Math.max(worst.maxSaturation, Math.max(r, g, b) - Math.min(r, g, b));
    };
    stat(0, 0, w, band);
    stat(0, h - band, w, h);
    stat(0, 0, band, h);
    stat(w - band, 0, w, h);
    return worst;
  }

  it.each([
    ["straight", { corners: STRAIGHT }],
    ["perspective", { corners: PERSPECTIVE }],
    ["rotated", { corners: ROTATED }],
  ] as [string, SceneOptions][])("%s: output has A4 proportions and no desk left", async (_n, opts) => {
    const s = await makeScene(cv, opts);
    const { corners } = vision.detectPrecise(s.image);
    const src = vision.toMat(s.image);
    const page = vision.warpPage(src, corners);
    const ratio = Math.max(page.cols, page.rows) / Math.min(page.cols, page.rows);
    expect(ratio).toBeGreaterThan(1.35);
    expect(ratio).toBeLessThan(1.47);
    const bands = edgeBands(vision.fromMat(page));
    // brown wood has high saturation and low brightness; paper has neither
    expect(bands.minBrightness).toBeGreaterThan(190);
    expect(bands.maxSaturation).toBeLessThan(25);
    src.delete();
    page.delete();
  });

  it("orders corners regardless of input order", () => {
    const q = vision.orderCorners([[100, 900], [900, 100], [100, 100], [900, 900]]);
    expect(q).toEqual([[100, 100], [900, 100], [900, 900], [100, 900]]);
  });
});

describe("automatic rotation", () => {
  it.each([
    ["upright", 0, 0],
    ["sideways, clockwise", 90, 270],
    ["upside down", 180, 180],
    ["sideways, counter-clockwise", 270, 90],
  ])("%s text", async (_n, pageRotate, expected) => {
    const { renderLetter } = await import("../helpers/scenes");
    const paper = await renderLetter(1500, pageRotate);
    const m = vision.toMat(paper);
    expect(vision.detectRotation(m)).toBe(expected);
    m.delete();
  });

  it("leaves a page without text alone", () => {
    const m = new cv.Mat(800, 600, cv.CV_8UC4, new cv.Scalar(240, 240, 235, 255));
    expect(vision.detectRotation(m)).toBe(0);
    m.delete();
  });
});

describe("enhancement", () => {
  let ocr: Awaited<ReturnType<typeof createWorker>>;
  beforeAll(async () => {
    ocr = await createWorker("eng", OEM.LSTM_ONLY, { langPath: path.resolve("node_modules/@tesseract.js-data/eng/4.0.0_best_int"), gzip: true, cacheMethod: "none" });
    await ocr.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
  });

  const png = async (img: { data: Uint8ClampedArray; width: number; height: number }) =>
    sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), { raw: { width: img.width, height: img.height, channels: 4 } }).png().toBuffer();

  async function pipeline(opts: SceneOptions, mode: string) {
    const s = await makeScene(cv, opts);
    const { corners } = vision.detectPrecise(s.image);
    const src = vision.toMat(s.image);
    const page = vision.warpPage(src, corners);
    const out = vision.enhance(page, mode, {});
    const img = vision.fromMat(out);
    src.delete(); page.delete(); out.delete();
    return img;
  }

  it.each(["original", "color", "gray", "bw"])("%s mode: a perspective photo becomes readable text", async (mode) => {
    const img = await pipeline({ corners: PERSPECTIVE }, mode);
    const text = (await ocr.recognize(await png(img))).data.text;
    expect(text).toMatch(/INVOICE 2047/);
    expect(text).toMatch(/quarterly audit/);
    expect(text).toMatch(/keep a copy of this page/);
  });

  it("shadow removal evens out lighting and keeps text readable", async () => {
    const opts: SceneOptions = { corners: STRAIGHT, shadow: 0.6 };
    const raw = await pipeline(opts, "original");
    const fixed = await pipeline(opts, "color");
    const side = (img: typeof raw, x0: number, x1: number) => {
      let s = 0, n = 0;
      const y = Math.round(img.height * 0.965);
      for (let x = Math.round(img.width * x0); x < img.width * x1; x++) {
        const k = (y * img.width + x) * 4;
        s += img.data[k + 1]; n++;
      }
      return s / n;
    };
    const unevenRaw = side(raw, 0.04, 0.14) - side(raw, 0.86, 0.96);
    const unevenFixed = Math.abs(side(fixed, 0.04, 0.14) - side(fixed, 0.86, 0.96));
    expect(unevenRaw).toBeGreaterThan(40);
    expect(unevenFixed).toBeLessThan(12);
    expect((await ocr.recognize(await png(fixed))).data.text).toMatch(/quarterly audit/);
  });

  it("black & white output contains only black and white", async () => {
    const img = await pipeline({ corners: PERSPECTIVE, shadow: 0.5 }, "bw");
    let other = 0;
    for (let i = 0; i < img.data.length; i += 4) if (img.data[i] !== 0 && img.data[i] !== 255) other++;
    expect(other).toBe(0);
  });

  it("contrast, readability and sharpen options all run and change the page", async () => {
    const s = await makeScene(cv, { corners: STRAIGHT });
    const src = vision.toMat(s.image);
    const page = vision.warpPage(src, s.corners);
    const base = vision.enhance(page, "original", {});
    const baseSum = base.data.reduce((a: number, b: number) => a + b, 0);
    for (const opt of [{ contrast: 0.6 }, { readability: true }, { sharpen: true }]) {
      const out = vision.enhance(page, "original", opt);
      expect(out.rows).toBe(base.rows);
      let diff = 0;
      for (let i = 0; i < out.data.length; i += 97) diff += Math.abs(out.data[i] - base.data[i]);
      expect(diff).toBeGreaterThan(0);
      out.delete();
    }
    expect(baseSum).toBeGreaterThan(0);
    src.delete(); page.delete(); base.delete();
  });
});
