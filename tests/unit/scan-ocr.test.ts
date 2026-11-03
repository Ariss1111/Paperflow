import { describe, it, expect } from "vitest";
import { findInPage, fold, textExport, type OcrWord } from "@/lib/scanner/ocr";

const w = (text: string): OcrWord => ({ text, box: [0, 0, 0.1, 0.1] });
const lines = [
  [w("Plata"), w("trebuie"), w("efectuată")],
  [w("până"), w("la"), w("sfârșitul"), w("lunii.")],
  [w("Plata"), w("se"), w("face"), w("lunar.")],
];

describe("scanner OCR search", () => {
  it("folds case and Romanian diacritics", () => {
    expect(fold("Ștefan ȚARA până ÎNCÂT")).toBe("stefan tara pana incat");
  });

  it("finds every occurrence of a word", () => {
    expect(findInPage(lines, "plata")).toEqual([[[0, 0]], [[2, 0]]]);
  });

  it("matches phrases across words and lines, ignoring accents", () => {
    expect(findInPage(lines, "efectuata pana")).toEqual([[[0, 2], [1, 0]]]);
    expect(findInPage(lines, "  SFARSITUL   lunii ")).toEqual([[[1, 2], [1, 3]]]);
  });

  it("matches inside a word and returns nothing for blank or missing text", () => {
    expect(findInPage(lines, "arși")).toEqual([[[1, 2]]]);
    expect(findInPage(lines, "   ")).toEqual([]);
    expect(findInPage(lines, "zebra")).toEqual([]);
  });

  it("exports text page by page", () => {
    const ocr = { lang: "ron" as const, text: "Pagina unu", lines: [], layer: new Uint8Array(), confidence: 90 };
    expect(textExport([{ ocr }, {}])).toBe("——— Page 1 ———\n\nPagina unu\n\n——— Page 2 ———\n\n\n");
  });
});
