import type { Metadata } from "next";
import { SharedPage } from "@/components/library/SharedPage";

// share links must never be indexed or leak through the Referer header
export const metadata: Metadata = { title: "Shared document", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <SharedPage id={(await params).id} />;
}
