"use client";
// Markdown (as the AI writes it) → a Word document that keeps headings, lists, tables, bold and italic.
import { Lexer, type Token, type Tokens } from "marked";

type Docx = typeof import("docx");
type Run = InstanceType<Docx["TextRun"]>;
type Block = InstanceType<Docx["Paragraph"]> | InstanceType<Docx["Table"]>;

interface Style {
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
  code?: boolean;
}

function inline(d: Docx, tokens: Token[] | undefined, style: Style = {}): Run[] {
  const out: Run[] = [];
  for (const t of tokens ?? []) {
    switch (t.type) {
      case "strong":
        out.push(...inline(d, (t as Tokens.Strong).tokens, { ...style, bold: true }));
        break;
      case "em":
        out.push(...inline(d, (t as Tokens.Em).tokens, { ...style, italics: true }));
        break;
      case "del":
        out.push(...inline(d, (t as Tokens.Del).tokens, { ...style, strike: true }));
        break;
      case "codespan":
        out.push(new d.TextRun({ text: (t as Tokens.Codespan).text, font: "Consolas", ...style }));
        break;
      case "br":
        out.push(new d.TextRun({ text: "", break: 1 }));
        break;
      case "link":
        out.push(...inline(d, (t as Tokens.Link).tokens, style));
        break;
      case "text": {
        const tt = t as Tokens.Text;
        if (tt.tokens?.length) out.push(...inline(d, tt.tokens, style));
        else out.push(new d.TextRun({ text: unescape(tt.text), bold: style.bold, italics: style.italics, strike: style.strike }));
        break;
      }
      case "escape":
        out.push(new d.TextRun({ text: (t as Tokens.Escape).text, ...style }));
        break;
      default:
        if ("text" in t && typeof t.text === "string") out.push(new d.TextRun({ text: unescape(t.text), ...style }));
    }
  }
  return out;
}

const unescape = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

function blocks(d: Docx, tokens: Token[], level = 0): Block[] {
  const out: Block[] = [];
  const H = [d.HeadingLevel.HEADING_1, d.HeadingLevel.HEADING_2, d.HeadingLevel.HEADING_3, d.HeadingLevel.HEADING_4, d.HeadingLevel.HEADING_5, d.HeadingLevel.HEADING_6];
  for (const t of tokens) {
    switch (t.type) {
      case "heading": {
        const h = t as Tokens.Heading;
        out.push(new d.Paragraph({ heading: H[h.depth - 1], children: inline(d, h.tokens), spacing: { before: 240, after: 120 } }));
        break;
      }
      case "paragraph":
        out.push(new d.Paragraph({ children: inline(d, (t as Tokens.Paragraph).tokens), spacing: { after: 160 } }));
        break;
      case "blockquote":
        for (const b of blocks(d, (t as Tokens.Blockquote).tokens, level)) out.push(b);
        break;
      case "code":
        for (const line of (t as Tokens.Code).text.split("\n")) out.push(new d.Paragraph({ children: [new d.TextRun({ text: line, font: "Consolas", size: 19 })] }));
        break;
      case "hr":
        out.push(new d.Paragraph({ border: { bottom: { style: d.BorderStyle.SINGLE, size: 6, color: "BBBBBB", space: 1 } } }));
        break;
      case "list": {
        const l = t as Tokens.List;
        l.items.forEach((item, i) => {
          const marker = item.task ? (item.checked ? "☑ " : "☐ ") : l.ordered ? `${Number(l.start || 1) + i}. ` : "";
          const [first, ...rest] = item.tokens;
          const lead = first && (first.type === "text" || first.type === "paragraph") ? inline(d, (first as Tokens.Text).tokens ?? [first]) : [];
          out.push(
            new d.Paragraph({
              children: [...(marker ? [new d.TextRun(marker)] : []), ...lead],
              ...(l.ordered || item.task ? { indent: { left: 360 * (level + 1), hanging: 360 } } : { bullet: { level } }),
              spacing: { after: 60 },
            }),
          );
          out.push(...blocks(d, lead.length ? rest : item.tokens, level + 1));
        });
        break;
      }
      case "table": {
        const tb = t as Tokens.Table;
        const cell = (c: Tokens.TableCell, header = false) =>
          new d.TableCell({ children: [new d.Paragraph({ children: inline(d, c.tokens, header ? { bold: true } : {}) })], shading: header ? { fill: "F2F2F7", type: d.ShadingType.CLEAR, color: "auto" } : undefined, margins: { top: 60, bottom: 60, left: 100, right: 100 } });
        out.push(
          new d.Table({
            width: { size: 100, type: d.WidthType.PERCENTAGE },
            rows: [new d.TableRow({ tableHeader: true, children: tb.header.map((c) => cell(c, true)) }), ...tb.rows.map((r) => new d.TableRow({ children: r.map((c) => cell(c)) }))],
          }),
        );
        out.push(new d.Paragraph({ children: [] }));
        break;
      }
      case "space":
        break;
      default:
        if ("text" in t && typeof t.text === "string" && t.text.trim()) out.push(new d.Paragraph({ children: [new d.TextRun(unescape(t.text))] }));
    }
  }
  return out;
}

/** Builds a .docx from Markdown. */
export async function markdownToDocx(markdown: string, title: string): Promise<Blob> {
  const d = await import("docx");
  const doc = new d.Document({
    title,
    creator: "Pagelyt",
    styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
    sections: [{ children: blocks(d, new Lexer({ gfm: true }).lex(markdown)) }],
  });
  return d.Packer.toBlob(doc);
}
