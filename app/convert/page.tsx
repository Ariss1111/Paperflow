import type { Metadata } from "next";
import { Suspense } from "react";
import { ConvertWorkspace } from "@/components/convert/ConvertWorkspace";

export const metadata: Metadata = { title: "Convert", description: "Convert Office documents, images and text to PDF and back." };

export default function ConvertPage() {
  return (
    <Suspense>
      <ConvertWorkspace />
    </Suspense>
  );
}
