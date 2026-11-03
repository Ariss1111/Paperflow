import type { Metadata } from "next";
import { DocumentPage } from "@/components/library/DocumentPage";

export const metadata: Metadata = { title: "Document", robots: { index: false } };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <DocumentPage id={(await params).id} />;
}
