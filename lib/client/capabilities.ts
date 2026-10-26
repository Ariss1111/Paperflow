"use client";
import * as React from "react";

export interface Capabilities {
  libreoffice: { available: boolean; version: string | null };
  ocr: { languages: { code: string; name: string }[] };
  malwareScanning: boolean;
  limits: { maxUploadBytes: number; maxFilesPerRequest: number; retentionMinutes: number };
  conversions: { id: string; available: boolean }[];
}

let promise: Promise<Capabilities> | null = null;

export function loadCapabilities(): Promise<Capabilities> {
  promise ??= fetch("/api/capabilities")
    .then((r) => r.json() as Promise<Capabilities>)
    .catch((e) => {
      promise = null;
      throw e;
    });
  return promise;
}

export function useCapabilities(): Capabilities | null {
  const [caps, setCaps] = React.useState<Capabilities | null>(null);
  React.useEffect(() => {
    let live = true;
    loadCapabilities()
      .then((c) => live && setCaps(c))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return caps;
}
