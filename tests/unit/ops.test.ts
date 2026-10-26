import { describe, it, expect } from "vitest";
import * as ops from "@/lib/pdf/ops";
import { fixture, reopen, firstLines, pageTexts, isPdf } from "../helpers/util";

const five = fixture("text-5pages.pdf");
const three = fixture("text-3pages.pdf");

describe("merge", () => {
  it("preserves file order, page order and orientation", async () => {
    const out = await ops.merge([three, five]);
    expect(isPdf(out)).toBe(true);
    expect(firstLines(out)).toEqual(["MEMO 1", "MEMO 2", "MEMO 3", "PAGE 1", "PAGE 2", "PAGE 3", "PAGE 4", "PAGE 5"]);
    const doc = await ops.load(out);
    // page 3 of each source is landscape; page 2 of the 5-page file is rotated 90°
    expect(doc.getPage(2).getWidth()).toBeGreaterThan(doc.getPage(2).getHeight());
    expect(doc.getPage(4).getRotation().angle).toBe(90);
  });
  it("refuses a single file", async () => {
    await expect(ops.merge([three])).rejects.toThrow(/at least two/);
  });
});

describe("split", () => {
  it("splits custom ranges into separate documents", async () => {
    const parts = await ops.splitByRanges(five, "1-2, 4, 5-5");
    expect(parts.map((p) => firstLines(p.bytes))).toEqual([["PAGE 1", "PAGE 2"], ["PAGE 4"], ["PAGE 5"]]);
  });
  it("splits every page and fixed chunks", async () => {
    expect((await ops.splitEvery(five, 1)).length).toBe(5);
    const chunks = await ops.splitEvery(five, 2);
    expect(chunks.map((c) => c.range)).toEqual([
      { start: 1, end: 2 },
      { start: 3, end: 4 },
      { start: 5, end: 5 },
    ]);
  });
  it("rejects invalid ranges", async () => {
    await expect(ops.splitByRanges(five, "2-9")).rejects.toThrow(/out of range/);
  });
});

