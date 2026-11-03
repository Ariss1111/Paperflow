import { Suspense } from "react";
import type { Metadata } from "next";
import { VerifyPage } from "@/components/account/AuthPages";

export const metadata: Metadata = { title: "Confirm your email", robots: { index: false } };

export default function Page() {
  return (
    <Suspense>
      <VerifyPage />
    </Suspense>
  );
}
