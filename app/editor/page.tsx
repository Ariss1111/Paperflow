import type { Metadata } from "next";
import { Suspense } from "react";
import { EditorRoute } from "./EditorRoute";

export const metadata: Metadata = { title: "PDF Editor", description: "Edit PDFs: text, annotations, shapes, images, signatures and pages." };

export default function Page() {
  return (
    <Suspense>
      <EditorRoute />
    </Suspense>
  );
}
