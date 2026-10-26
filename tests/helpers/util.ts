import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import * as mupdf from "mupdf";

export const FIX = path.resolve("tests/fixtures/generated");
export const fixture = (name: string): Uint8Array<ArrayBuffer> => new Uint8Array(fs.readFileSync(path.join(FIX, name)));
export const fixturePath = (name: string) => path.join(FIX, name);

/** Opens output bytes with MuPDF — an independent check that the file is a valid PDF. */
export function reopen(bytes: Uint8Array, password?: string): mupdf.PDFDocument {
  const doc = mupdf.Document.openDocument(bytes, "application/pdf").asPDF() as mupdf.PDFDocument;
  if (password) doc.authenticatePassword(password);
  return doc;
}

export function pageTexts(bytes: Uint8Array): string[] {
  const doc = reopen(bytes);
  return Array.from({ length: doc.countPages() }, (_, i) => doc.loadPage(i).toStructuredText("preserve-whitespace").asText());
}

export function firstLines(bytes: Uint8Array): string[] {
  return pageTexts(bytes).map((t) => t.trim().split("\n")[0].trim());
}

export function isPdf(bytes: Uint8Array) {
  return Buffer.from(bytes.subarray(0, 5)).toString("latin1") === "%PDF-";
}

/** Minimal ZIP reader (local file headers) for checking DOCX / ZIP outputs. */
export function unzip(bytes: Uint8Array): Map<string, Buffer> {
  const buf = Buffer.from(bytes);
  const out = new Map<string, Buffer>();
  // use the central directory so data-descriptor entries (sizes after data) work too
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString("utf8");
    const lnlen = buf.readUInt16LE(local + 26);
    const lxlen = buf.readUInt16LE(local + 28);
    const data = buf.subarray(local + 30 + lnlen + lxlen, local + 30 + lnlen + lxlen + csize);
    out.set(name, method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data));
    p += 46 + nlen + xlen + clen;
  }
  return out;
}
