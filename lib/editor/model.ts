// Editing document model shared by the browser editor and the server export.
// All geometry is in PDF user space of the *original, unrotated* page (points, origin bottom-left),
// so objects stay attached to page content regardless of zoom or rotation.

export type FontId = "sans" | "serif" | "mono";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Base {
  id: string;
  /** key of the EditPage the object belongs to */
  pageKey: string;
}

/** New text drawn on top of the page (overlay). Lines are explicit; no automatic wrapping. */
export interface TextObj extends Base, Rect {
  type: "text";
  text: string;
  size: number;
  color: string;
  font: FontId;
  bold: boolean;
  align: "left" | "center" | "right";
}

/**
 * Replace existing text: the original glyphs inside `cover` are genuinely removed from the
 * page's content stream (redaction), then new text is drawn as an overlay.
 */
export interface ReplaceObj extends Omit<TextObj, "type"> {
  type: "replace";
  cover: Rect;
  original: string;
  /** editor-only: background color sampled from the page, used to preview the removal */
  previewBg?: string;
}

export interface ImageObj extends Base, Rect {
  type: "image" | "signature";
  /** id of an uploaded image file (PNG/JPG) */
  fileId: string;
  /** clockwise degrees as seen on screen */
  rotation: number;
  opacity: number;
}

export interface InkObj extends Base {
  type: "ink";
  points: [number, number][];
  color: string;
  width: number;
  opacity: number;
}

export interface ShapeObj extends Base, Rect {
  type: "rect" | "ellipse";
  stroke: string;
  fill: string | null;
  width: number;
  opacity: number;
}

export interface LineObj extends Base {
  type: "line" | "arrow";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
  opacity: number;
}

/** Real PDF markup annotations (editable in other viewers unless flattened). */
export interface MarkupObj extends Base {
  type: "highlight" | "underline" | "strike";
  rects: Rect[];
  color: string;
  opacity: number;
}

/** Sticky-note comment, stored as a PDF Text annotation. */
export interface CommentObj extends Base {
  type: "comment";
  x: number;
  y: number;
  text: string;
  color: string;
}

/** Permanently removes everything under the area and fills it (true redaction). */
export interface EraseObj extends Base, Rect {
  type: "erase";
  fill: string;
}

export type EditObject = TextObj | ReplaceObj | ImageObj | InkObj | ShapeObj | LineObj | MarkupObj | CommentObj | EraseObj;
export type EditObjectType = EditObject["type"];

export interface EditPage {
  key: string;
  /** zero-based index of the source page in the original PDF */
  src: number;
  /** extra clockwise rotation applied by the user (0/90/180/270) */
  rotate: number;
}

export interface EditDocument {
  version: 1;
  pages: EditPage[];
  objects: EditObject[];
  flattenAnnotations?: boolean;
}

/** Which objects change existing content vs. add on top — shown in the editor UI. */
export const OBJECT_KIND: Record<EditObjectType, "overlay" | "annotation" | "content"> = {
  text: "overlay",
  image: "overlay",
  signature: "overlay",
  ink: "overlay",
  rect: "overlay",
  ellipse: "overlay",
  line: "overlay",
  arrow: "overlay",
  highlight: "annotation",
  underline: "annotation",
  strike: "annotation",
  comment: "annotation",
  replace: "content",
  erase: "content",
};

export const LINE_HEIGHT = 1.25;
