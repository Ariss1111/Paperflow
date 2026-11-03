"use client";
import * as React from "react";
import Link from "next/link";
import { Download, KeyRound, Lock, ShieldX } from "lucide-react";
import { AppIcon } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/controls";
import { Notice } from "@/components/ui/feedback";
import { DocViewer } from "@/components/ai/DocViewer";
import { call, useAccount } from "@/lib/client/account";
import type { FormatId } from "@/lib/formats";
import { formatBytes } from "@/lib/utils";

interface View {
  gate: "ok" | "password" | "signin" | "forbidden";
  share: { id: string; allowDownload: boolean; expiresAt: number | null; access: "link" | "private" };
  document?: { name: string; format: FormatId; size: number; pages: number | null; owner: string };
}

function Gate({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[calc(100dvh-56px)] items-center justify-center px-4 py-10">
      <div className="w-full max-w-[400px] space-y-4 rounded-[20px] bg-surface p-6 text-center shadow-card">
        <div className="flex justify-center">{icon}</div>
        <h1 className="text-xl font-semibold text-ink">{title}</h1>
        {children}
      </div>
    </div>
  );
}

/** What someone sees when they open a share link. */
export function SharedPage({ id }: { id: string }) {
  const { user, loaded } = useAccount();
  const [v, setV] = React.useState<View | null>(null);
  const [gone, setGone] = React.useState<string | null>(null);
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(() => {
    call<View>(`/api/s/${id}?view=1`, "GET").then(setV, (e) => setGone((e as Error).message));
  }, [id]);
  React.useEffect(() => {
    if (loaded) load();
  }, [loaded, user, load]);

  if (gone) return <Gate icon={<ShieldX className="size-10 text-ink-3" />} title="This link isn't available">
    <p className="text-sm text-ink-2">{gone}</p>
    <Link href="/" className="inline-block text-sm text-accent hover:underline">Go to Pagelyt</Link>
  </Gate>;
  if (!v) return <p className="py-20 text-center text-sm text-ink-3">Opening…</p>;

  if (v.gate === "password")
    return (
      <Gate icon={<KeyRound className="size-10 text-accent" />} title="This document is protected">
        <p className="text-sm text-ink-2">Enter the password you were given to open it.</p>
        <form
          className="space-y-3 text-left"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await call(`/api/s/${id}`, "POST", { password });
              load();
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Password" htmlFor="share-pass">
            <Input id="share-pass" type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {error && <Notice tone="danger">{error}</Notice>}
          <Button type="submit" variant="primary" className="w-full" loading={busy}>
            Open
          </Button>
        </form>
      </Gate>
    );
  if (v.gate === "signin")
    return (
      <Gate icon={<Lock className="size-10 text-accent" />} title="Sign in to open this document">
        <p className="text-sm text-ink-2">It was shared with specific people. Sign in with the email address it was shared with.</p>
        <Link href={`/signin?next=/s/${id}`} className="inline-flex h-10 items-center rounded-full bg-accent px-5 font-medium text-white">
          Sign in
        </Link>
      </Gate>
    );
  if (v.gate === "forbidden")
    return (
      <Gate icon={<ShieldX className="size-10 text-danger" />} title="You don't have access">
        <p className="text-sm text-ink-2">
          This document wasn&apos;t shared with {user?.email}. Ask its owner to share it with you, or sign in with another account.
        </p>
      </Gate>
    );

  const doc = v.document!;
  return (
    <div className="flex h-[calc(100dvh-56px)] min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b bg-surface/80 px-4 py-2 backdrop-blur">
        <AppIcon className="size-7" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold text-ink">{doc.name}</h1>
          <p className="text-xs text-ink-3">
            Shared by {doc.owner} · {formatBytes(doc.size)}
            {doc.pages ? ` · ${doc.pages} pages` : ""}
            {v.share.expiresAt ? ` · link works until ${new Date(v.share.expiresAt).toLocaleDateString()}` : ""}
          </p>
        </div>
        {v.share.allowDownload ? (
          <a href={`/api/s/${id}/file?download=1`} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-medium text-white hover:bg-accent/90">
            <Download className="size-4" /> Download
          </a>
        ) : (
          <span className="text-xs text-ink-3">View only</span>
        )}
      </header>
      <div className="min-h-0 flex-1">
        <DocViewer file={{ id: `share-${id}`, name: doc.name, format: doc.format }} resolve={() => call<{ url: string }>(`/api/s/${id}/file?json=1`, "GET").then((r) => r.url)} />
      </div>
    </div>
  );
}
