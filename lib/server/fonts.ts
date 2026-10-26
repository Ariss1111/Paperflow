import fs from "node:fs";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import type { PDFDocument, PDFFont } from "pdf-lib";

// DejaVu covers Latin (incl. Central/Eastern European diacritics), Greek and Cyrillic,
// so overlays and stamps are not limited to the WinAnsi standard fonts.
export type FontFamily = "sans" | "serif" | "mono";
const FILES: Record<FontFamily, { regular: string; bold: string }> = {
  sans: { regular: "DejaVuSans.ttf", bold: "DejaVuSans-Bold.ttf" },
  serif: { regular: "DejaVuSerif.ttf", bold: "DejaVuSerif-Bold.ttf" },
  mono: { regular: "DejaVuSansMono.ttf", bold: "DejaVuSansMono-Bold.ttf" },
};

const cache = new Map<string, Uint8Array>();

function fontDir(): string {
  const candidates = [
    path.join(process.cwd(), "node_modules", "dejavu-fonts-ttf", "ttf"),
    path.join(process.cwd(), "..", "node_modules", "dejavu-fonts-ttf", "ttf"),
  ];
  const dir = candidates.find((d) => fs.existsSync(d));
  if (!dir) throw new Error("DejaVu fonts not found; run npm install");
  return dir;
}

export function fontBytes(family: FontFamily = "sans", bold = false): Uint8Array {
  const file = FILES[family][bold ? "bold" : "regular"];
  let bytes = cache.get(file);
  if (!bytes) {
    bytes = new Uint8Array(fs.readFileSync(path.join(fontDir(), file)));
    cache.set(file, bytes);
  }
  return bytes;
}

export async function embedFont(doc: PDFDocument, family: FontFamily = "sans", bold = false): Promise<PDFFont> {
  doc.registerFontkit(fontkit);
  return doc.embedFont(fontBytes(family, bold), { subset: true });
}

/** Removes characters the font cannot draw (e.g. emoji) instead of failing the whole job. */
export function drawable(font: PDFFont, text: string): { text: string; dropped: number } {
  const set = new Set(font.getCharacterSet());
  let dropped = 0;
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (ch === "\n" || set.has(cp)) out += ch;
    else dropped++;
  }
  return { text: out, dropped };
}
