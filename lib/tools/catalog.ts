// Client-safe tool catalog. Each tool maps to exactly one server processor (lib/server/processors).
import { IMAGE_INPUTS, type FormatId } from "@/lib/formats";

export type ToolCategory = "organize" | "optimize" | "convert" | "edit" | "security" | "extract";

export const CATEGORIES: { id: ToolCategory; label: string; blurb: string }[] = [
  { id: "organize", label: "Organize", blurb: "Merge, split, reorder and rotate pages" },
  { id: "edit", label: "Edit & Sign", blurb: "Annotate, sign, stamp and fill" },
  { id: "convert", label: "Convert", blurb: "Office, images, text and back" },
  { id: "optimize", label: "Optimize", blurb: "Compress and repair" },
  { id: "security", label: "Security", blurb: "Passwords and metadata" },
  { id: "extract", label: "Extract & Analyze", blurb: "Text, images, OCR and compare" },
];

type Base = { key: string; label: string; hint?: string; showIf?: { key: string; in: string[] } };
export type ToolOption =
  | (Base & { type: "select" | "segmented"; options: { value: string; label: string }[]; default: string })
  | (Base & { type: "number"; min: number; max: number; step?: number; default: number; unit?: string })
  | (Base & { type: "text" | "textarea"; placeholder?: string; default?: string; required?: boolean; maxLength?: number })
  | (Base & { type: "password"; confirm?: boolean; required?: boolean })
  | (Base & { type: "checkbox"; default: boolean })
  | (Base & { type: "color"; default: string })
  | (Base & { type: "pages"; placeholder?: string; default?: string; required?: boolean });

export interface ToolDef {
  id: string;
  name: string;
  /** Short line shown on cards. */
  tagline: string;
  /** Longer explanation on the tool page. */
  description: string;
  category: ToolCategory;
  icon: string;
  accepts: FormatId[];
  minFiles: number;
  maxFiles: number;
  /** Order of inputs matters (drag to reorder). */
  ordered?: boolean;
  /** Server processor id; defaults to the tool id. */
  processor?: string;
  /** Options fixed by this tool (e.g. a conversion target). */
  fixed?: Record<string, string>;
  options?: ToolOption[];
  /** Special workspace UI. */
  ui?: "generic" | "editor" | "organize" | "fill-form" | "convert";
  requires?: "libreoffice";
  /** Label of the primary action button. */
  action: string;
  popular?: boolean;
  limitations?: string[];
}

