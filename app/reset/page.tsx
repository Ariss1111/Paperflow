import { Suspense } from "react";
import type { Metadata } from "next";
import { ResetRequestPage } from "@/components/account/AuthPages";

export const metadata: Metadata = { title: "Reset your password", robots: { index: false } };

export default function Page() {
  return (
    <Suspense>
      <ResetRequestPage />
    </Suspense>
  );
}
