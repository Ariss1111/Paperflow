import type { Metadata } from "next";
import { AllTools } from "./AllTools";

export const metadata: Metadata = { title: "All Tools" };

export default function ToolsPage() {
  return <AllTools />;
}
