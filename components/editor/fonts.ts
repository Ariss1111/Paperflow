"use client";
import type { FontId } from "@/lib/editor/model";
import { LINE_HEIGHT } from "@/lib/editor/model";

// The editor uses the very same font files the server embeds on export, so what you see is what you get.
export const FONT_FAMILY: Record<FontId, string> = {
  sans: "PF Sans",
  serif: "PF Serif",
  mono: "PF Mono",
};

export const FONT_LABEL: Record<FontId, string> = { sans: "Sans", serif: "Serif", mono: "Mono" };

let loaded: Promise<void> | null = null;

export function loadEditorFonts(): Promise<void> {
  if (loaded) return loaded;
  const faces: [string, string, string][] = [
    ["PF Sans", "DejaVuSans.ttf", "400"],
    ["PF Sans", "DejaVuSans-Bold.ttf", "700"],
    ["PF Serif", "DejaVuSerif.ttf", "400"],
    ["PF Serif", "DejaVuSerif-Bold.ttf", "700"],
    ["PF Mono", "DejaVuSansMono.ttf", "400"],
    ["PF Mono", "DejaVuSansMono-Bold.ttf", "700"],
  ];
  loaded = Promise.all(
    faces.map(async ([family, file, weight]) => {
      const face = new FontFace(family, `url(/fonts/${file})`, { weight });
      document.fonts.add(await face.load());
    }),
  ).then(() => undefined);
  return loaded;
}

let ctx: CanvasRenderingContext2D | null = null;

/** Measures a text box in PDF points (font size in pt == px at scale 1). */
export function measureText(text: string, size: number, font: FontId, bold: boolean): { w: number; h: number } {
  ctx ??= document.createElement("canvas").getContext("2d");
  const lines = text.split("\n");
  let w = 0;
  if (ctx) {
    ctx.font = `${bold ? 700 : 400} ${size}px "${FONT_FAMILY[font]}"`;
    for (const l of lines) w = Math.max(w, ctx.measureText(l).width);
  }
  return { w: Math.max(w, size * 0.6), h: lines.length * size * LINE_HEIGHT };
}
