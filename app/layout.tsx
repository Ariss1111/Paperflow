import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "@/components/shell/AppShell";
import { APP_NAME, APP_DESCRIPTION } from "@/lib/brand";
import { THEME_SCRIPT } from "@/lib/client/settings";

export const metadata: Metadata = {
  title: { default: `${APP_NAME} — Every document. One beautiful workspace.`, template: `%s · ${APP_NAME}` },
  description: APP_DESCRIPTION,
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f8" },
    { media: "(prefers-color-scheme: dark)", color: "#161618" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
