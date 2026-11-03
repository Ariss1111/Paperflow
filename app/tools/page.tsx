import type { Metadata } from "next";
import { AllTools } from "./AllTools";

export const metadata: Metadata = { title: "All Tools", description: "Every Pagelyt tool: merge, split, compress, convert, edit, sign, protect, OCR and AI document tools." };

export default function ToolsPage() {
  return <AllTools />;
}
