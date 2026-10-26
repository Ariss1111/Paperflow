"use client";
import * as React from "react";
import { useSearchParams, usePathname } from "next/navigation";
import { api } from "@/lib/client/api";
import type { StoredFile } from "@/types";

/**
 * Selected files for a tool. Seeded from `?files=id,id` (continuing from another tool or the home page)
 * and kept in the URL, so a reload reopens the same files while they're still on the server.
 */
export function useSelectedFiles() {
  const params = useSearchParams();
  const pathname = usePathname();
  const [files, setFiles] = React.useState<StoredFile[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [missing, setMissing] = React.useState(0);
  const synced = React.useRef<string | null>(null);

  React.useEffect(() => {
    const ids = (params.get("files") ?? "").split(",").filter(Boolean).slice(0, 100);
    const key = ids.join(",");
    if (!ids.length || synced.current === key) return;
    synced.current = key;
    setLoading(true);
    Promise.allSettled(ids.map((id) => api.getFile(id)))
      .then((res) => {
        const ok = res.flatMap((r) => (r.status === "fulfilled" ? [r.value.file] : []));
        setMissing(res.length - ok.length);
        setFiles((prev) => [...prev, ...ok.filter((f) => !prev.some((p) => p.id === f.id))]);
      })
      .finally(() => setLoading(false));
  }, [params]);

  // reflect the selection in the URL without adding history entries
  React.useEffect(() => {
    const key = files.map((f) => f.id).join(",");
    if (loading || key === synced.current) return;
    synced.current = key;
    const url = key ? `${pathname}?files=${key}` : pathname;
    window.history.replaceState(window.history.state, "", url);
  }, [files, loading, pathname]);

  return { files, setFiles, loading, missing };
}
