// Rebuilds editable Word paragraphs from a PDF's text layer (no layout reconstruction).
import { Document, Packer, Paragraph, TextRun, HeadingLevel, PageBreak } from "docx";
import { openDoc, structuredPage, type TextBlock } from "@/lib/pdf/mu";
import { UserError, throwIfAborted } from "@/lib/server/errors";

function median(values: number[]): number {
  if (!values.length) return 11;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function blockText(b: TextBlock): string {
  let out = "";
  b.lines.forEach((l, i) => {
    const t = l.text.replace(/\s+$/, "");
    if (i === 0) out = t;
    else if (/[A-Za-zÀ-ž]-$/.test(out)) out = out.slice(0, -1) + t.trimStart(); // re-join hyphenated words
    else out += " " + t.trimStart();
  });
  return out.replace(/\s{2,}/g, " ").trim();
}

export async function pdfToDocx(bytes: Uint8Array, signal?: AbortSignal, onPage?: (i: number, n: number) => void): Promise<{ bytes: Uint8Array; chars: number }> {
  const doc = openDoc(bytes);
  const n = doc.countPages();
  const pages = [];
  for (let i = 0; i < n; i++) {
    throwIfAborted(signal);
    pages.push(structuredPage(doc, i));
    onPage?.(i + 1, n);
  }
  const body = median(pages.flatMap((p) => p.blocks.flatMap((b) => b.lines.map((l) => l.size))));
  const children: Paragraph[] = [];
  let chars = 0;
  pages.forEach((p, pi) => {
    // reading order: top-to-bottom, then left-to-right for blocks on the same band
    const blocks = [...p.blocks].sort((a, b) => (Math.abs(a.y - b.y) < 4 ? a.x - b.x : a.y - b.y));
    blocks.forEach((b) => {
      const text = blockText(b);
      if (!text) return;
      chars += text.length;
      const size = median(b.lines.map((l) => l.size));
      const bold = b.lines.every((l) => l.bold);
      const italic = b.lines.every((l) => l.italic);
      const heading =
        size >= body * 1.6 ? HeadingLevel.HEADING_1 : size >= body * 1.25 ? HeadingLevel.HEADING_2 : bold && text.length < 90 && size > body ? HeadingLevel.HEADING_3 : undefined;
      children.push(
        new Paragraph({
          heading,
          spacing: { after: 120 },
          children: [new TextRun({ text, bold: heading ? undefined : bold, italics: italic, size: heading ? undefined : Math.round(size * 2) })],
        }),
      );
    });
    if (pi < pages.length - 1) children.push(new Paragraph({ children: [new PageBreak()] }));
  });
  if (chars === 0) {
    throw new UserError("This PDF has no text layer (it's probably a scan). Run OCR PDF first, then convert.", "no_text");
  }
  const first = pages[0];
  const document = new Document({
    creator: "Paperflow",
    sections: [
      {
        properties: {
          page: { size: { width: Math.round(first.width * 20), height: Math.round(first.height * 20) } },
        },
        children,
      },
    ],
  });
  return { bytes: new Uint8Array(await Packer.toBuffer(document)), chars };
}
