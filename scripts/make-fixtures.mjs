// Generates the sample document set used by tests and manual QA: tests/fixtures/generated/
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";
import * as mupdf from "mupdf";
import sharp from "sharp";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell } from "docx";
import PptxGenJS from "pptxgenjs";
import ExcelJS from "exceljs";

const OUT = path.resolve("tests/fixtures/generated");
fs.mkdirSync(OUT, { recursive: true });
const w = (name, data) => fs.writeFileSync(path.join(OUT, name), data);

const LOREM =
  "Paperflow keeps documents precise. This paragraph exists so that text extraction, search and comparison have real content to work with across several lines of a page.";

// ---------------------------------------------------------------- PDFs
async function textPdf(pages, { title = "Sample", rotateSecond = false, marker = "PAGE" } = {}) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setAuthor("Paperflow Fixtures");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let i = 1; i <= pages; i++) {
    const landscape = i === 3;
    const page = doc.addPage(landscape ? [842, 595] : [595, 842]);
    const h = page.getHeight();
    page.drawText(`${marker} ${i}`, { x: 56, y: h - 80, size: 28, font: bold });
    page.drawText(`${title} — page ${i} of ${pages}`, { x: 56, y: h - 110, size: 12, font, color: rgb(0.4, 0.4, 0.4) });
    LOREM.match(/.{1,80}(\s|$)/g).forEach((line, k) => page.drawText(line.trim(), { x: 56, y: h - 150 - k * 16, size: 11, font }));
    if (rotateSecond && i === 2) page.setRotation(degrees(90));
  }
  return doc.save();
}

w("text-5pages.pdf", await textPdf(5, { title: "Five Page Report", rotateSecond: true }));
w("text-3pages.pdf", await textPdf(3, { title: "Three Page Memo", marker: "MEMO" }));
w("text-1page.pdf", await textPdf(1, { title: "Single" }));

// A modified copy for Compare
{
  const doc = await PDFDocument.load(fs.readFileSync(path.join(OUT, "text-3pages.pdf")));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.getPage(1).drawText("An added sentence on page two.", { x: 56, y: 300, size: 14, font, color: rgb(0.8, 0, 0) });
  w("text-3pages-changed.pdf", await doc.save());
}

// With a blank page in the middle
{
  const doc = await PDFDocument.load(fs.readFileSync(path.join(OUT, "text-3pages.pdf")));
  doc.insertPage(1, [595, 842]);
  w("with-blank.pdf", await doc.save());
}

// Image-heavy PDF (large lossless photo-like image) for compression
{
  const W = 2400, H = 1800;
  const raw = Buffer.alloc(W * H * 3);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const k = (y * W + x) * 3;
      const n = rnd() * 40;
      raw[k] = Math.min(255, (x / W) * 200 + n);
      raw[k + 1] = Math.min(255, (y / H) * 180 + n);
      raw[k + 2] = Math.min(255, 120 + Math.sin(x / 60) * 60 + n);
    }
  const png = await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
  w("photo.png", png);
  const doc = await PDFDocument.create();
  const img = await doc.embedPng(png);
  for (let i = 0; i < 2; i++) {
    const page = doc.addPage([595, 842]);
    page.drawImage(img, { x: 40, y: 300, width: 515, height: 386 });
    page.drawText(`Photo page ${i + 1}`, { x: 40, y: 760, size: 20, font: await doc.embedFont(StandardFonts.Helvetica) });
  }
  w("image-heavy.pdf", await doc.save());
  await sharp(png).resize(1200).jpeg({ quality: 85 }).toFile(path.join(OUT, "photo.jpg"));
  await sharp(png).resize(800).webp().toFile(path.join(OUT, "photo.webp"));
  await sharp(png).resize(600).tiff().toFile(path.join(OUT, "photo.tiff"));
  // PNG with alpha
  await sharp({ create: { width: 400, height: 300, channels: 4, background: { r: 0, g: 113, b: 227, alpha: 0.5 } } })
    .png()
    .toFile(path.join(OUT, "alpha.png"));
}

// Scanned PDF: an image-only page of rendered text (no text layer) for OCR
{
  const src = mupdf.Document.openDocument(await textPdf(1, { title: "Scanned Invoice", marker: "INVOICE" }), "application/pdf");
  const pix = src.loadPage(0).toPixmap(mupdf.Matrix.scale(200 / 72, 200 / 72), mupdf.ColorSpace.DeviceGray, false, true);
  const png = Buffer.from(pix.asPNG());
  w("scan.png", png);
  const doc = await PDFDocument.create();
  const img = await doc.embedPng(png);
  const page = doc.addPage([595, 842]);
  page.drawImage(img, { x: 0, y: 0, width: 595, height: 842 });
  w("scanned.pdf", await doc.save());
}

// Fillable form
{
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const form = doc.getForm();
  page.drawText("Application form", { x: 56, y: 780, size: 20, font });
  page.drawText("Full name", { x: 56, y: 730, size: 11, font });
  form.createTextField("fullName").addToPage(page, { x: 160, y: 720, width: 300, height: 22 });
  page.drawText("Subscribe", { x: 56, y: 690, size: 11, font });
  form.createCheckBox("subscribe").addToPage(page, { x: 160, y: 685, width: 16, height: 16 });
  page.drawText("Country", { x: 56, y: 650, size: 11, font });
  const dd = form.createDropdown("country");
  dd.addOptions(["Romania", "Germany", "Japan"]);
  dd.addToPage(page, { x: 160, y: 640, width: 200, height: 22 });
  w("form.pdf", await doc.save());
}

