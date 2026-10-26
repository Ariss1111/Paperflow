import type { Config } from "tailwindcss";

// Every color, radius and shadow resolves to a CSS variable defined in app/globals.css,
// so light and dark mode are a single token swap.
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: ["class", '[data-theme="dark"]'],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: token("canvas"),
        surface: token("surface"),
        "surface-2": token("surface-2"),
        "surface-3": token("surface-3"),
        line: token("line"),
        "line-strong": token("line-strong"),
        ink: token("ink"),
        "ink-2": token("ink-2"),
        "ink-3": token("ink-3"),
        accent: token("accent"),
        "accent-ink": token("accent-ink"),
        success: token("success"),
        warning: token("warning"),
        danger: token("danger"),
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      fontSize: {
        "2xs": ["11px", { lineHeight: "14px", letterSpacing: "0.01em" }],
        xs: ["12px", { lineHeight: "16px" }],
        sm: ["13px", { lineHeight: "18px", letterSpacing: "-0.003em" }],
        base: ["15px", { lineHeight: "22px", letterSpacing: "-0.009em" }],
        lg: ["17px", { lineHeight: "24px", letterSpacing: "-0.014em" }],
        xl: ["20px", { lineHeight: "26px", letterSpacing: "-0.017em" }],
        "2xl": ["24px", { lineHeight: "30px", letterSpacing: "-0.019em" }],
        "3xl": ["32px", { lineHeight: "38px", letterSpacing: "-0.022em" }],
        "4xl": ["44px", { lineHeight: "50px", letterSpacing: "-0.028em" }],
        "5xl": ["56px", { lineHeight: "60px", letterSpacing: "-0.032em" }],
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        DEFAULT: "var(--radius)",
        md: "var(--radius)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
      },
      boxShadow: {
        hairline: "var(--shadow-hairline)",
        card: "var(--shadow-card)",
        raised: "var(--shadow-raised)",
        overlay: "var(--shadow-overlay)",
      },
      transitionTimingFunction: {
        mac: "cubic-bezier(0.25, 0.1, 0.25, 1)",
        spring: "cubic-bezier(0.32, 0.72, 0, 1)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "rise-in": { from: { opacity: "0", transform: "translateY(6px) scale(0.99)" }, to: { opacity: "1", transform: "none" } },
        "sheet-in": { from: { opacity: "0", transform: "translateY(12px) scale(0.98)" }, to: { opacity: "1", transform: "none" } },
        "drawer-in": { from: { transform: "translateX(-100%)" }, to: { transform: "none" } },
        indeterminate: { "0%": { transform: "translateX(-100%)" }, "100%": { transform: "translateX(250%)" } },
      },
      animation: {
        "fade-in": "fade-in 180ms ease-out",
        "rise-in": "rise-in 260ms cubic-bezier(0.32,0.72,0,1)",
        "sheet-in": "sheet-in 280ms cubic-bezier(0.32,0.72,0,1)",
        "drawer-in": "drawer-in 280ms cubic-bezier(0.32,0.72,0,1)",
        indeterminate: "indeterminate 1.3s cubic-bezier(0.65,0,0.35,1) infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
