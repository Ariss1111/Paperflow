"use client";

/** Sends a crash report to the server log (best effort; never throws). */
export function reportError(error: Error & { digest?: string }) {
  try {
    const body = JSON.stringify({ message: error.message, digest: error.digest, path: window.location.pathname });
    if (!navigator.sendBeacon?.("/api/log", new Blob([body], { type: "application/json" }))) {
      void fetch("/api/log", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => undefined);
    }
  } catch {
    // reporting must never cause another error
  }
}
