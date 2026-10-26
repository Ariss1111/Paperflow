import { NextResponse } from "next/server";
import { route } from "@/lib/server/http";
import { sofficePath, sofficeVersion } from "@/lib/server/libreoffice";
import { ocrLanguages } from "@/lib/server/ocr";
import { scannerConfigured } from "@/lib/server/scan";
import { env } from "@/lib/server/env";
import { CONVERSIONS } from "@/lib/conversion/catalog";
import { conversionAvailable } from "@/lib/conversion/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LANG_NAMES: Record<string, string> = {
  eng: "English", deu: "German", fra: "French", spa: "Spanish", ita: "Italian", por: "Portuguese",
  ron: "Romanian", nld: "Dutch", pol: "Polish", ces: "Czech", hun: "Hungarian", rus: "Russian",
  ukr: "Ukrainian", tur: "Turkish", swe: "Swedish", dan: "Danish", nor: "Norwegian", fin: "Finnish",
  ell: "Greek", jpn: "Japanese", chi_sim: "Chinese (Simplified)", kor: "Korean", ara: "Arabic",
};

/** What this server can actually do right now; the UI uses it to show honest "unavailable" states. */
export const GET = route(async () => {
  return NextResponse.json({
    libreoffice: { available: !!sofficePath(), version: await sofficeVersion() },
    ocr: { languages: ocrLanguages().map((code) => ({ code, name: LANG_NAMES[code] ?? code })) },
    malwareScanning: scannerConfigured(),
    limits: { maxUploadBytes: env.maxUploadBytes, maxFilesPerRequest: env.maxFilesPerRequest, retentionMinutes: Math.round(env.retentionMs / 60000) },
    conversions: CONVERSIONS.map((c) => ({ id: c.id, available: conversionAvailable(c) })),
  });
});
