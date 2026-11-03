import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { execFileSync } from "node:child_process";
import { loadCv, makeScene, PERSPECTIVE, ROTATED, STRAIGHT } from "../helpers/scenes";

export const SCANNER_DIR = path.resolve("tests/fixtures/generated/scanner");

const jpeg = (img: { data: Uint8ClampedArray; width: number; height: number }) =>
  sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), { raw: { width: img.width, height: img.height, channels: 4 } })
    .removeAlpha()
    .jpeg({ quality: 92, chromaSubsampling: "4:2:0" })
    .toBuffer();

export default async function setup() {
  if (!fs.existsSync(path.resolve("tests/fixtures/generated/text-5pages.pdf"))) {
    execFileSync(process.execPath, ["scripts/make-fixtures.mjs"], { stdio: "inherit" });
  }
  fs.mkdirSync(SCANNER_DIR, { recursive: true });
  const cv = await loadCv();
  // a Romanian letter photographed on a light desk under dim light, for OCR in Romanian
  if (!fs.existsSync(path.join(SCANNER_DIR, "photo-romanian.jpg"))) {
    const ro = await makeScene(cv, { corners: STRAIGHT, background: "light", exposure: 0.8, romanian: true, seed: 11 });
    fs.writeFileSync(path.join(SCANNER_DIR, "photo-romanian.jpg"), await jpeg(ro.image));
  }
  if (fs.existsSync(path.join(SCANNER_DIR, "camera.mjpeg"))) return;

  // footage for Chromium's fake camera: a page lying on a desk
  const scene = await makeScene(cv, { corners: PERSPECTIVE });
  const frame = await jpeg(scene.image);
  fs.writeFileSync(path.join(SCANNER_DIR, "camera.mjpeg"), Buffer.concat(Array.from({ length: 10 }, () => frame)));
  fs.writeFileSync(path.join(SCANNER_DIR, "photo-desk.jpg"), frame);

  const second = await makeScene(cv, { corners: ROTATED, background: "gray", shadow: 0.4 });
  fs.writeFileSync(path.join(SCANNER_DIR, "photo-rotated.jpg"), await jpeg(second.image));

  // a photo with no page at all: forces manual corners
  const W = 1200;
  const H = 900;
  const plain = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    plain[i * 4] = 92 + (i % 9);
    plain[i * 4 + 1] = 60 + (i % 7);
    plain[i * 4 + 2] = 38 + (i % 5);
    plain[i * 4 + 3] = 255;
  }
  fs.writeFileSync(path.join(SCANNER_DIR, "photo-no-page.jpg"), await jpeg({ data: plain, width: W, height: H }));
}
