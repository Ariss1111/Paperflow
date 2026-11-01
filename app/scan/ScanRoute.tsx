"use client";
import dynamic from "next/dynamic";

// Camera, canvas and workers are browser-only.
const ScannerPage = dynamic(() => import("@/components/scanner/ScannerPage").then((m) => m.ScannerPage), { ssr: false });

export function ScanRoute() {
  return <ScannerPage />;
}
