import { Suspense } from "react";
import type { Metadata } from "next";
import { ResetConfirmPage } from "@/components/account/AuthPages";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false } };

export default function Page() {
  return (
    <Suspense>
      <ResetConfirmPage />
    </Suspense>
  );
}
