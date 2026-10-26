import sharp, { type Sharp } from "sharp";
import { UserError } from "@/lib/server/errors";
import type { ImagePage } from "@/lib/pdf/ops";

// Decompression-bomb guard: refuse images above ~120 MP.
const LIMIT = 120_000_000;

function open(bytes: Uint8Array) {
  return sharp(bytes, { limitInputPixels: LIMIT, failOn: "error" });
}

export async function imageMeta(bytes: Uint8Array) {
  try {
    return await open(bytes).metadata();
  } catch {
    throw new UserError("This image couldn't be decoded. It may be damaged or use an unsupported variant.", "bad_image");
  }
}

/** Prepares an image for embedding: applies EXIF orientation and picks JPEG (photos) or PNG (alpha / lossless). */
export async function imageForPdf(bytes: Uint8Array): Promise<ImagePage> {
  const meta = await imageMeta(bytes);
  const upright = !meta.orientation || meta.orientation === 1;
  if (meta.format === "jpeg" && upright && meta.space !== "cmyk") return { bytes, kind: "jpg" };
  if (meta.format === "png" && upright) return { bytes, kind: "png" };
  const img = open(bytes).rotate();
  if (meta.hasAlpha || meta.format === "png" || meta.format === "gif") return { bytes: new Uint8Array(await img.png().toBuffer()), kind: "png" };
  return { bytes: new Uint8Array(await img.toColourspace("srgb").jpeg({ quality: 92, mozjpeg: true }).toBuffer()), kind: "jpg" };
}

export type RasterTarget = "jpg" | "png" | "webp" | "tiff";

export async function encodeRaster(input: Sharp, to: RasterTarget, dpi?: number): Promise<Uint8Array> {
  let s = input;
  if (dpi) s = s.withMetadata({ density: dpi });
  switch (to) {
    case "jpg":
      s = s.flatten({ background: "#ffffff" }).jpeg({ quality: 88, mozjpeg: true });
      break;
    case "png":
      s = s.png({ compressionLevel: 8 });
      break;
    case "webp":
      s = s.webp({ quality: 85 });
      break;
    case "tiff":
      s = s.tiff({ compression: "lzw" });
      break;
  }
  return new Uint8Array(await s.toBuffer());
}

export async function convertImage(bytes: Uint8Array, to: RasterTarget): Promise<Uint8Array> {
  await imageMeta(bytes);
  return encodeRaster(open(bytes).rotate(), to);
}
