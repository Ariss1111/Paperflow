import type { Metadata } from "next";
import { AccountPage } from "@/components/account/AccountPage";

export const metadata: Metadata = { title: "Account", robots: { index: false } };

export default function Page() {
  return <AccountPage />;
}
