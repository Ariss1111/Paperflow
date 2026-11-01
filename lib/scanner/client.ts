"use client";
// Browser side of the scanner: talks to the vision worker and converts between images, canvases and blobs.
// Scans are processed entirely on this device; nothing is uploaded unless the user asks to keep editing.

export type Corners = [number, number][];
export type ScanMode = "original" | "color" | "gray" | "bw";

export interface ScanOptions {
  shadows: boolean;
  contrast: number; // 0..1
  readability: boolean;
  sharpen: boolean;
}

export interface RawImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface ScanPage {
  id: string;
  /** the captured photo, kept so crops and modes can be changed later */
  source: Blob;
  corners: Corners;
  detected: boolean;
  /** clockwise degrees */
  rotation: number;
  mode: ScanMode;
  options: ScanOptions;
  result?: Blob;
  resultUrl?: string;
  width?: number;
  height?: number;
}

export const MODE_DEFAULTS: Record<ScanMode, ScanOptions> = {
  original: { shadows: false, contrast: 0, readability: false, sharpen: false },
  color: { shadows: true, contrast: 0.2, readability: false, sharpen: true },
  gray: { shadows: true, contrast: 0.15, readability: false, sharpen: true },
  bw: { shadows: true, contrast: 0, readability: false, sharpen: false },
};

export const FULL_FRAME: Corners = [[0.03, 0.03], [0.97, 0.03], [0.97, 0.97], [0.03, 0.97]];
const MAX_SOURCE_SIDE = 4200;

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: never) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker("/scanner/worker.js");
  worker.onmessage = ({ data }) => {
    const p = pending.get(data.id);
    if (!p) return;
    pending.delete(data.id);
    if (data.error) p.reject(new Error(data.error));
    else p.resolve(data.result as never);
  };
  worker.onerror = () => {
    const err = new Error("The scanner engine couldn't start. Check your connection and reload the page.");
    pending.forEach((p) => p.reject(err));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

function rpc<T>(type: string, payload: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> {
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: never) => void, reject });
    getWorker().postMessage({ id, type, payload }, transfer);
  });
}

/** Loads the (roughly 13 MB) vision engine ahead of use. */
export const prepareVision = () => rpc<{ ok: boolean }>("ping", {});

export interface Detection {
  found: boolean;
  corners: Corners | null;
  score: number;
}

export function detectFrame(image: RawImage): Promise<Detection> {
  return rpc("detect", { image }, [image.data.buffer]);
}

let loadedKey: string | null = null;

/** Finds the page in a captured photo and the rotation that makes its text upright. */
export async function analyzePhoto(id: string, source: Blob): Promise<Detection & { rotation: number }> {
  const image = await decodeImage(source);
  loadedKey = id;
  return rpc("analyze", { key: id, image }, [image.data.buffer]);
}

async function ensureLoaded(page: Pick<ScanPage, "id" | "source">) {
  if (loadedKey === page.id) return;
  const image = await decodeImage(page.source);
  loadedKey = page.id;
  await rpc("load", { key: page.id, image }, [image.data.buffer]);
}

/** Runs crop → enhancement → rotation. `maxSide` produces a faster, smaller preview. */
export async function renderPage(page: Pick<ScanPage, "id" | "source" | "corners" | "rotation" | "mode" | "options">, maxSide?: number): Promise<RawImage> {
  await ensureLoaded(page);
  return rpc("render", { key: page.id, corners: page.corners, rotation: page.rotation, mode: page.mode, options: page.options, maxSide });
}

// ---------------------------------------------------------------- images

export async function decodeImage(blob: Blob, maxSide = MAX_SOURCE_SIDE): Promise<RawImage> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(blob); // honours EXIF orientation
  } catch {
    throw new Error("This image couldn't be read. Try a JPG, PNG or WebP photo.");
  }
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const width = Math.round(bmp.width * k);
  const height = Math.round(bmp.height * k);
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, width, height);
  bmp.close();
  const d = ctx.getImageData(0, 0, width, height);
  return { data: d.data, width, height };
}

export function encodeImage(img: RawImage, mode: ScanMode): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  // JPEG would smear crisp black-and-white text; PNG compresses it very well anyway
  const [type, q] = mode === "bw" ? ["image/png", undefined] : ["image/jpeg", 0.88];
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("The page couldn't be encoded."))), type, q));
}

export function newPageId() {
  return `scan-${Date.now().toString(36)}-${(++seq).toString(36)}`;
}

/** True when the four points form a usable page outline. */
export function isValidQuad(q: Corners): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [a, b, c] = [q[i], q[(i + 1) % 4], q[(i + 2) % 4]];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) < 1e-5) return false;
    if (sign && Math.sign(cross) !== sign) return false;
    sign = Math.sign(cross);
  }
  return true;
}
