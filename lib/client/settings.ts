"use client";
import * as React from "react";

export interface Settings {
  theme: "system" | "light" | "dark";
  compression: "low" | "medium" | "high";
  ocrLang: string;
  imageDpi: "72" | "150" | "300";
  confirmClear: boolean;
}

const KEY = "pf-settings";
const DEFAULTS: Settings = { theme: "system", compression: "medium", ocrLang: "eng", imageDpi: "150", confirmClear: true };

function read(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return DEFAULTS;
  }
}

const subs = new Set<() => void>();
let cache: Settings | null = null;

export function getSettings(): Settings {
  if (typeof window === "undefined") return DEFAULTS;
  return (cache ??= read());
}

export function setSettings(patch: Partial<Settings>) {
  cache = { ...getSettings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* private mode: keep in memory */
  }
  if (patch.theme) applyTheme(cache.theme);
  subs.forEach((s) => s());
}

export function applyTheme(theme: Settings["theme"]) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

export function useSettings(): Settings {
  return React.useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    getSettings,
    () => DEFAULTS,
  );
}

/** Inline script for <head>: applies the saved theme before first paint (no flash). */
export const THEME_SCRIPT = `try{var t=JSON.parse(localStorage.getItem("${KEY}")||"{}").theme;if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;