// Encrypted (user password "secret") — via MuPDF
{
  const d = mupdf.Document.openDocument(fs.readFileSync(path.join(OUT, "text-1page.pdf")), "application/pdf").asPDF();
  w("encrypted.pdf", d.saveToBuffer({ encrypt: "aes-256", "user-password": "secret", "owner-password": "owner-secret" }).asUint8Array());
  // Opens without a password but restricts copying/editing (owner password only)
  w("restricted.pdf", d.saveToBuffer({ encrypt: "aes-128", "user-password": "", "owner-password": "owner-secret", permissions: -3904 | 4 }).asUint8Array());
}

// Damaged: valid content but broken cross-reference table (recoverable)
{
  const good = Buffer.from(fs.readFileSync(path.join(OUT, "text-3pages.pdf")));
  const s = good.toString("latin1");
  const at = s.lastIndexOf("startxref");
  const broken = s.slice(0, at) + "startxref\n999999\n%%EOF\n";
  w("damaged-xref.pdf", Buffer.from(broken, "latin1"));
}
// Unrecoverable: PDF header followed by noise
w("garbage.pdf", Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.from(Array.from({ length: 4000 }, (_, i) => (i * 7919) % 256))]));
w("empty.pdf", Buffer.alloc(0));
// Wrong extension: a PNG named .pdf and a PDF named .docx
fs.copyFileSync(path.join(OUT, "alpha.png"), path.join(OUT, "image-named.pdf"));
fs.copyFileSync(path.join(OUT, "text-1page.pdf"), path.join(OUT, "pdf-named.docx"));
// Unsupported binary
w("program.exe", Buffer.concat([Buffer.from("MZ"), Buffer.alloc(2000, 1)]));

// ---------------------------------------------------------------- Office & text
{
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: "Quarterly Report", heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ children: [new TextRun("Revenue grew in every region. "), new TextRun({ text: "Diacritics: ăâîșț ĂÂÎȘȚ.", bold: true })] }),
          new Table({
            rows: [
              new TableRow({ children: ["Region", "Q1", "Q2"].map((t) => new TableCell({ children: [new Paragraph(t)] })) }),
              new TableRow({ children: ["Europe", "120", "135"].map((t) => new TableCell({ children: [new Paragraph(t)] })) }),
            ],
          }),
          new Paragraph({ text: "Outlook", heading: HeadingLevel.HEADING_2 }),
          new Paragraph(LOREM),
        ],
      },
    ],
  });
  w("report.docx", await Packer.toBuffer(doc));
}
{
  const pptx = new PptxGenJS();
  for (let i = 1; i <= 3; i++) {
    const s = pptx.addSlide();
    s.addText(`Slide ${i}`, { x: 0.5, y: 0.5, fontSize: 36, bold: true });
    s.addText("Presentation fixture for Paperflow", { x: 0.5, y: 1.5, fontSize: 18 });
  }
  w("deck.pptx", await pptx.write({ outputType: "nodebuffer" }));
}
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sales");
  ws.addRow(["Product", "Units", "Price"]);
  for (let i = 1; i <= 20; i++) ws.addRow([`Item ${i}`, i * 3, i * 9.5]);
  w("sales.xlsx", await wb.xlsx.writeBuffer());
}
w("data.csv", "Name,City,Score\nAna,Cluj,91\nBogdan,Iași,84\n\"Smith, J\",London,77\n");
w("notes.md", "# Meeting notes\n\n- First **point**\n- Second point\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```js\nconsole.log('hi')\n```\n");
w("page.html", '<!doctype html><html><head><title>Fixture</title><script>alert(1)</script></head><body><h1>HTML fixture</h1><p>Paragraph with <b>bold</b>.</p><img src="https://example.com/x.png"></body></html>');
w("plain.txt", "Plain text fixture.\nLine two with diacritics: ăâîșț.\n");
w("letter.rtf", "{\\rtf1\\ansi{\\fonttbl\\f0\\fswiss Helvetica;}\\f0\\pard Hello from {\\b RTF}.\\par}");
// Corrupted office file (DOCX signature but broken archive)
w("corrupt.docx", Buffer.concat([Buffer.from("PK\u0003\u0004"), Buffer.alloc(3000, 0x41)]));

// Legacy/ODF formats produced by LibreOffice when it's available
const soffice = [path.resolve(".tools/libreoffice/program/soffice.exe"), "/usr/bin/soffice"].find((p) => fs.existsSync(p));
if (soffice) {
  const profile = path.resolve(".data-lo-fixtures");
  for (const [src, fmt] of [["report.docx", "doc"], ["report.docx", "odt"], ["sales.xlsx", "xls"], ["sales.xlsx", "ods"], ["deck.pptx", "ppt"], ["deck.pptx", "odp"]]) {
    execFileSync(soffice, [`-env:UserInstallation=file:///${profile.replace(/\\/g, "/")}`, "--headless", "--norestore", "--convert-to", fmt, "--outdir", OUT, path.join(OUT, src)], { stdio: "ignore", timeout: 180000 });
  }
  fs.rmSync(profile, { recursive: true, force: true });
}

console.log("fixtures:", fs.readdirSync(OUT).join(", "));