const PAGES_ALL_HINT = "Leave empty for all pages. Example: 1-3, 5, 8-10";
const OFFICE_DOCS: FormatId[] = ["docx", "doc", "odt", "rtf"];
const POSITIONS = [
  { value: "bottom-center", label: "Bottom center" },
  { value: "bottom-right", label: "Bottom right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "top-center", label: "Top center" },
  { value: "top-right", label: "Top right" },
  { value: "top-left", label: "Top left" },
];

export const TOOLS: ToolDef[] = [
  // ---------------------------------------------------------------- organize
  {
    id: "merge",
    name: "Merge PDF",
    tagline: "Combine PDFs in the order you choose",
    description: "Combine several PDFs into one document. Drag files to set their order; every page keeps its size and orientation.",
    category: "organize",
    icon: "Combine",
    accepts: ["pdf"],
    minFiles: 2,
    maxFiles: 50,
    ordered: true,
    action: "Merge PDFs",
    popular: true,
  },
  {
    id: "split",
    name: "Split PDF",
    tagline: "Separate pages or ranges into new files",
    description: "Split a PDF by page ranges, into fixed-size chunks, or one file per page. Multiple results download as a ZIP.",
    category: "organize",
    icon: "Scissors",
    accepts: ["pdf"],
    minFiles: 1,
    maxFiles: 1,
    action: "Split PDF",
    popular: true,
    options: [
      {
        type: "segmented",
        key: "mode",
        label: "Split by",
        default: "ranges",
        options: [
          { value: "ranges", label: "Ranges" },
          { value: "every", label: "Every page" },
          { value: "chunks", label: "Fixed size" },
        ],
      },
      {
        type: "pages",
        key: "ranges",
        label: "Page ranges",
        placeholder: "1-3, 5, 8-10",
        hint: "Each comma-separated range becomes its own PDF.",
        required: true,
        showIf: { key: "mode", in: ["ranges"] },
      },
      { type: "checkbox", key: "mergeRanges", label: "Combine all ranges into a single PDF", default: false, showIf: { key: "mode", in: ["ranges"] } },
      { type: "number", key: "chunk", label: "Pages per file", min: 1, max: 1000, default: 2, showIf: { key: "mode", in: ["chunks"] } },
    ],
  },
  {
    id: "organize",
    name: "Organize Pages",
    tagline: "Reorder, rotate, duplicate and delete pages",
    description: "Rearrange pages visually. Drag thumbnails, rotate, duplicate or delete pages, insert pages from another PDF, then save.",
    category: "organize",
    icon: "LayoutGrid",
    accepts: ["pdf"],
    minFiles: 1,
    maxFiles: 10,
    ui: "organize",
    action: "Save PDF",
    popular: true,
  },
  {
    id: "rotate",
    name: "Rotate PDF",
    tagline: "Turn pages to the right orientation",
    description: "Rotate every page, or only the pages you list, by 90, 180 or 270 degrees.",
    category: "organize",
    icon: "RotateCw",
    accepts: ["pdf"],
    minFiles: 1,
    maxFiles: 20,
    action: "Rotate PDF",
    options: [
      {
        type: "segmented",
        key: "angle",
        label: "Rotation",
        default: "90",
        options: [
          { value: "90", label: "90° right" },
          { value: "180", label: "180°" },
          { value: "270", label: "90° left" },
        ],
      },
      { type: "pages", key: "pages", label: "Pages", placeholder: "All pages", hint: PAGES_ALL_HINT },
    ],
  },
  {
    id: "delete-pages",
    name: "Delete Pages",
    tagline: "Remove pages you don't need",
    description: "Remove specific pages from a PDF.",
    category: "organize",
    icon: "FileMinus",
    accepts: ["pdf"],
    minFiles: 1,
    maxFiles: 1,
    action: "Delete pages",
    options: [{ type: "pages", key: "pages", label: "Pages to delete", placeholder: "2, 4-6", required: true }],
  },
  {
    id: "extract-pages",
    name: "Extract Pages",
    tagline: "Pull selected pages into a new PDF",
    description: "Create a new PDF that contains only the pages you list, in that order.",
    category: "organize",
    icon: "FileOutput",
    accepts: ["pdf"],
    minFiles: 1,
    maxFiles: 1,
    action: "Extract pages",
    options: [{ type: "pages", key: "pages", label: "Pages to keep", placeholder: "1, 3-5", required: true }],
  },
  {
    id: "remove-blank",
    name: "Remove Blank Pages",
    tagline: "Detect and drop empty pages",
    description: "Renders each page and removes those that are visually blank (no text, nearly uniform pixels).",
    category: "organize",
    icon: "FileX",
    accepts: ["pdf"],
    minFiles: 1,
    maxFiles: 10,
    action: "Remove blank pages",
    options: [
      {
        type: "segmented",
        key: "sensitivity",
        label: "Sensitivity",
        default: "normal",
        options: [
          { value: "strict", label: "Strict" },
          { value: "normal", label: "Normal" },
          { value: "loose", label: "Loose" },
        ],
        hint: "Loose also removes pages with faint specks or scanner noise.",
      },
    ],
  },

  // ---------------------------------------------------------------- optimize
  {
    id: "compress",
    name: "Compress PDF",
    tagline: "Reduce file size, keep quality",
    description:
      "Re-encodes embedded images at a lower resolution, removes unused objects and compresses streams. You'll see the exact size change; if the file can't be made smaller, the original is kept.",
    category: "optimize",
    icon: "Minimize2",
    accepts: ["pdf"],
    minFiles: 1,
    maxFiles: 20,
    action: "Compress PDF",
    popular: true,
    options: [
      {
        type: "segmented",
        key: "level",
        label: "Compression",
        default: "medium",
        options: [
          { value: "low", label: "Low" },
          { value: "medium", label: "Recommended" },
          { value: "high", label: "Strong" },
        ],
        hint: "Low: lossless only. Recommended: images ≤150 dpi. Strong: images ≤96 dpi, lower JPEG quality.",
      },
    ],
  },
  {
    id: "repair",
    name: "Repair PDF",
    tagline: "Rebuild damaged cross-reference tables",
    description: "Re-parses a damaged PDF and writes a clean file. Works for broken xref tables and truncated trailers; lost content can't be recovered.",
    category: "optimize",
    icon: "Wrench",
    accepts: ["pdf"],
    minFiles: 1,
    maxFiles: 10,
    action: "Repair PDF",
  },

  // ---------------------------------------------------------------- convert
  {
    id: "convert",
    name: "Convert",
    tagline: "Any supported format to any other",
    description: "Pick a target format; Paperflow shows only conversions that are actually supported for your file.",
    category: "convert",
    icon: "ArrowLeftRight",
    accepts: ["pdf", ...IMAGE_INPUTS, "docx", "doc", "pptx", "ppt", "xlsx", "xls", "odt", "ods", "odp", "rtf", "html", "md", "txt", "csv"],
    minFiles: 1,
    maxFiles: 30,
    ui: "convert",
    action: "Start conversion",
  },
  {
    id: "word-to-pdf",
    name: "Word to PDF",
    tagline: "DOCX, DOC, ODT and RTF to PDF",
    description: "Convert word-processing documents to PDF with LibreOffice.",
    category: "convert",
    icon: "FileText",
    accepts: OFFICE_DOCS,
    minFiles: 1,
    maxFiles: 20,
    processor: "convert",
    fixed: { to: "pdf" },
    requires: "libreoffice",
    action: "Convert to PDF",
    popular: true,
  },
  {
    id: "powerpoint-to-pdf",
    name: "PowerPoint to PDF",
    tagline: "PPTX, PPT and ODP to PDF",
    description: "Convert presentations to PDF, one page per slide.",
    category: "convert",
    icon: "Presentation",
    accepts: ["pptx", "ppt", "odp"],
    minFiles: 1,
    maxFiles: 20,
    processor: "convert",
    fixed: { to: "pdf" },
    requires: "libreoffice",
    action: "Convert to PDF",
  },
  {
    id: "excel-to-pdf",
    name: "Excel to PDF",
    tagline: "XLSX, XLS, ODS and CSV to PDF",
    description: "Convert spreadsheets to PDF using each sheet's page setup.",
    category: "convert",
    icon: "Sheet",
    accepts: ["xlsx", "xls", "ods", "csv"],
    minFiles: 1,
    maxFiles: 20,
    processor: "convert",
    fixed: { to: "pdf" },
    requires: "libreoffice",
    action: "Convert to PDF",
  },
  {
    id: "pdf-to-word",
    name: "PDF to Word",
    tagline: "Editable DOCX from PDF text",
    description: "Rebuild an editable Word document from a PDF's text layer.",
    category: "convert",
    icon: "FileType",
    accepts: ["pdf"],
    minFiles: 1,
    maxFiles: 10,
    processor: "convert",
    fixed: { to: "docx" },
    action: "Convert to Word",
    popular: true,
    options: [
      {
        type: "segmented",
        key: "docxMode",
        label: "Layout",
        default: "flow",
        options: [
          { value: "flow", label: "Editable text" },
          { value: "layout", label: "Exact layout" },
        ],
        hint: "Editable text: clean paragraphs and headings. Exact layout: positioned text boxes and images (LibreOffice).",
      },
    ],
  },
  {
    id: "pdf-to-image",
    name: "PDF to Image",
    tagline: "Pages as JPG, PNG, WebP or TIFF",
    description: "Render every page (or selected pages) to images. Several images download as a ZIP.",
    category: "convert",
    icon: "Image",
    accepts: ["pdf"],
    minFiles: 1,
    maxFiles: 10,
    processor: "convert",
    action: "Convert to images",
    popular: true,
    options: [
      {
        type: "segmented",
        key: "to",
        label: "Format",
        default: "jpg",
        options: [
          { value: "jpg", label: "JPG" },
          { value: "png", label: "PNG" },
          { value: "webp", label: "WebP" },
          { value: "tiff", label: "TIFF" },
        ],
      },
      {
        type: "select",
        key: "dpi",
        label: "Resolution",
        default: "150",
        options: [
          { value: "72", label: "72 dpi · screen" },
          { value: "150", label: "150 dpi · standard" },
          { value: "300", label: "300 dpi · print" },
        ],
      },
      { type: "pages", key: "pages", label: "Pages", placeholder: "All pages", hint: PAGES_ALL_HINT },
    ],
  },
  {
    id: "images-to-pdf",
    name: "Images to PDF",
    tagline: "Combine JPG, PNG, WebP and TIFF into one PDF",
    description: "Turn one or more images into a single PDF, one image per page, in the order you choose.",
    category: "convert",
    icon: "Images",
    accepts: IMAGE_INPUTS,
    minFiles: 1,
    maxFiles: 100,
    ordered: true,
    action: "Create PDF",
    popular: true,
    options: [
      {
        type: "select",
        key: "pageSize",
        label: "Page size",
        default: "fit",
        options: [
          { value: "fit", label: "Same as image" },
          { value: "a4", label: "A4" },
          { value: "letter", label: "US Letter" },
        ],
      },
      {
        type: "segmented",
        key: "orientation",
        label: "Orientation",
        default: "auto",
        options: [
          { value: "auto", label: "Auto" },
          { value: "portrait", label: "Portrait" },
          { value: "landscape", label: "Landscape" },
        ],
        showIf: { key: "pageSize", in: ["a4", "letter"] },
      },
      { type: "number", key: "margin", label: "Margin", min: 0, max: 72, default: 0, unit: "pt", showIf: { key: "pageSize", in: ["a4", "letter"] } },
    ],
  },
  {
    id: "html-to-pdf",
    name: "HTML to PDF",
    tagline: "Web pages and Markdown to PDF",
    description: "Convert uploaded HTML or Markdown files to PDF. Remote resources are not fetched for security.",
    category: "convert",
    icon: "Code",
    accepts: ["html", "md"],
    minFiles: 1,
    maxFiles: 20,
    processor: "convert",
    fixed: { to: "pdf" },
    requires: "libreoffice",
    action: "Convert to PDF",
  },

  // ---------------------------------------------------------------- edit
  {
    id: "edit",
    name: "PDF Editor",
    tagline: "Text, shapes, highlights, images and drawing",
    description: "A full editing workspace: add and replace text, annotate, draw, insert images and rearrange pages.",
    category: "edit",
    icon: "PenLine",
    accepts: ["pdf"],
    minFiles: 1,
    maxFiles: 1,
    ui: "editor",
    action: "Export PDF",
    popular: true,
  },
  {
    id: "sign",
    name: "Sign PDF",
    tagline: "Draw, type or upload a signature",
    description: "Place a visual signature, date and text fields on any page. This is a visual signature, not a cryptographic digital signature.",
    category: "edit",
    icon: "Signature",
    accepts: ["pdf"],
    minFiles: 1,
    maxFiles: 1,
    ui: "editor",
    processor: "edit",
    action: "Export signed PDF",
    popular: true,
  },
  {
    id: "watermark",
    name: "Watermark",
    tagline: "Stamp text across pages",
    description: "Add a text watermark with your choice of size, color, opacity, angle and position.",
    category: "edit",
    icon: "Stamp",
    accepts: ["pdf"],
    minFiles: 1,
    maxFiles: 20,
    action: "Add watermark",
    options: [
      { type: "text", key: "text", label: "Text", placeholder: "CONFIDENTIAL", default: "CONFIDENTIAL", required: true, maxLength: 200 },
      { type: "number", key: "size", label: "Font size", min: 8, max: 200, default: 54, unit: "pt" },
      { type: "color", key: "color", label: "Color", default: "#d70015" },
      { type: "number", key: "opacity", label: "Opacity", min: 5, max: 100, default: 25, unit: "%" },
      { type: "number", key: "angle", label: "Angle", min: -90, max: 90, default: 45, unit: "°" },
      {
        type: "select",
        key: "position",
        label: "Position",
        default: "center",
        options: [{ value: "center", label: "Center" }, ...POSITIONS, { value: "tile", label: "Tiled" }],
      },
      { type: "checkbox", key: "behind", label: "Place behind page content", default: false, hint: "May be hidden by opaque page backgrounds or scans." },
      { type: "pages", key: "pages", label: "Pages", placeholder: "All pages", hint: PAGES_ALL_HINT },
    ],
  },
  {
    id: "page-numbers",
    name: "Page Numbers",
    tagline: "Number pages in any corner",
    description: "Add page numbers with a custom format such as “Page {n} of {total}”.",
    category: "edit",
    icon: "Hash",
    accepts: ["pdf"],
    minFiles: 1,
    maxFiles: 20,
    action: "Add page numbers",
    options: [
      { type: "select", key: "position", label: "Position", default: "bottom-center", options: POSITIONS },
      { type: "text", key: "format", label: "Format", default: "{n}", placeholder: "Page {n} of {total}", maxLength: 80, hint: "Use {n} for the number and {total} for the page count." },
      { type: "number", key: "start", label: "First number", min: 0, max: 100000, default: 1 },
      { type: "number", key: "size", label: "Font size", min: 6, max: 48, default: 10, unit: "pt" },
      { type: "number", key: "margin", label: "Margin", min: 6, max: 144, default: 28, unit: "pt" },
      { type: "pages", key: "pages", label: "Pages", placeholder: "All pages", hint: PAGES_ALL_HINT },
    ],
  },
  {
    id: "header-footer",
    name: "Header & Footer",
    tagline: "Running text on every page",
    description: "Add a header and/or footer. Placeholders: {n} page, {total} pages, {date}, {filename}.",
    category: "edit",
    icon: "PanelTop",
    accepts: ["pdf"],
    minFiles: 1,
    maxFiles: 20,
    action: "Apply",
    options: [
      { type: "text", key: "header", label: "Header", placeholder: "Quarterly report · {date}", maxLength: 200 },
      { type: "text", key: "footer", label: "Footer", placeholder: "{filename} — {n}/{total}", maxLength: 200 },
      {
        type: "segmented",
        key: "align",
        label: "Alignment",
        default: "center",
        options: [
          { value: "left", label: "Left" },
          { value: "center", label: "Center" },
          { value: "right", label: "Right" },
        ],
      },
      { type: "number", key: "size", label: "Font size", min: 6, max: 36, default: 9, unit: "pt" },
      { type: "color", key: "color", label: "Color", default: "#636368" },
      { type: "number", key: "margin", label: "Margin", min: 6, max: 144, default: 24, unit: "pt" },
      { type: "pages", key: "pages", label: "Pages", placeholder: "All pages", hint: PAGES_ALL_HINT },
    ],
  },
  {
    id: "crop",
    name: "Crop PDF",
    tagline: "Trim page margins",
    description: "Trim margins by setting the crop box. Content outside the crop area is hidden, not deleted.",
    category: "edit",
    icon: "Crop",
    accepts: ["pdf"],
    minFiles: 1,
    maxFiles: 20,
    action: "Crop PDF",
    options: [
      { type: "number", key: "top", label: "Top", min: 0, max: 200, default: 10, unit: "mm" },
      { type: "number", key: "right", label: "Right", min: 0, max: 200, default: 10, unit: "mm" },
      { type: "number", key: "bottom", label: "Bottom", min: 0, max: 200, default: 10, unit: "mm" },
      { type: "number", key: "left", label: "Left", min: 0, max: 200, default: 10, unit: "mm" },
      { type: "pages", key: "pages", label: "Pages", placeholder: "All pages", hint: PAGES_ALL_HINT },
    ],
  },
  {
    id: "resize",
    name: "Resize Pages",
    tagline: "Change page size to A4, Letter and more",
    description: "Place every page onto a new page size, scaling content to fit while keeping its proportions.",
    category: "edit",
    icon: "Scaling",
    accepts: ["pdf"],
    minFiles: 1,
    maxFiles: 20,
    action: "Resize pages",
    options: [
      {
        type: "select",
        key: "size",
        label: "Page size",
        default: "a4",
        options: [
          { value: "a3", label: "A3 · 297 × 420 mm" },
          { value: "a4", label: "A4 · 210 × 297 mm" },
          { value: "a5", label: "A5 · 148 × 210 mm" },
          { value: "letter", label: "Letter · 8.5 × 11 in" },
          { value: "legal", label: "Legal · 8.5 × 14 in" },
        ],
      },
      {
        type: "segmented",
        key: "orientation",
        label: "Orientation",
        default: "auto",
        options: [
          { value: "auto", label: "Match page" },
          { value: "portrait", label: "Portrait" },
          { value: "landscape", label: "Landscape" },
        ],
      },
    ],
  },
  {
    id: "fill-form",
    name: "Fill PDF Form",
    tagline: "Complete existing form fields",
    description: "Fill text fields, checkboxes, radio buttons and dropdowns in an interactive (AcroForm) PDF.",
    category: "edit",
    icon: "ClipboardPen",
    accepts: ["pdf"],
    minFiles: 1,
    maxFiles: 1,
    ui: "fill-form",
    action: "Save filled PDF",
    limitations: ["XFA forms (dynamic Adobe LiveCycle forms) are not supported."],
  },
  {
    id: "flatten",
    name: "Flatten PDF",
    tagline: "Bake forms and annotations into pages",
    description: "Turns form fields and annotations into ordinary page content so they can no longer be edited.",
    category: "edit",
    icon: "Layers",
    accepts: ["pdf"],
    minFiles: 1,
    maxFiles: 20,
    action: "Flatten PDF",
    options: [
      { type: "checkbox", key: "forms", label: "Flatten form fields", default: true },
      { type: "checkbox", key: "annotations", label: "Flatten annotations", default: true },
    ],
  },
  {
    id: "bookmarks",
    name: "Bookmarks",
    tagline: "Add a navigable outline",
    description: "Replace the document outline with your own bookmarks. One per line: Title | page. Indent with two spaces for nesting.",
    category: "edit",
    icon: "Bookmark",
    accepts: ["pdf"],
    minFiles: 1,
    maxFiles: 1,
    action: "Save bookmarks",
    options: [
      {
        type: "textarea",
        key: "outline",
        label: "Outline",
        placeholder: "Introduction | 1\n  Background | 2\nResults | 5",
        required: true,
        maxLength: 20000,
      },
    ],
  },

  // ---------------------------------------------------------------- security
  {
    id: "protect",
    name: "Protect PDF",
    tagline: "Encrypt with a password",
    description: "Encrypt the PDF with AES-256. Anyone opening it will need the password.",
    category: "security",
    icon: "Lock",
    accepts: ["pdf"],
    minFiles: 1,
    maxFiles: 10,
    action: "Protect PDF",
    popular: true,
    options: [
      { type: "password", key: "password", label: "Password", confirm: true, required: true },
      { type: "checkbox", key: "allowPrint", label: "Allow printing", default: true },
      { type: "checkbox", key: "allowCopy", label: "Allow copying text", default: false },
      { type: "checkbox", key: "allowEdit", label: "Allow editing and annotations", default: false },
    ],
    limitations: ["Permission flags are honoured by compliant viewers; they are not a substitute for the open password."],
  },
  {
    id: "unlock",
    name: "Unlock PDF",
    tagline: "Remove a password you know",
    description: "Removes encryption from a PDF when you provide its correct password. Only unlock documents you are authorised to access.",
    category: "security",
    icon: "LockOpen",
    accepts: ["pdf"],
    minFiles: 1,
    maxFiles: 1,
    action: "Unlock PDF",
    options: [{ type: "password", key: "password", label: "Current password", hint: "Leave empty for PDFs that only restrict permissions." }],
  },
  {
    id: "metadata",
    name: "PDF Metadata",
    tagline: "View, edit or remove document properties",
    description: "Inspect title, author, producer and dates; change them, or strip all metadata (Info dictionary and XMP).",
    category: "security",
    icon: "Info",
    accepts: ["pdf"],
    minFiles: 1,
    maxFiles: 20,
    action: "Apply",
    options: [
      {
        type: "segmented",
        key: "mode",
        label: "Action",
        default: "view",
        options: [
          { value: "view", label: "View" },
          { value: "edit", label: "Edit" },
          { value: "remove", label: "Remove all" },
        ],
      },
      { type: "text", key: "title", label: "Title", maxLength: 500, showIf: { key: "mode", in: ["edit"] } },
      { type: "text", key: "author", label: "Author", maxLength: 500, showIf: { key: "mode", in: ["edit"] } },
      { type: "text", key: "subject", label: "Subject", maxLength: 500, showIf: { key: "mode", in: ["edit"] } },
      { type: "text", key: "keywords", label: "Keywords", maxLength: 500, showIf: { key: "mode", in: ["edit"] } },
    ],
  },

  // ---------------------------------------------------------------- extract
  {
    id: "ocr",
    name: "OCR PDF",
    tagline: "Make scans searchable",
    description:
      "Recognise text in scanned PDFs and images. Produces a searchable PDF with the original scan preserved underneath an invisible text layer, or plain text.",
    category: "extract",
    icon: "ScanText",
    accepts: ["pdf", ...IMAGE_INPUTS],
    minFiles: 1,
    maxFiles: 5,
    action: "Run OCR",
    popular: true,
    options: [
      { type: "select", key: "lang", label: "Language", default: "eng", options: [{ value: "eng", label: "English" }] },
      {
        type: "segmented",
        key: "output",
        label: "Output",
        default: "pdf",
        options: [
          { value: "pdf", label: "Searchable PDF" },
          { value: "txt", label: "Text" },
        ],
      },
      {
        type: "checkbox",
        key: "skipText",
        label: "Skip pages that already contain text",
        default: true,
        hint: "Pages with an existing text layer are copied unchanged.",
      },
    ],
  },
  {
    id: "extract-text",
    name: "Extract Text",
    tagline: "Get the text out of a PDF",
    description: "Export the text layer as plain text, optionally with page separators.",
    category: "extract",
    icon: "TextSelect",
    accepts: ["pdf"],
    minFiles: 1,
    maxFiles: 20,
    action: "Extract text",
    options: [{ type: "checkbox", key: "pageBreaks", label: "Mark page boundaries", default: true }],
  },
  {
    id: "extract-images",
    name: "Extract Images",
    tagline: "Save every embedded image",
    description: "Exports the images embedded in a PDF at their native resolution as PNG or JPG.",
    category: "extract",
    icon: "ImageDown",
    accepts: ["pdf"],
    minFiles: 1,
    maxFiles: 5,
    action: "Extract images",
    options: [{ type: "number", key: "minSize", label: "Ignore images smaller than", min: 0, max: 2000, default: 32, unit: "px" }],
  },
  {
    id: "compare",
    name: "Compare PDFs",
    tagline: "See what changed between two versions",
    description: "Produces a report of text changes per page and a visual overlay highlighting pixels that differ.",
    category: "extract",
    icon: "GitCompare",
    accepts: ["pdf"],
    minFiles: 2,
    maxFiles: 2,
    ordered: true,
    action: "Compare",
  },
];

export const TOOL_MAP: Record<string, ToolDef> = Object.fromEntries(TOOLS.map((t) => [t.id, t]));

export function getTool(id: string): ToolDef | undefined {
  return TOOL_MAP[id];
}

export function toolHref(t: ToolDef): string {
  if (t.id === "edit") return "/editor";
  if (t.id === "convert") return "/convert";
  return `/tools/${t.id}`;
}
