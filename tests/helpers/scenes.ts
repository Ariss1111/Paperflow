// Synthetic "photos of a document" with known page corners: the ground truth real photos can't give us.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";
import * as mupdf from "mupdf";

const require = createRequire(import.meta.url);

export type Cv = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export async function loadCv(): Promise<Cv> {
  return await require(path.resolve("node_modules/@techstark/opencv-js"));
}

export function loadVision(cv: Cv) {
  // a classic browser script, while this package is type: module: evaluate it with its CommonJS branch
  const module = { exports: {} as unknown as (cv: Cv) => Cv };
  new Function("module", fs.readFileSync(path.resolve("public/scanner/vision.js"), "utf8"))(module);
  return module.exports(cv);
}

export const PAGE_TEXT = [
  "Paperflow keeps documents precise and every page legible.",
  "Thank you for choosing our company for the quarterly audit.",
  "The payment should be received before the end of the month.",
  "Please keep a copy of this page together with your records.",
  "Our office is open during the working days of every week.",
];

/** An A4 text page, rendered like paper (white, dark text, a heading). `upright` controls text orientation. */
export async function renderLetter(longSide = 1500, rotate = 0): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  page.drawText("INVOICE 2047", { x: 60, y: 770, size: 30, font: bold, color: rgb(0.08, 0.08, 0.1) });
  let y = 720;
  for (let block = 0; block < 5; block++) {
    for (const line of PAGE_TEXT) {
      page.drawText(line, { x: 60, y, size: 13, font, color: rgb(0.1, 0.1, 0.12) });
      y -= 20;
    }
    y -= 12;
  }
  if (rotate) page.setRotation(degrees(rotate));
  const bytes = await doc.save();
  const d = mupdf.Document.openDocument(bytes, "application/pdf");
  const k = longSide / 841.89;
  const pix = d.loadPage(0).toPixmap(mupdf.Matrix.scale(k, k), mupdf.ColorSpace.DeviceRGB, false, true);
  const w = pix.getWidth();
  const h = pix.getHeight();
  const src = pix.getPixels();
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    // slightly warm, not pure white, like real paper under room light
    data[i * 4] = src[i * 3] * 0.95;
    data[i * 4 + 1] = src[i * 3 + 1] * 0.94;
    data[i * 4 + 2] = src[i * 3 + 2] * 0.9;
    data[i * 4 + 3] = 255;
  }
  return { data, width: w, height: h };
}

function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

export type Background = "wood" | "light" | "clutter" | "gray";

function fillBackground(buf: Uint8ClampedArray, w: number, h: number, kind: Background, r: () => number) {
  const base = kind === "wood" ? [92, 60, 38] : kind === "light" ? [186, 180, 168] : kind === "gray" ? [70, 74, 80] : [48, 52, 60];
  const noise = kind === "light" ? 8 : 16;
  for (let y = 0; y < h; y++) {
    const grain = kind === "wood" ? Math.sin(y / 9) * 9 + Math.sin(y / 41) * 12 : 0;
    for (let x = 0; x < w; x++) {
      const n = (r() - 0.5) * noise + grain;
      const k = (y * w + x) * 4;
      buf[k] = base[0] + n;
      buf[k + 1] = base[1] + n;
      buf[k + 2] = base[2] + n;
      buf[k + 3] = 255;
    }
  }
}

function rect(buf: Uint8ClampedArray, W: number, x0: number, y0: number, x1: number, y1: number, c: number[]) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const k = (y * W + x) * 4;
    buf[k] = c[0];
    buf[k + 1] = c[1];
    buf[k + 2] = c[2];
  }
}

export interface SceneOptions {
  width?: number;
  height?: number;
  /** page corners in pixels: TL, TR, BR, BL of the *paper* */
  corners: [number, number][];
  background?: Background;
  clutter?: boolean;
  /** darken left→right, simulating a shadow falling across desk and page */
  shadow?: number;
  /** overall exposure multiplier */
  exposure?: number;
  /** skin-coloured thumb overlapping the bottom edge of the page */
  thumb?: boolean;
  pageRotate?: number;
  seed?: number;
}

