"use client";
import * as React from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reportError } from "@/lib/client/report";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  React.useEffect(() => reportError(error), [error]);
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-md space-y-4 text-center">
        <AlertTriangle className="mx-auto size-10 text-warning" />
        <h1 className="text-xl font-semibold text-ink">Something went wrong on this page</h1>
        <p className="text-sm text-ink-2">The problem has been logged. Your files and documents are safe. Try again, or go back to the home page.</p>
        <div className="flex justify-center gap-2">
          <Button variant="primary" icon={<RotateCcw className="size-4" />} onClick={reset}>
            Try again
          </Button>
          <Link href="/" className="inline-flex h-9 items-center rounded-lg px-4 text-sm font-medium text-ink hover:bg-ink/[0.05]">
            Home
          </Link>
        </div>
        {error.digest && <p className="text-xs text-ink-3">Reference: {error.digest}</p>}
      </div>
    </div>
  );
}
