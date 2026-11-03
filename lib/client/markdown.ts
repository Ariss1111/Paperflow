"use client";
import { Marked } from "marked";

// AI output is untrusted (a document can try to inject markup), so raw HTML is dropped and only
// http(s)/mailto links survive. Everything else is plain Markdown → HTML.
const md = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    html() {
      return "";
    },
    link({ href, text }) {
      const safe = /^(https?:|mailto:)/i.test(href ?? "") ? href : null;
      const label = text.replace(/[<>]/g, "");
      return safe ? `<a href="${safe.replace(/"/g, "%22")}" target="_blank" rel="noopener noreferrer nofollow">${label}</a>` : label;
    },
    image({ text }) {
      return text.replace(/[<>]/g, "");
    },
  },
});

export function renderMarkdown(text: string): string {
  return md.parse(text, { async: false }) as string;
}
