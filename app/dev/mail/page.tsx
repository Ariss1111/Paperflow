import { Suspense } from "react";
import type { Metadata } from "next";
import { DevMailPage } from "@/components/account/AuthPages";

export const metadata: Metadata = { title: "Dev inbox", robots: { index: false } };

export default function Page() {
  return (
    <Suspense>
      <DevMailPage />
    </Suspense>
  );
}
