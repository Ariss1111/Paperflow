import type { Metadata } from "next";
import { Suspense } from "react";
import { ScanRoute } from "./ScanRoute";

export const metadata: Metadata = { title: "Scan Document", description: "Scan paper documents with your camera into a clean, cropped PDF." };

export default function Page() {
  return (
    <Suspense>
      <ScanRoute />
    </Suspense>
  );
}
