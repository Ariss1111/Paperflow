import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { FIX } from "./helpers";
import { unzip } from "../helpers/util";
import { makeAgreement } from "../helpers/docs";

// Two servers: the normal one (no AI key: AI must say it isn't set up) and AI_URL, the same app
// started with ANTHROPIC_BASE_URL pointing at the stand-in Claude API below (see playwright.config.ts).
const AI_URL = `http://localhost:${Number(process.env.E2E_AI_PORT || 3211)}`;
const MOCK_PORT = Number(process.env.E2E_AI_MOCK_PORT || 4599);

type Sent = { messages: { role: string; content: string | { type: string; text?: string; title?: string }[] }[]; output_config?: { format?: unknown } };
const sent: Sent[] = [];
const lastText = (s: Sent) => {
  const c = s.messages.at(-1)!.content;
  return typeof c === "string" ? c : c.map((b) => b.text ?? "").join("\n");
};
const allText = (s: Sent) => s.messages.map((m) => (typeof m.content === "string" ? m.content : m.content.map((b) => b.text ?? "").join("\n"))).join("\n");

const EXTRACTION = {
  documentType: "Service agreement",
  invoiceNumbers: [{ value: "SA-2047", label: "Agreement no.", page: 1 }],
  names: [
    { value: "Acme Industries SRL", role: "client", kind: "organisation", page: 1 },
    { value: "Maria Popescu", role: "signatory for Acme Industries", kind: "person", page: 1 },
  ],
  addresses: [{ value: "Strada Lalelelor 14, Cluj-Napoca, Romania", belongsTo: "Acme Industries SRL", page: 1 }],
  dates: [{ value: "12.03.2026", iso: "2026-03-12", meaning: "agreement date", page: 1 }],
  prices: [{ value: "4,500 EUR", amount: 4500, currency: "EUR", meaning: "monthly fee", page: 1 }],
  contacts: [{ type: "email", value: "legal@northwind.example", belongsTo: "Northwind Consulting", page: 1 }],
  clauses: [{ title: "Late payment", summary: "0.5% penalty per day of delay", page: 1 }],
  tables: [{ title: "Fees", columns: ["Item", "Amount"], rows: [["Monthly fee", "4,500 EUR"]], page: 1 }],
};

function answerFor(s: Sent): string {
  if (s.output_config?.format) return JSON.stringify(EXTRACTION);
  const t = allText(s);
  if (/Translate the full text/.test(t)) return "# CONTRACT DE SERVICII\n\nAcord nr. SA-2047\n\n## 2. Plată\n\n- Onorariu: **4.500 EUR** pe lună\n\n| Termen | Valoare |\n|---|---|\n| Plată | 30 de zile |\n";
  if (/Differences found between two versions/.test(t)) return "**Overview:** the fee rose and the term moved by a month.\n\n## Important changes\n\n- Monthly fee: 4,500 EUR → 5,200 EUR (original p. 1 / revised p. 1)\n- The late-payment penalty was removed.";
  if (/Date \| What happens \| Page/.test(t)) return "| Date | What happens | Page |\n|---|---|---|\n| 12.03.2026 | Agreement signed | 1 |\n| **01.04.2026** | Services start | 1 |\n";
  if (/The passage I mean/.test(t)) return "This paragraph introduces the first memo (p. 1).";
  return "## Summary\n\nThree memos; the second one is on (p. 2).";
}

const mock = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", async () => {
    const body = JSON.parse(raw) as Sent;
    sent.push(body);
    res.writeHead(200, { "content-type": "text/event-stream" });
    const send = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    send("message_start", { message: { id: "msg_e2e", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 0 } } });
    send("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
    const text = answerFor(body);
    // a short pause first, so the loading state is visible, then the answer in pieces
    await new Promise((r) => setTimeout(r, 500));
    for (let i = 0; i < text.length; i += 40) send("content_block_delta", { index: 0, delta: { type: "text_delta", text: text.slice(i, i + 40) } });
    send("content_block_stop", { index: 0 });
    send("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 80 } });
    send("message_stop", {});
    res.end();
  });
});

