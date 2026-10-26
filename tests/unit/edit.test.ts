import { describe, it, expect } from "vitest";
import { applyEdits } from "@/lib/pdf/edit";
import type { EditDocument, EditObject } from "@/lib/editor/model";
import { fixture, reopen, pageTexts, firstLines } from "../helpers/util";

const src = fixture("text-3pages.pdf");
const pages = [
  { key: "a", src: 0, rotate: 0 },
  { key: "b", src: 1, rotate: 0 },
  { key: "c", src: 2, rotate: 0 },
];
const doc = (objects: EditObject[], p = pages, extra: Partial<EditDocument> = {}): EditDocument => ({ version: 1, pages: p, objects, ...extra });
const noAssets = { images: new Map<string, Uint8Array>() };

describe("PDF editor export", () => {
  it("adds overlay text (with diacritics) that survives reopening", async () => {
    const r = await applyEdits(
      src,
      doc([{ id: "t1", pageKey: "a", type: "text", x: 60, y: 400, w: 200, h: 40, text: "Semnătură: Ștefan\nLine two", size: 14, color: "#0071e3", font: "sans", bold: false, align: "left" }]),
      noAssets,
    );
    const t = pageTexts(r.bytes);
    expect(t[0]).toContain("Semnătură: Ștefan");
    expect(t[0]).toContain("Line two");
    expect(r.stats.overlays).toBe(1);
  });

  it("replaces existing text by genuinely removing the original glyphs", async () => {
    const before = reopen(src).loadPage(0);
    const hit = before.search("MEMO 1", {})[0][0];
    // MuPDF quads are top-left origin; convert to PDF user space for the model
    const H = 842;
    const xs = [hit[0], hit[2], hit[4], hit[6]];
    const ys = [hit[1], hit[3], hit[5], hit[7]].map((y) => H - y);
    const cover = { x: Math.min(...xs) - 1, y: Math.min(...ys) - 1, w: Math.max(...xs) - Math.min(...xs) + 2, h: Math.max(...ys) - Math.min(...ys) + 2 };
    const r = await applyEdits(
      src,
      doc([{ id: "r1", pageKey: "a", type: "replace", cover, original: "MEMO 1", ...cover, text: "NOTE 1", size: 28, color: "#000000", font: "sans", bold: true, align: "left" }]),
      noAssets,
    );
    const t = pageTexts(r.bytes)[0];
    expect(t).not.toContain("MEMO 1");
    expect(t).toContain("NOTE 1");
    expect(t).toContain("Three Page Memo"); // neighbouring text untouched
    expect(r.stats.removed).toBe(1);
  });

  it("creates real highlight / underline / strike and comment annotations", async () => {
    const rect = { x: 56, y: 740, w: 120, h: 30 };
    const r = await applyEdits(
      src,
      doc([
        { id: "h", pageKey: "a", type: "highlight", rects: [rect], color: "#ffd60a", opacity: 0.4 },
        { id: "u", pageKey: "a", type: "underline", rects: [rect], color: "#0071e3", opacity: 1 },
        { id: "s", pageKey: "b", type: "strike", rects: [rect], color: "#d70015", opacity: 1 },
        { id: "c", pageKey: "c", type: "comment", x: 300, y: 500, text: "Please check this figure", color: "#ffcc00" },
      ]),
      noAssets,
    );
    const d = reopen(r.bytes);
    expect(d.loadPage(0).getAnnotations().map((a) => a.getType()).sort()).toEqual(["Highlight", "Underline"]);
    expect(d.loadPage(1).getAnnotations()[0].getType()).toBe("StrikeOut");
    const note = d.loadPage(2).getAnnotations()[0];
    expect(note.getType()).toBe("Text");
    expect(note.getContents()).toBe("Please check this figure");
  });

  it("flattens annotations on request", async () => {
    const r = await applyEdits(src, doc([{ id: "h", pageKey: "a", type: "highlight", rects: [{ x: 56, y: 740, w: 120, h: 30 }], color: "#ffd60a", opacity: 0.4 }], pages, { flattenAnnotations: true }), noAssets);
    expect(reopen(r.bytes).loadPage(0).getAnnotations().length).toBe(0);
  });

  it("draws shapes, lines, arrows, ink and images", async () => {
    const { fixture: fx } = await import("../helpers/util");
    const images = new Map([["img1", fx("alpha.png")], ["img2", fx("photo.jpg")]]);
    const r = await applyEdits(
      src,
      doc([
        { id: "1", pageKey: "a", type: "rect", x: 50, y: 50, w: 100, h: 60, stroke: "#000000", fill: "#ffcc00", width: 2, opacity: 1 },
        { id: "2", pageKey: "a", type: "ellipse", x: 200, y: 50, w: 100, h: 60, stroke: "#ff0000", fill: null, width: 2, opacity: 0.8 },
        { id: "3", pageKey: "a", type: "arrow", x1: 50, y1: 200, x2: 250, y2: 260, color: "#0071e3", width: 3, opacity: 1 },
        { id: "4", pageKey: "a", type: "line", x1: 50, y1: 300, x2: 250, y2: 300, color: "#000000", width: 1, opacity: 1 },
        { id: "5", pageKey: "a", type: "ink", points: [[60, 600], [80, 620], [100, 610], [140, 650]], color: "#d70015", width: 2, opacity: 1 },
        { id: "6", pageKey: "b", type: "signature", fileId: "img1", x: 300, y: 100, w: 160, h: 60, rotation: 15, opacity: 1 },
        { id: "7", pageKey: "b", type: "image", fileId: "img2", x: 60, y: 100, w: 200, h: 150, rotation: 0, opacity: 1 },
      ]),
      { images },
    );
    expect(r.stats.overlays).toBe(7);
    const d = reopen(r.bytes);
    // the page with images now references two image XObjects
    const res = d.loadPage(1).getObject().get("Resources").get("XObject");
    let count = 0;
    res.forEach(() => count++);
    expect(count).toBe(2);
  });

  it("reorders, duplicates, rotates and deletes pages; objects follow their page", async () => {
    const r = await applyEdits(
      src,
      doc(
        [
          { id: "t", pageKey: "dup", type: "text", x: 60, y: 400, w: 200, h: 30, text: "ON DUPLICATE", size: 14, color: "#000000", font: "serif", bold: false, align: "left" },
          { id: "gone", pageKey: "b", type: "text", x: 60, y: 400, w: 200, h: 30, text: "DELETED PAGE TEXT", size: 14, color: "#000000", font: "sans", bold: false, align: "left" },
        ],
        [
          { key: "c", src: 2, rotate: 90 },
          { key: "a", src: 0, rotate: 0 },
          { key: "dup", src: 0, rotate: 0 },
        ],
      ),
      noAssets,
    );
    expect(firstLines(r.bytes)).toEqual(["MEMO 3", "MEMO 1", "MEMO 1"]);
    const t = pageTexts(r.bytes);
    expect(t[2]).toContain("ON DUPLICATE");
    expect(t[1]).not.toContain("ON DUPLICATE");
    expect(t.join()).not.toContain("DELETED PAGE TEXT");
    expect(reopen(r.bytes).loadPage(0).getObject().get("Rotate").valueOf()).toBe(90);
  });

  it("erases an area permanently (true redaction)", async () => {
    const r = await applyEdits(src, doc([{ id: "e", pageKey: "a", type: "erase", x: 40, y: 600, w: 520, h: 200, fill: "#ffffff" }]), noAssets);
    const t = pageTexts(r.bytes)[0];
    expect(t).not.toContain("MEMO 1");
  });

  it("can re-open an exported file and edit it again", async () => {
    const first = await applyEdits(src, doc([{ id: "t", pageKey: "a", type: "text", x: 60, y: 400, w: 200, h: 30, text: "FIRST PASS", size: 14, color: "#000000", font: "sans", bold: false, align: "left" }]), noAssets);
    const second = await applyEdits(first.bytes, doc([{ id: "t2", pageKey: "a", type: "text", x: 60, y: 300, w: 200, h: 30, text: "SECOND PASS", size: 14, color: "#000000", font: "sans", bold: false, align: "left" }]), noAssets);
    const t = pageTexts(second.bytes)[0];
    expect(t).toContain("FIRST PASS");
    expect(t).toContain("SECOND PASS");
  });

  it("rejects malformed edit documents", async () => {
    await expect(applyEdits(src, { version: 1, pages: [], objects: [] }, noAssets)).rejects.toThrow(/at least one page/);
    await expect(applyEdits(src, doc([], [{ key: "x", src: 99, rotate: 0 }]), noAssets)).rejects.toThrow(/doesn't exist/);
    await expect(
      applyEdits(src, doc([{ id: "i", pageKey: "a", type: "image", fileId: "missing", x: 1, y: 1, w: 10, h: 10, rotation: 0, opacity: 1 }]), noAssets),
    ).rejects.toThrow(/no longer available/);
  });
});
