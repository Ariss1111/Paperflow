import { Suspense } from "react";
import type { Metadata } from "next";
import { SignUpPage } from "@/components/account/AuthPages";

export const metadata: Metadata = { title: "Create your account", robots: { index: false } };

export default function Page() {
  return (
    <Suspense>
      <SignUpPage />
    </Suspense>
  );
}
