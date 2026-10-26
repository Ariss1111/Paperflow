import type { Metadata } from "next";
import { FilesPage } from "@/components/files/FilesPage";

export const metadata: Metadata = { title: "My Files" };

export default function Page() {
  return <FilesPage />;
}
