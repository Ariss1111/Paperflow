import Link from "next/link";
import type { Metadata } from "next";
import { FileQuestion } from "lucide-react";

export const metadata: Metadata = { title: "Page not found", robots: { index: false } };

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-md space-y-4 text-center">
        <FileQuestion className="mx-auto size-10 text-ink-3" />
        <h1 className="text-xl font-semibold text-ink">This page doesn&apos;t exist</h1>
        <p className="text-sm text-ink-2">The address may be mistyped, or the page has moved.</p>
        <div className="flex justify-center gap-2">
          <Link href="/" className="inline-flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-medium text-white hover:bg-accent/90">
            Home
          </Link>
          <Link href="/tools" className="inline-flex h-9 items-center rounded-lg px-4 text-sm font-medium text-ink hover:bg-ink/[0.05]">
            All tools
          </Link>
        </div>
      </div>
    </div>
  );
}