test.beforeAll(async () => {
  await new Promise<void>((resolve, reject) => mock.once("error", reject).listen(MOCK_PORT, "127.0.0.1", resolve));
  fs.writeFileSync(path.join(FIX, "agreement-v1.pdf"), await makeAgreement(1));
  fs.writeFileSync(path.join(FIX, "agreement-v2.pdf"), await makeAgreement(2));
});
test.afterAll(() => mock.close());
test.beforeEach(() => {
  sent.length = 0;
});

async function open(page: Page, name: string, base = "") {
  await page.goto(`${base}/ai`);
  await page.locator('input[type="file"]').first().setInputFiles(path.join(FIX, name));
  // attached, not visible: on phones the assistant shows first and the viewer is one tap away
  await expect(page.getByTestId("doc-viewer")).toBeAttached();
}

async function download(page: Page, click: () => Promise<void>) {
  const [dl] = await Promise.all([page.waitForEvent("download"), click()]);
  return { name: dl.suggestedFilename(), bytes: new Uint8Array(fs.readFileSync((await dl.path())!)) };
}

const agree = async (page: Page) => {
  await expect(page.getByRole("dialog", { name: "Send this document to the AI?" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
};

test.describe("without an AI key", () => {
  test("says AI isn't set up, sends nothing, and comparison still works", async ({ page }) => {
    await page.goto("/ai");
    await expect(page.getByText("AI features need setup on this server")).toBeVisible();
    await page.locator('input[type="file"]').first().setInputFiles(path.join(FIX, "agreement-v1.pdf"));
    await expect(page.getByTestId("doc-viewer").locator("[data-page]")).toHaveCount(1);
    await expect(page.getByLabel("Your question")).toBeDisabled();
    await expect(page.getByText("AI isn't set up on this server, so nothing is sent anywhere.")).toBeVisible();

    await page.getByRole("tab", { name: "Compare" }).click();
    await page.getByRole("tabpanel", { name: "Compare" }).locator('input[type="file"]').setInputFiles(path.join(FIX, "agreement-v2.pdf"));
    const summary = page.getByTestId("compare-summary");
    await expect(summary).toContainText("3 changed");
    await expect(summary).toContainText("1 added");
    await expect(summary).toContainText("1 removed");
    await expect(summary).toContainText("1 formatting");
    await expect(summary).toContainText("2 dates, 2 numbers changed");
    const results = page.getByTestId("compare-results");
    await expect(results.getByTestId("changed-date").first()).toContainText("01.04.2026 → 01.05.2026");
    await expect(results.getByTestId("changed-number").first()).toContainText("4,500 EUR → 5,200 EUR");
    await expect(results.locator("ins", { hasText: "tax advice" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Explain with AI" })).toBeDisabled();

    await page.getByRole("radio", { name: "Removed" }).click();
    await expect(results.locator("[data-kind]")).toHaveCount(1);
    await expect(results.locator("[data-kind=removed]")).toContainText("Late payments carry a penalty");
    await page.getByRole("radio", { name: "Formatting" }).click();
    await expect(results.locator("[data-kind=format]")).toContainText("Text size 18 pt → 22 pt");
    // jump to the revised document's page
    await results.getByRole("button", { name: "Revised p. 1" }).click();
    await expect(page.getByRole("radio", { name: "Revised" })).toBeChecked();
    await expect(page.getByLabel("Viewer: agreement-v2.pdf")).toBeVisible();
  });
});

test.describe("with AI", () => {
  test.use({ baseURL: AI_URL });

  test("chat: consent first, suggested questions, loading, page links, selected paragraphs, history, usage", async ({ page }) => {
    await open(page, "text-3pages.pdf");
    await expect(page.getByTestId("doc-viewer").locator("[data-page]")).toHaveCount(3);
    await expect(page.getByTestId("ai-usage")).toContainText("0 of 30 requests");

    // nothing goes out until the visitor agrees
    await page.getByTestId("suggestions").getByRole("button", { name: "Summarize this document." }).click();
    await expect(page.getByRole("dialog", { name: "Send this document to the AI?" })).toContainText("Anthropic (Claude)");
    await page.getByRole("button", { name: "Not now" }).click();
    expect(sent).toHaveLength(0);
    await page.getByTestId("suggestions").getByRole("button", { name: "Summarize this document." }).click();
    await agree(page);
    const chat = page.getByTestId("ai-chat");
    await expect(chat.getByText("Reading the document…")).toBeVisible();
    await expect(chat.getByRole("heading", { name: "Summary" })).toBeVisible();
    await expect(page.getByTestId("ai-usage")).toContainText("1 of 30 requests");

    // a page citation scrolls the viewer to that page
    await chat.getByRole("button", { name: "p. 2" }).click();
    const viewer = page.getByTestId("doc-viewer");
    await expect.poll(async () => {
      const v = (await viewer.boundingBox())!;
      const p2 = (await viewer.locator('[data-page="2"]').boundingBox())!;
      return Math.abs(p2.y - v.y);
    }).toBeLessThan(40);

    // "this paragraph" needs a selection in the viewer
    await page.getByLabel("Your question").fill("Explain this paragraph.");
    await page.getByLabel("Your question").press("Enter");
    await expect(page.getByText("Select the paragraph in the document on the left first")).toBeVisible();
    expect(sent).toHaveLength(1);
    await page.getByLabel("Your question").fill("");
    const layer = viewer.locator('[data-page="1"] .pdf-text-layer');
    await expect(layer.locator("span").first()).toBeAttached();
    await layer.evaluate((el) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(r);
    });
    await expect(page.getByTestId("chat-selection")).toContainText("p. 1:");
    await expect(page.getByTestId("chat-selection")).toContainText("MEMO 1");
    await page.getByRole("button", { name: "Explain this paragraph." }).click();
    await expect(chat.getByText("This paragraph introduces the first memo")).toBeVisible();
    expect(lastText(sent[1])).toMatch(/Explain this paragraph\.\n\nThe passage I mean \(p\. 1\):\n> MEMO 1/);
    // the whole conversation goes along, with the document on the first turn
    expect(sent[1].messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);

    // the conversation is still there after a reload
    await page.reload();
    await page.getByRole("button", { name: "text-3pages.pdf" }).first().click();
    await expect(page.getByTestId("ai-chat").getByText("This paragraph introduces the first memo")).toBeVisible();
  });

  test("summary types and translation, downloaded as Word documents that keep the formatting", async ({ page }) => {
    await open(page, "agreement-v1.pdf");
    await page.getByRole("tab", { name: "Summary" }).click();
    const panel = page.getByRole("tabpanel", { name: "Summary" });
    await panel.getByRole("radio", { name: "Important dates" }).click();
    await panel.getByLabel("Summary language").selectOption("English");
    await panel.getByRole("button", { name: "Summarize" }).click();
    await agree(page);
    await expect(panel.getByRole("cell", { name: "Agreement signed" })).toBeVisible();
    expect(lastText(sent[0])).toMatch(/Date \| What happens \| Page/);
    expect(lastText(sent[0])).toMatch(/Write in English\./);
    const sum = await download(page, () => panel.getByRole("button", { name: "Download as Word" }).click());
    expect(sum.name).toBe("agreement-v1-dates.docx");
    const sumXml = unzip(sum.bytes).get("word/document.xml")!.toString();
    expect(sumXml).toContain("<w:tbl>");
    expect(sumXml).toContain("Agreement signed");

    await page.getByRole("tab", { name: "Translate" }).click();
    const tr = page.getByRole("tabpanel", { name: "Translate" });
    await expect(tr.getByLabel("Translate into").locator("option")).toHaveText(["English", "Romanian", "French", "German", "Spanish", "Italian"]);
    await tr.getByLabel("Translate into").selectOption("Romanian");
    await tr.getByRole("button", { name: "Translate" }).click();
    await expect(tr.getByRole("heading", { name: "CONTRACT DE SERVICII" })).toBeVisible();
    expect(lastText(sent[1])).toMatch(/into Romanian\./);
    // the summary is still there after switching tabs
    await page.getByRole("tab", { name: "Summary" }).click();
    await expect(panel.getByRole("cell", { name: "Agreement signed" })).toBeVisible();
    await page.getByRole("tab", { name: "Translate" }).click();
    const doc = await download(page, () => tr.getByRole("button", { name: "Download as Word" }).click());
    expect(doc.name).toBe("agreement-v1-romanian.docx");
    const xml = unzip(doc.bytes).get("word/document.xml")!.toString();
    expect(xml).toMatch(/<w:pStyle w:val="Heading1"\/>[\s\S]*CONTRACT DE SERVICII/);
    expect(xml).toMatch(/<w:b\/>[\s\S]*4\.500 EUR/);
    expect(xml).toContain("<w:tbl>");
    expect(xml).toContain("30 de zile");
    const md = await download(page, () => tr.getByRole("button", { name: "Download as Markdown" }).click());
    expect(Buffer.from(md.bytes).toString("utf8")).toContain("| Plată | 30 de zile |");
  });

  test("extraction shows every kind of data with pages and exports CSV and JSON", async ({ page }) => {
    await open(page, "agreement-v1.pdf");
    await page.getByRole("tab", { name: "Extract" }).click();
    const panel = page.getByRole("tabpanel", { name: "Extract" });
    await panel.getByRole("button", { name: "Extract" }).click();
    await agree(page);
    await expect(panel.getByText("Service agreement")).toBeVisible();
    for (const v of ["SA-2047", "Maria Popescu", "Strada Lalelelor 14, Cluj-Napoca, Romania", "12.03.2026", "4,500 EUR", "legal@northwind.example", "Late payment"]) await expect(panel.getByText(v, { exact: true }).first()).toBeVisible();
    await expect(panel.getByRole("cell", { name: "Monthly fee" })).toBeVisible();
    expect(sent[0].output_config?.format).toBeTruthy();

    const csv = await download(page, () => panel.getByRole("button", { name: "CSV", exact: true }).click());
    const text = Buffer.from(csv.bytes).toString("utf8");
    expect(text.split("\r\n")[0]).toBe("﻿Category,Value,Details,Page");
    expect(text).toContain('Address,"Strada Lalelelor 14, Cluj-Napoca, Romania",Acme Industries SRL,1');
    const json = await download(page, () => panel.getByRole("button", { name: "JSON" }).click());
    expect(JSON.parse(Buffer.from(json.bytes).toString("utf8"))).toEqual(EXTRACTION);
    const table = await download(page, () => panel.getByRole("button", { name: "Download table 1 as CSV" }).click());
    expect(Buffer.from(table.bytes).toString("utf8")).toBe("﻿Item,Amount\r\nMonthly fee,\"4,500 EUR\"\r\n");
  });

  test("compare: the AI explains the differences, seeing only the differences", async ({ page }) => {
    await open(page, "agreement-v1.pdf");
    await page.getByRole("tab", { name: "Compare" }).click();
    await page.getByRole("tabpanel", { name: "Compare" }).locator('input[type="file"]').setInputFiles(path.join(FIX, "agreement-v2.pdf"));
    await expect(page.getByTestId("compare-summary")).toContainText("3 changed");
    expect(sent).toHaveLength(0);
    await page.getByRole("button", { name: "Explain with AI" }).click();
    await agree(page);
    await expect(page.getByTestId("compare-explanation")).toContainText("Monthly fee: 4,500 EUR → 5,200 EUR");
    const t = allText(sent[0]);
    expect(t).toMatch(/REMOVED \(original p\. 1\): Late payments carry a penalty/);
    expect(t).not.toMatch(/Agreement No\. SA-2047/);
    expect(JSON.stringify(sent[0])).not.toContain('"type":"document"');
  });

  test("phone layout: switch between document and assistant, nothing scrolls sideways", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, "text-3pages.pdf");
    await expect(page.getByRole("tab", { name: "Chat" })).toBeVisible();
    await expect(page.getByTestId("doc-viewer")).toBeHidden();
    await page.getByRole("radio", { name: "Document" }).click();
    await expect(page.getByTestId("doc-viewer").locator("[data-page]").first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  });
});