describe("rotate / delete / assemble", () => {
  it("rotates only the listed pages", async () => {
    const out = await ops.load(await ops.rotate(five, 90, "1,3"));
    expect(out.getPages().map((p) => p.getRotation().angle)).toEqual([90, 90, 90, 0, 0]);
  });
  it("deletes pages and refuses to delete all", async () => {
    expect(firstLines(await ops.deletePages(five, "2-3"))).toEqual(["PAGE 1", "PAGE 4", "PAGE 5"]);
    await expect(ops.deletePages(five, "1-5")).rejects.toThrow(/every page/);
  });
  it("reorders, duplicates and inserts pages from another PDF", async () => {
    const out = await ops.assemble([five, three], [
      { src: 0, page: 4 },
      { src: 1, page: 0, rotate: 180 },
      { src: 0, page: 0 },
      { src: 0, page: 0 },
    ]);
    expect(firstLines(out)).toEqual(["PAGE 5", "MEMO 1", "PAGE 1", "PAGE 1"]);
    expect((await ops.load(out)).getPage(1).getRotation().angle).toBe(180);
  });
  it("rejects plans that reference missing pages", async () => {
    await expect(ops.assemble([three], [{ src: 0, page: 7 }])).rejects.toThrow(/doesn't exist/);
  });
});

describe("stamping", () => {
  it("adds a Unicode watermark that is present in the text layer", async () => {
    const r = await ops.watermark(three, { text: "CONFIDENȚIAL", size: 40, color: "#ff0000", opacity: 0.3, angle: 45, position: "center", pages: "" });
    expect(pageTexts(r.bytes).every((t) => t.includes("CONFIDENȚIAL"))).toBe(true);
    expect(r.dropped).toBe(0);
  });
  it("numbers pages with a format and respects the page selection", async () => {
    const out = await ops.pageNumbers(five, { position: "bottom-right", format: "Page {n} of {total}", start: 1, size: 10, margin: 28, pages: "2-4" });
    const t = pageTexts(out);
    expect(t[0]).not.toContain("Page 1 of");
    expect(t[1]).toContain("Page 1 of 3");
    expect(t[3]).toContain("Page 3 of 3");
  });
  it("draws headers and footers with placeholders", async () => {
    const out = await ops.headerFooter(three, { header: "Report {n}/{total}", footer: "{filename}", align: "center", size: 9, color: "#333333", margin: 24, filename: "memo.pdf" });
    const t = pageTexts(out);
    expect(t[2]).toContain("Report 3/3");
    expect(t[0]).toContain("memo.pdf");
  });
});

describe("geometry", () => {
  it("crops by setting the crop box", async () => {
    const out = await ops.load(await ops.crop(three, { top: 10, right: 10, bottom: 10, left: 10 }));
    const box = out.getPage(0).getCropBox();
    expect(Math.round(box.width)).toBe(Math.round(595 - 20 * ops.MM));
  });
  it("resizes pages to A4/Letter keeping orientation", async () => {
    const r = await ops.resize(five, "letter", "auto");
    const doc = await ops.load(r.bytes);
    expect([doc.getPage(0).getWidth(), doc.getPage(0).getHeight()]).toEqual([612, 792]);
    expect(doc.getPage(2).getWidth()).toBe(792); // landscape source page stays landscape
    expect(firstLines(r.bytes)[0]).toBe("PAGE 1");
  });
});

describe("metadata, outline, forms", () => {
  it("reads, edits and strips metadata", async () => {
    const m = await ops.readMetadata(five);
    expect(m.title).toBe("Five Page Report");
    expect(m.pages).toBe(5);
    const edited = await ops.readMetadata(await ops.writeMetadata(five, { title: "Nou titlu", author: "Ana" }));
    expect(edited.title).toBe("Nou titlu");
    expect(edited.author).toBe("Ana");
    const stripped = await ops.readMetadata(await ops.stripMetadata(five));
    expect(stripped.title).toBeUndefined();
    expect(stripped.author).toBeUndefined();
    expect(stripped.hasXmp).toBe(false);
  });
  it("writes a nested outline", async () => {
    const r = await ops.setOutline(five, "Intro | 1\n  Detail | 2\nEnd | 5");
    expect(r.count).toBe(3);
    const outline = reopen(r.bytes).loadOutline()!;
    expect(outline.map((o) => o.title)).toEqual(["Intro", "End"]);
    expect(outline[0].down?.[0].title).toBe("Detail");
    expect(outline[1].page).toBe(4);
  });
  it("rejects outline lines pointing past the last page", async () => {
    await expect(ops.setOutline(three, "X | 9")).rejects.toThrow(/doesn't exist/);
  });
  it("reads and fills AcroForm fields", async () => {
    const form = fixture("form.pdf");
    const info = await ops.readForm(form);
    expect(info.fields.map((f) => f.name).sort()).toEqual(["country", "fullName", "subscribe"]);
    const r = await ops.fillForm(form, { fullName: "Ștefan Pop", subscribe: true, country: "Japan" }, false);
    expect(r.filled).toBe(3);
    const back = await ops.readForm(r.bytes);
    const v = Object.fromEntries(back.fields.map((f) => [f.name, f.value]));
    expect(v).toMatchObject({ fullName: "Ștefan Pop", subscribe: true, country: "Japan" });
    const flat = await ops.fillForm(form, { fullName: "Flat Name" }, true);
    expect((await ops.readForm(flat.bytes)).fields.length).toBe(0);
    expect(pageTexts(flat.bytes)[0]).toContain("Flat Name");
  });
});

describe("images to PDF", () => {
  it("creates one page per image with the requested page size", async () => {
    const { imageForPdf } = await import("@/lib/conversion/images");
    const imgs = await Promise.all(["photo.jpg", "alpha.png", "photo.webp", "photo.tiff"].map(async (n) => imageForPdf(fixture(n))));
    const out = await ops.imagesToPdf(imgs, { pageSize: "a4", orientation: "auto", margin: 20 });
    const doc = await ops.load(out);
    expect(doc.getPageCount()).toBe(4);
    expect(Math.round(doc.getPage(0).getWidth())).toBe(842); // landscape photo → landscape A4
  });
});
