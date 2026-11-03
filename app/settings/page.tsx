import type { Metadata } from "next";
import { SettingsPage } from "@/components/settings/SettingsPage";

export const metadata: Metadata = { title: "Settings", robots: { index: false } };

export default function Page() {
  return <SettingsPage />;
}
