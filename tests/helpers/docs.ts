// Realistic test documents: two versions of a service agreement, with known differences.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

type Block = { text: string; size?: number; bold?: boolean; gap?: number };

const V1: Block[] = [
  { text: "SERVICE AGREEMENT", size: 18, bold: true, gap: 10 },
  { text: "Agreement No. SA-2047" },
  { text: "This agreement is made on 12.03.2026 between Acme Industries SRL, Strada Lalelelor 14, Cluj-Napoca, Romania, and Northwind Consulting Ltd, 221 Baker Street, London, United Kingdom." },
  { text: "1. Services", size: 13, bold: true },
  { text: "Northwind Consulting will provide monthly reporting and quarterly audits for the finance department of Acme Industries." },
  { text: "2. Payment", size: 13, bold: true },
  { text: "Acme Industries pays a fee of 4,500 EUR per month, within 30 days of each invoice." },
  { text: "Late payments carry a penalty of 0.5% per day of delay." },
  { text: "3. Term", size: 13, bold: true },
  { text: "The agreement starts on 01.04.2026 and ends on 31.03.2027." },
  { text: "Contact: legal@northwind.example, +44 20 7946 0958. Signed by Maria Popescu for Acme Industries and John Carter for Northwind Consulting." },
];

const V2: Block[] = [
  { text: "SERVICE AGREEMENT", size: 22, bold: true, gap: 10 },
  V1[1],
  V1[2],
  V1[3],
  { text: "Northwind Consulting will provide monthly reporting, quarterly audits and tax advice for the finance department of Acme Industries." },
  V1[5],
  { text: "Acme Industries pays a fee of 5,200 EUR per month, within 15 days of each invoice." },
  V1[8],
  { text: "The agreement starts on 01.05.2026 and ends on 30.04.2027." },
  { text: "Either party may terminate this agreement with 60 days' written notice." },
  V1[10],
];

/** A one-page agreement; version 2 has a changed heading size, rewording, new amounts and dates, one paragraph removed and one added. */
export async function makeAgreement(version: 1 | 2): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Service agreement v${version}`);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595.28, 841.89]);
  let y = 780;
  for (const b of version === 1 ? V1 : V2) {
    const size = b.size ?? 11;
    const font = b.bold ? bold : regular;
    // wrap by width so each block is a real multi-line paragraph
    const words = b.text.split(" ");
    let line = "";
    const lines: string[] = [];
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) > 480 && line) {
        lines.push(line);
        line = w;
      } else line = next;
    }
    lines.push(line);
    for (const l of lines) {
      page.drawText(l, { x: 56, y, size, font, color: rgb(0.1, 0.1, 0.12) });
      y -= size * 1.35;
    }
    y -= 14 + (b.gap ?? 0);
  }
  return doc.save();
}

/** A long report: `pages` pages of filler, with one distinctive topic on page `special`. */
export async function makeLongReport(pages: number, special: number, topic: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    const page = doc.addPage([595.28, 841.89]);
    page.drawText(`Annual report, page ${i}`, { x: 56, y: 780, size: 14, font });
    const body = i === special ? `This page covers the ${topic}, which is described only here.` : "Operations continued as planned during this period with no notable events.";
    page.drawText(body, { x: 56, y: 740, size: 11, font });
  }
  return doc.save();
}
