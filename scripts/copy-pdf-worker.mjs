// Copies browser assets that live in node_modules into public/:
//  - the PDF.js worker (same-origin worker script)
//  - DejaVu fonts, so editor overlays render with exactly the font the export embeds
import { copyFileSync, cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
mkdirSync("public/fonts", { recursive: true });
try {
  const pkg = dirname(require.resolve("pdfjs-dist/package.json"));
  const src = join(pkg, "build", "pdf.worker.min.mjs");
  if (existsSync(src)) copyFileSync(src, join("public", "pdf.worker.min.mjs"));
  // non-embedded standard fonts, CJK CMaps, ICC profiles and image decoders, served same-origin
  for (const dir of ["standard_fonts", "cmaps", "iccs", "wasm"]) {
    if (existsSync(join(pkg, dir))) cpSync(join(pkg, dir), join("public", "pdfjs", dir), { recursive: true });
  }
} catch {
  // pdfjs-dist not installed yet
}
// OpenCV.js for the document scanner, served same-origin and loaded only inside its Web Worker
try {
  const cv = join(dirname(require.resolve("@techstark/opencv-js/package.json")), "dist", "opencv.js");
  mkdirSync(join("public", "opencv"), { recursive: true });
  if (existsSync(cv)) copyFileSync(cv, join("public", "opencv", "opencv.js"));
} catch {
  // not installed yet
}
// Tesseract OCR for the scanner: worker, LSTM engine builds and English/Romanian data, all same-origin
try {
  const out = join("public", "tesseract");
  mkdirSync(join(out, "lang"), { recursive: true });
  copyFileSync(join(dirname(require.resolve("tesseract.js/package.json")), "dist", "worker.min.js"), join(out, "worker.min.js"));
  const core = dirname(require.resolve("tesseract.js-core/package.json"));
  for (const f of ["tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js", "tesseract-core-relaxedsimd-lstm.wasm.js"]) copyFileSync(join(core, f), join(out, f));
  for (const lang of ["eng", "ron"]) {
    const src = join(dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`)), "4.0.0_best_int", `${lang}.traineddata.gz`);
    if (existsSync(src)) copyFileSync(src, join(out, "lang", `${lang}.traineddata.gz`));
  }
} catch {
  // not installed yet
}
const fonts = join("node_modules", "dejavu-fonts-ttf", "ttf");
for (const f of ["DejaVuSans.ttf", "DejaVuSans-Bold.ttf", "DejaVuSerif.ttf", "DejaVuSerif-Bold.ttf", "DejaVuSansMono.ttf", "DejaVuSansMono-Bold.ttf"]) {
  if (existsSync(join(fonts, f))) copyFileSync(join(fonts, f), join("public", "fonts", f));
}
