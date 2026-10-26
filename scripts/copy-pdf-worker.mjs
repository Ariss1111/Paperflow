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
const fonts = join("node_modules", "dejavu-fonts-ttf", "ttf");
for (const f of ["DejaVuSans.ttf", "DejaVuSans-Bold.ttf", "DejaVuSerif.ttf", "DejaVuSerif-Bold.ttf", "DejaVuSansMono.ttf", "DejaVuSansMono-Bold.ttf"]) {
  if (existsSync(join(fonts, f))) copyFileSync(join(fonts, f), join("public", "fonts", f));
}
