import type { Metadata } from "next";
import { Suspense } from "react";
import { AiWorkspace } from "@/components/ai/AiWorkspace";

export const metadata: Metadata = { title: "AI Workspace", description: "Summarize, ask questions about, translate and extract key information from documents." };

export default function Page() {
  return (
    <Suspense>
      <AiWorkspace />
    </Suspense>
  );
}
