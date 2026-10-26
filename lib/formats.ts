// Client-safe description of every file format Paperflow recognises.

export type FormatId =
  | "pdf"
  | "jpg"
  | "png"
  | "webp"
  | "tiff"
  | "gif"
  | "bmp"
  | "svg"
  | "docx"
  | "doc"
  | "pptx"
  | "ppt"
  | "xlsx"
  | "xls"
  | "odt"
  | "ods"
  | "odp"
  | "rtf"
  | "html"
  | "md"
  | "txt"
  | "csv"
  | "zip"
  | "json";

export type FormatKind = "pdf" | "image" | "document" | "presentation" | "spreadsheet" | "text" | "archive";

export interface FormatInfo {
  id: FormatId;
  label: string;
  ext: string;
  mime: string;
  kind: FormatKind;
  /** Extra filename extensions accepted for this format. */
  aliases?: string[];
}

export const FORMATS: Record<FormatId, FormatInfo> = {
  pdf: { id: "pdf", label: "PDF", ext: "pdf", mime: "application/pdf", kind: "pdf" },
  jpg: { id: "jpg", label: "JPG", ext: "jpg", mime: "image/jpeg", kind: "image", aliases: ["jpeg", "jfif"] },
  png: { id: "png", label: "PNG", ext: "png", mime: "image/png", kind: "image" },
  webp: { id: "webp", label: "WebP", ext: "webp", mime: "image/webp", kind: "image" },
  tiff: { id: "tiff", label: "TIFF", ext: "tiff", mime: "image/tiff", kind: "image", aliases: ["tif"] },
  gif: { id: "gif", label: "GIF", ext: "gif", mime: "image/gif", kind: "image" },
  bmp: { id: "bmp", label: "BMP", ext: "bmp", mime: "image/bmp", kind: "image" },
  svg: { id: "svg", label: "SVG", ext: "svg", mime: "image/svg+xml", kind: "image" },
  docx: {
    id: "docx",
    label: "Word",
    ext: "docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    kind: "document",
  },
  doc: { id: "doc", label: "Word 97", ext: "doc", mime: "application/msword", kind: "document" },
  pptx: {
    id: "pptx",
    label: "PowerPoint",
    ext: "pptx",
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    kind: "presentation",
  },
  ppt: { id: "ppt", label: "PowerPoint 97", ext: "ppt", mime: "application/vnd.ms-powerpoint", kind: "presentation" },
  xlsx: {
    id: "xlsx",
    label: "Excel",
    ext: "xlsx",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    kind: "spreadsheet",
  },
  xls: { id: "xls", label: "Excel 97", ext: "xls", mime: "application/vnd.ms-excel", kind: "spreadsheet" },
  odt: { id: "odt", label: "ODT", ext: "odt", mime: "application/vnd.oasis.opendocument.text", kind: "document" },
  ods: { id: "ods", label: "ODS", ext: "ods", mime: "application/vnd.oasis.opendocument.spreadsheet", kind: "spreadsheet" },
  odp: { id: "odp", label: "ODP", ext: "odp", mime: "application/vnd.oasis.opendocument.presentation", kind: "presentation" },
  rtf: { id: "rtf", label: "RTF", ext: "rtf", mime: "application/rtf", kind: "document" },
  html: { id: "html", label: "HTML", ext: "html", mime: "text/html", kind: "text", aliases: ["htm"] },
  md: { id: "md", label: "Markdown", ext: "md", mime: "text/markdown", kind: "text", aliases: ["markdown"] },
  txt: { id: "txt", label: "Text", ext: "txt", mime: "text/plain", kind: "text" },
  csv: { id: "csv", label: "CSV", ext: "csv", mime: "text/csv", kind: "spreadsheet" },
  zip: { id: "zip", label: "ZIP", ext: "zip", mime: "application/zip", kind: "archive" },
  json: { id: "json", label: "JSON", ext: "json", mime: "application/json", kind: "text" },
};

/** Formats accepted for upload (zip/json/svg are outputs only). */
export const UPLOADABLE: FormatId[] = [
  "pdf", "jpg", "png", "webp", "tiff", "gif", "bmp",
  "docx", "doc", "pptx", "ppt", "xlsx", "xls", "odt", "ods", "odp", "rtf",
  "html", "md", "txt", "csv",
];

export const IMAGE_INPUTS: FormatId[] = ["jpg", "png", "webp", "tiff", "gif", "bmp"];
export const OFFICE_INPUTS: FormatId[] = ["docx", "doc", "pptx", "ppt", "xlsx", "xls", "odt", "ods", "odp", "rtf"];
export const TEXT_INPUTS: FormatId[] = ["html", "md", "txt", "csv"];

export function formatFromExtension(name: string): FormatId | null {
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  for (const f of Object.values(FORMATS)) {
    if (f.ext === ext || f.aliases?.includes(ext)) return f.id;
  }
  return null;
}

export function acceptAttr(formats: FormatId[]): string {
  return formats
    .flatMap((f) => [FORMATS[f].mime, `.${FORMATS[f].ext}`, ...(FORMATS[f].aliases ?? []).map((a) => `.${a}`)])
    .join(",");
}
