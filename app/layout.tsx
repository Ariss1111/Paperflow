import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/shell/AppShell";
import { APP_NAME, APP_TAGLINE, APP_DESCRIPTION, SITE_URL } from "@/lib/brand";
import { THEME_SCRIPT } from "@/lib/client/settings";

// Self-hosted at build time; SF Pro still wins on Apple devices (see --font-sans).
const inter = Inter({ subsets: ["latin", "latin-ext"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: { default: `${APP_NAME} — ${APP_TAGLINE}`, template: `%s · ${APP_NAME}` },
  description: APP_DESCRIPTION,
  applicationName: APP_NAME,
  manifest: "/manifest.webmanifest",
  metadataBase: new URL(SITE_URL),
  alternates: { canonical: "/" },
  openGraph: { type: "website", siteName: APP_NAME, title: `${APP_NAME} — ${APP_TAGLINE}`, description: APP_DESCRIPTION, url: "/", locale: "en_US" },
  twitter: { card: "summary_large_image", title: `${APP_NAME} — ${APP_TAGLINE}`, description: APP_DESCRIPTION },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#161618" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
