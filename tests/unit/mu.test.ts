import { describe, it, expect } from "vitest";
import * as mu from "@/lib/pdf/mu";
import { fixture, reopen, pageTexts, isPdf } from "../helpers/util";

describe("compress", () => {
  it("makes an image-heavy PDF smaller and keeps it valid", async () => {
    const src = fixture("image-heavy.pdf");
    const r = await mu.compress(src, "medium");
    expect(r.recompressed).toBeGreaterThan(0);
    expect(r.bytes.length).toBeLessThan(src.length * 0.5);
    const doc = reopen(r.bytes);
    expect(doc.countPages()).toBe(2);
    expect(pageTexts(r.bytes)[0]).toContain("Photo page 1");
  });
  it("strong compression is at least as small as recommended", async () => {
    const src = fixture("image-heavy.pdf");
    const [m, h] = await Promise.all([mu.compress(src, "medium"), mu.compress(src, "high")]);
    expect(h.bytes.length).toBeLessThanOrEqual(m.bytes.length);
  });
  it("lossless mode never touches images", async () => {
    const r = await mu.compress(fixture("text-3pages.pdf"), "low");
    expect(r.recompressed).toBe(0);
    expect(isPdf(r.bytes)).toBe(true);
  });
});

describe("protect / unlock", () => {
  it("encrypts with AES-256 and needs the password to open", () => {
    const out = mu.protect(fixture("text-1page.pdf"), "p@ss, word", { print: true, copy: false, edit: false });
    const doc = reopen(out);
    expect(doc.needsPassword()).toBe(true);
    expect(doc.authenticatePassword("wrong")).toBe(0);
    expect(doc.authenticatePassword("p@ss, word")).toBeGreaterThan(0);
  });
  it("unlocks with the correct password and rejects a wrong one", () => {
    const enc = fixture("encrypted.pdf");
    expect(() => mu.unlock(enc, "nope")).toThrow(/isn't correct/);
    expect(() => mu.unlock(enc, "")).toThrow(/Enter the password/);
    const out = mu.unlock(enc, "secret");
    expect(reopen(out).needsPassword()).toBe(false);
    expect(pageTexts(out)[0]).toContain("PAGE 1");
  });
  it("requires the owner password to lift permission-only restrictions", () => {
    const r = fixture("restricted.pdf");
    expect(() => mu.unlock(r, "")).toThrow(/owner/);
    expect(() => mu.unlock(r, "guess")).toThrow(/owner/);
    const out = mu.unlock(r, "owner-secret");
    expect(reopen(out).getMetaData("encryption")).toMatch(/none/i);
  });
  it("refuses to unlock an unencrypted file", () => {
    expect(() => mu.unlock(fixture("text-1page.pdf"), "")).toThrow(/isn't encrypted/);
  });
});

describe("repair / corrupted input", () => {
  it("rebuilds a PDF with a broken xref", () => {
    const r = mu.repair(fixture("damaged-xref.pdf"));
    expect(r.repaired).toBe(true);
    expect(r.pages).toBe(3);
    expect(reopen(r.bytes).wasRepaired()).toBe(false);
  });
  it("reports unrecoverable files clearly", () => {
    expect(() => mu.inspect(fixture("garbage.pdf"))).toThrow();
  });
  it("detects encryption without throwing", () => {
    expect(mu.inspect(fixture("encrypted.pdf"))).toMatchObject({ needsPassword: true, encrypted: true });
    expect(mu.inspect(fixture("restricted.pdf"))).toMatchObject({ needsPassword: false, encrypted: true });
  });
});

describe("analysis", () => {
  it("finds the blank page", async () => {
    const r = await mu.blankPages(fixture("with-blank.pdf"), "normal");
    expect(r).toEqual({ blank: [1], total: 4 });
  });
  it("extracts embedded images at native resolution", () => {
    const imgs = mu.extractImages(fixture("image-heavy.pdf"), 32);
    expect(imgs.length).toBe(1); // the same image object is drawn on two pages
    expect([imgs[0].width, imgs[0].height]).toEqual([2400, 1800]);
  });
  it("extracts text with page markers and reports scans as empty", () => {
    const t = mu.extractText(fixture("text-3pages.pdf"), true);
    expect(t.text).toContain("——— Page 2 ———");
    expect(t.text).toContain("MEMO 3");
    expect(mu.extractText(fixture("scanned.pdf"), false).chars).toBe(0);
  });
  it("flattens form fields into page content", () => {
    const out = mu.flatten(fixture("form.pdf"), true, true);
    expect(reopen(out).loadPage(0).getWidgets().length).toBe(0);
  });
});
