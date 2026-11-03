import { Suspense } from "react";
import type { Metadata } from "next";
import { SignInPage } from "@/components/account/AuthPages";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

export default function Page() {
  return (
    <Suspense>
      <SignInPage />
    </Suspense>
  );
}
