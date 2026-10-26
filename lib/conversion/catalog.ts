// Client-safe conversion registry: which source -> target pairs exist and which engine runs them.
// Server implementations are registered against these ids in lib/conversion/registry.ts.
import { IMAGE_INPUTS, type FormatId } from "@/lib/formats";

export type Engine = "libreoffice" | "mupdf" | "sharp" | "pdf-lib" | "docx";

export interface ConversionDef {
  id: string;
  from: FormatId[];
  to: FormatId;
  engine: Engine;
  /** Optional system dependency; the conversion reports "unavailable" when missing. */
  requires?: "libreoffice";
  /** Honest description of fidelity limits, shown in the UI. */
  note?: string;
  /** One output per page (zipped by the UI when there are several). */
  perPage?: boolean;
}

const OFFICE_DOCS: FormatId[] = ["docx", "doc", "odt", "rtf"];
const OFFICE_SLIDES: FormatId[] = ["pptx", "ppt", "odp"];
const OFFICE_SHEETS: FormatId[] = ["xlsx", "xls", "ods"];

export const CONVERSIONS: ConversionDef[] = [
  {
    id: "document-to-pdf",
    from: OFFICE_DOCS,
    to: "pdf",
    engine: "libreoffice",
    requires: "libreoffice",
    note: "Rendered by LibreOffice. Fonts not installed on the server are substituted with metric-compatible fonts where available.",
  },
  {
    id: "slides-to-pdf",
    from: OFFICE_SLIDES,
    to: "pdf",
    engine: "libreoffice",
    requires: "libreoffice",
    note: "One page per slide. Animations and transitions are not represented in PDF.",
  },
  {
    id: "sheet-to-pdf",
    from: OFFICE_SHEETS,
    to: "pdf",
    engine: "libreoffice",
    requires: "libreoffice",
    note: "Uses each sheet's print ranges and page setup. Very wide sheets may span several pages.",
  },
  {
    id: "csv-to-pdf",
    from: ["csv"],
    to: "pdf",
    engine: "libreoffice",
    requires: "libreoffice",
    note: "Parsed as UTF-8, comma separated, then laid out as a spreadsheet.",
  },
  { id: "text-to-pdf", from: ["txt"], to: "pdf", engine: "libreoffice", requires: "libreoffice", note: "Plain UTF-8 text." },
  {
    id: "html-to-pdf",
    from: ["html"],
    to: "pdf",
    engine: "libreoffice",
    requires: "libreoffice",
    note: "Scripts are removed and remote resources are not fetched. Complex CSS layouts are approximated.",
  },
  {
    id: "markdown-to-pdf",
    from: ["md"],
    to: "pdf",
    engine: "libreoffice",
    requires: "libreoffice",
    note: "Markdown is rendered to HTML (CommonMark + GitHub tables) and laid out by LibreOffice.",
  },
  {
    id: "image-to-pdf",
    from: IMAGE_INPUTS,
    to: "pdf",
    engine: "sharp",
    note: "Each image becomes one page. Use Images to PDF to combine several images into one document.",
  },
  ...(["jpg", "png", "webp", "tiff"] as FormatId[]).map<ConversionDef>((to) => ({
    id: `pdf-to-${to}`,
    from: ["pdf"],
    to,
    engine: "mupdf",
    perPage: true,
    note: "Each page is rendered as an image at the chosen resolution.",
  })),
  {
    id: "pdf-to-svg",
    from: ["pdf"],
    to: "svg",
    engine: "mupdf",
    perPage: true,
    note: "Vector output, one SVG per page. Text is converted to glyph outlines.",
  },
  { id: "pdf-to-txt", from: ["pdf"], to: "txt", engine: "mupdf", note: "Extracts the text layer. Scanned pages need OCR first." },
  {
    id: "pdf-to-html",
    from: ["pdf"],
    to: "html",
    engine: "mupdf",
    note: "Absolutely positioned text that mirrors the page layout. Images are embedded.",
  },
  {
    id: "pdf-to-docx",
    from: ["pdf"],
    to: "docx",
    engine: "docx",
    note: "Rebuilds editable paragraphs and headings from the text layer. Images, columns and tables are not reconstructed. Choose 'Exact layout' to keep positions via LibreOffice.",
  },
  ...(["jpg", "png", "webp", "tiff"] as FormatId[]).map<ConversionDef>((to) => ({
    id: `image-to-${to}`,
    from: IMAGE_INPUTS.filter((f) => f !== to),
    to,
    engine: "sharp",
    note: "Multi-frame images (animated GIF, multi-page TIFF) use the first frame.",
  })),
];

export function conversionsFrom(format: FormatId): ConversionDef[] {
  return CONVERSIONS.filter((c) => c.from.includes(format));
}

export function findConversion(from: FormatId, to: FormatId): ConversionDef | undefined {
  return CONVERSIONS.find((c) => c.from.includes(from) && c.to === to);
}
