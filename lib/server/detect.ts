import "server-only";
import fsp from "node:fs/promises";
import { fileTypeFromBuffer } from "file-type";
import { formatFromExtension, UPLOADABLE, type FormatId } from "@/lib/formats";
import { UserError } from "./errors";

const MIME_TO_FORMAT: Record<string, FormatId> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/tiff": "tiff",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.oasis.opendocument.text": "odt",
  "application/vnd.oasis.opendocument.spreadsheet": "ods",
  "application/vnd.oasis.opendocument.presentation": "odp",
  "application/rtf": "rtf",
};

const TEXT_FORMATS: FormatId[] = ["txt", "md", "csv", "html"];

async function head(file: string, n: number): Promise<Buffer> {
  const fh = await fsp.open(file, "r");
  try {
    const buf = Buffer.alloc(n);
    const { bytesRead } = await fh.read(buf, 0, n, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

function looksLikeText(buf: Buffer): boolean {
  if (buf.includes(0)) return false;
  try {
    // trim a possibly split multi-byte sequence at the end of the sample
    new TextDecoder("utf-8", { fatal: true }).decode(buf.subarray(0, Math.max(0, buf.length - 4)));
    return true;
  } catch {
    return false;
  }
}

/**
 * Determines a file's real format from its content. The extension is only used to choose between
 * formats that share a container (OLE2: doc/xls/ppt) or that have no signature (plain text family).
 */
export async function detectFormat(file: string, originalName: string): Promise<FormatId> {
  const buf = await head(file, 64 * 1024);
  if (buf.length === 0) throw new UserError("This file is empty.", "empty_file");
  const claimed = formatFromExtension(originalName);

  if (buf.subarray(0, 1024).includes(Buffer.from("%PDF-"))) return "pdf";
  if (buf.subarray(0, 5).toString("latin1") === "{\\rtf") return "rtf";

  const ft = await fileTypeFromBuffer(buf);
  if (ft) {
    if (ft.mime === "application/x-cfb") {
      // Legacy Office binary formats share the OLE2 container; trust the extension among them.
      if (claimed === "doc" || claimed === "xls" || claimed === "ppt") return claimed;
      throw new UserError("This looks like a legacy Office file. Give it a .doc, .xls or .ppt extension.", "unsupported_format", 415);
    }
    const f = MIME_TO_FORMAT[ft.mime];
    if (f && UPLOADABLE.includes(f)) return f;
    if (ft.mime === "application/zip") {
      throw new UserError("This ZIP archive isn't a supported document. Office files must be valid DOCX/XLSX/PPTX/ODF.", "unsupported_format", 415);
    }
    throw new UserError(`Files of type ${ft.ext.toUpperCase()} aren't supported.`, "unsupported_format", 415);
  }

  if (looksLikeText(buf)) {
    if (claimed && TEXT_FORMATS.includes(claimed)) return claimed;
    if (/^\s*(<!doctype html|<html)/i.test(buf.subarray(0, 512).toString("utf8"))) return "html";
    if (claimed === "svg") throw new UserError("SVG uploads aren't accepted.", "unsupported_format", 415);
    return "txt";
  }
  throw new UserError("This file type isn't supported or the file is damaged.", "unsupported_format", 415);
}
