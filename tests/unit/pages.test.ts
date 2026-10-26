import { describe, it, expect } from "vitest";
import { parseRanges, pageIndices } from "@/lib/pdf/pages";

describe("page ranges", () => {
  it("parses mixed ranges", () => {
    expect(parseRanges("1-3, 5, 8-10", 10)).toEqual([
      { start: 1, end: 3 },
      { start: 5, end: 5 },
      { start: 8, end: 10 },
    ]);
  });
  it("supports open ranges and 'last'", () => {
    expect(parseRanges("7-", 9)).toEqual([{ start: 7, end: 9 }]);
    expect(parseRanges("last", 4)).toEqual([{ start: 4, end: 4 }]);
  });
  it("rejects out-of-range, backwards and junk input with readable messages", () => {
    expect(() => parseRanges("4-12", 10)).toThrow(/10 pages/);
    expect(() => parseRanges("5-2", 10)).toThrow(/backwards/);
    expect(() => parseRanges("abc", 10)).toThrow(/isn't a page number/);
    expect(() => parseRanges("0", 10)).toThrow(/start at 1/);
    expect(() => parseRanges(" , ", 10)).toThrow(/at least one/);
  });
  it("returns all pages for an empty spec and keeps written order without duplicates", () => {
    expect(pageIndices("", 3)).toEqual([0, 1, 2]);
    expect(pageIndices("3, 1-2, 2", 3)).toEqual([2, 0, 1]);
  });
});
