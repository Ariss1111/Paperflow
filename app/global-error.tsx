"use client";
import * as React from "react";
import { reportError } from "@/lib/client/report";

/** Last resort when the layout itself fails: plain HTML, no app styles. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  React.useEffect(() => reportError(error), [error]);
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0, color: "#1d1d1f" }}>
        <div style={{ textAlign: "center", maxWidth: 420, padding: 16 }}>
          <h1 style={{ fontSize: 20 }}>Pagelyt couldn&apos;t load</h1>
          <p style={{ color: "#515154", fontSize: 14 }}>The problem has been logged. Please try again in a moment.</p>
          <button onClick={reset} style={{ marginTop: 12, padding: "8px 16px", borderRadius: 8, border: 0, background: "#3478F6", color: "#fff", fontSize: 14, cursor: "pointer" }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