export interface Scene {
  image: { data: Uint8ClampedArray; width: number; height: number };
  corners: [number, number][]; // normalised ground truth, TL TR BR BL as seen in the frame
}

export async function makeScene(cv: Cv, o: SceneOptions): Promise<Scene> {
  const W = o.width ?? 1600;
  const H = o.height ?? 1200;
  const r = rng(o.seed ?? 7);
  const buf = new Uint8ClampedArray(W * H * 4);
  fillBackground(buf, W, H, o.background ?? "wood", r);
  if (o.clutter) {
    rect(buf, W, 40, 60, 200, 180, [200, 40, 50]); // red notebook
    rect(buf, W, W - 170, H - 240, W - 60, H - 50, [40, 90, 200]); // blue box
    rect(buf, W, W - 330, 50, W - 40, 72, [230, 230, 230]); // white pen
  }
  const scene = new cv.Mat(H, W, cv.CV_8UC4);
  scene.data.set(buf);

  const paper = await renderLetter(1500, o.pageRotate ?? 0);
  const pm = new cv.Mat(paper.height, paper.width, cv.CV_8UC4);
  pm.data.set(paper.data);
  const from = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, paper.width, 0, paper.width, paper.height, 0, paper.height]);
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, o.corners.flat());
  const M = cv.getPerspectiveTransform(from, to);
  // BORDER_TRANSPARENT keeps the desk outside the page
  cv.warpPerspective(pm, scene, M, new cv.Size(W, H), cv.INTER_LINEAR, cv.BORDER_TRANSPARENT);
  const d = scene.data;

  if (o.thumb) {
    const [bl, br] = [o.corners[3], o.corners[2]];
    const cx = bl[0] + (br[0] - bl[0]) * 0.65;
    const cy = bl[1] + (br[1] - bl[1]) * 0.65;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const dx = (x - cx) / 55;
      const dy = (y - cy - 40) / 110;
      if (dx * dx + dy * dy < 1) {
        const k = (y * W + x) * 4;
        d[k] = 205;
        d[k + 1] = 150;
        d[k + 2] = 125;
      }
    }
  }

  const shadow = o.shadow ?? 0;
  const exposure = o.exposure ?? 1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = (y * W + x) * 4;
    const f = exposure * (1 - (shadow * x) / W);
    const n = (r() - 0.5) * 6; // sensor noise
    d[k] = Math.max(0, Math.min(255, d[k] * f + n));
    d[k + 1] = Math.max(0, Math.min(255, d[k + 1] * f + n));
    d[k + 2] = Math.max(0, Math.min(255, d[k + 2] * f + n));
  }
  const image = { data: new Uint8ClampedArray(d), width: W, height: H };
  scene.delete(); pm.delete(); from.delete(); to.delete(); M.delete();
  return { image, corners: o.corners.map(([x, y]) => [x / W, y / H]) };
}

/**
 * Corners of a real A4 sheet seen by a pinhole camera over a 1600×1200 frame:
 * tilt = camera pitch relative to the desk, spin = sheet rotation on the desk (degrees).
 */
export function cameraView(tilt: number, spin: number, size = 930, W = 1600, H = 1200, f = 1500): [number, number][] {
  const t = (tilt * Math.PI) / 180;
  const s = (spin * Math.PI) / 180;
  const hh = size / 2;
  const hw = hh / Math.SQRT2;
  const corners: [number, number][] = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  return corners.map(([x, y]) => {
    const rx = x * Math.cos(s) - y * Math.sin(s);
    const ry = x * Math.sin(s) + y * Math.cos(s);
    const cy = ry * Math.cos(t);
    const cz = f + ry * Math.sin(t);
    return [W / 2 + (rx * f) / cz, H / 2 + (cy * f) / cz];
  });
}

export const STRAIGHT = cameraView(0, 0);
export const PERSPECTIVE = cameraView(32, 4);
export const ROTATED = cameraView(10, 22, 820);
