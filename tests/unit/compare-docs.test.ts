import { describe, it, expect } from "vitest";
import { compareDocuments, compareParagraphs, datesIn, numbersIn, wordDiff, changesAsText, type Paragraph } from "@/lib/server/compare-docs";
import { makeAgreement } from "../helpers/docs";

const p = (text: string, page = 1, size = 11, bold = false): Paragraph => ({ text, page, size, bold, italic: false });

describe("document comparison", () => {
  it("finds dates and numbers in English and Romanian writing", () => {
    expect(datesIn("Starts 01.04.2026, ends 2027-03-31, signed 12 March 2026 and 3 martie 2026.")).toEqual(["01.04.2026", "2027-03-31", "12 March 2026", "3 martie 2026"]);
    expect(numbersIn("A fee of 4,500 EUR, 0.5% per day, 30 days, on 01.04.2026.")).toEqual(["4,500 EUR", "0.5%", "30"]);
  });

  it("diffs words", () => {
    expect(wordDiff("pay within 30 days", "pay within 15 days")).toEqual([
      { op: "same", text: "pay within" },
      { op: "del", text: "30" },
      { op: "add", text: "15" },
      { op: "same", text: "days" },
    ]);
  });

  it("pairs rewordings, keeps real additions and removals apart, and notices formatting", () => {
    const r = compareParagraphs(
      [p("Title", 1, 18, true), p("The fee is 100 EUR per month."), p("Penalties apply after 30 days."), p("Ends on 31.03.2027.")],
      [p("Title", 1, 22, true), p("The fee is 120 EUR per month."), p("Ends on 30.04.2027."), p("Either party may terminate with notice.")],
    );
    expect(r.items.map((i) => i.kind)).toEqual(["format", "changed", "removed", "changed", "added"]);
    expect(r.items[0].format).toEqual(["Text size 18 pt → 22 pt"]);
    expect(r.items[1].numbers).toEqual([{ from: "100 EUR", to: "120 EUR" }]);
    expect(r.items[3].dates).toEqual([{ from: "31.03.2027", to: "30.04.2027" }]);
    expect(r.summary).toMatchObject({ changed: 2, added: 1, removed: 1, formatting: 1, dates: 1, numbers: 1 });
  });

  it("compares two real PDF versions of an agreement", async () => {
    const r = compareDocuments(await makeAgreement(1), await makeAgreement(2), "v1.pdf", "v2.pdf");
    expect(r.summary).toMatchObject({ added: 1, removed: 1, changed: 3, formatting: 1 });
    const changed = r.items.filter((i) => i.kind === "changed");
    expect(changed.flatMap((i) => i.numbers)).toEqual(expect.arrayContaining([{ from: "4,500 EUR", to: "5,200 EUR" }, { from: "30", to: "15" }]));
    expect(changed.flatMap((i) => i.dates)).toEqual([
      { from: "01.04.2026", to: "01.05.2026" },
      { from: "31.03.2027", to: "30.04.2027" },
    ]);
    expect(changed[0].words!.filter((s) => s.op === "add").map((s) => s.text).join(" ")).toMatch(/tax advice/);
    expect(r.items.find((i) => i.kind === "removed")!.a!.text).toMatch(/penalty of 0.5%/);
    expect(r.items.find((i) => i.kind === "added")!.b!.text).toMatch(/terminate this agreement/);
    expect(r.items.find((i) => i.kind === "format")!.format).toEqual(["Text size 18 pt → 22 pt"]);
    // the text handed to the AI lists changes only
    const text = changesAsText(r);
    expect(text).toMatch(/REMOVED \(original p\. 1\): Late payments/);
    expect(text).not.toMatch(/Agreement No\. SA-2047/);
  });

  it("identical documents have no changes; text-less documents are refused", async () => {
    const a = await makeAgreement(1);
    expect(compareDocuments(a, a, "a", "b").summary).toMatchObject({ added: 0, removed: 0, changed: 0, formatting: 0 });
    const { PDFDocument } = await import("pdf-lib");
    const blank = await PDFDocument.create();
    blank.addPage();
    const empty = await blank.save();
    expect(() => compareDocuments(a, empty, "a.pdf", "scan.pdf")).toThrow(/“scan.pdf” has no text to compare/);
  });
});
