import type { Metadata } from "next";
import { FilesPage } from "@/components/files/FilesPage";

export const metadata: Metadata = { title: "My Documents", robots: { index: false } };

export default function Page() {
  return <FilesPage />;
}
