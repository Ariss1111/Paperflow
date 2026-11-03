"use client";
import * as React from "react";
import { Check, Copy, Globe, KeyRound, Link2, Lock, Users } from "lucide-react";
import { Sheet } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Segmented, Select, Switch } from "@/components/ui/controls";
import { Notice, toast } from "@/components/ui/feedback";
import { cloudApi, shareUrl, type Share } from "@/lib/client/cloud";
import { cn, formatRelative } from "@/lib/utils";

const EXPIRY = [
  { value: "never", label: "Never" },
  { value: "1", label: "In 1 day" },
  { value: "7", label: "In 7 days" },
  { value: "30", label: "In 30 days" },
  { value: "custom", label: "On a date…" },
];

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Link copied.", "success");
  } catch {
    toast("Copy isn't allowed here. Select the link and copy it.", "danger");
  }
}

function ShareRow({ s, onRevoke }: { s: Share; onRevoke: () => void }) {
  const url = shareUrl(s.id);
  const state = s.revokedAt ? "Revoked" : !s.active ? "Expired" : null;
  return (
    <li className={cn("space-y-2 rounded-xl p-3 shadow-hairline", !s.active && "opacity-60")} data-testid="share-row">
      <div className="flex items-center gap-2">
        {s.access === "private" ? <Users className="size-4 shrink-0 text-ink-3" /> : <Globe className="size-4 shrink-0 text-ink-3" />}
        <input readOnly value={url} aria-label="Share link" className="min-w-0 flex-1 truncate bg-transparent text-sm text-ink focus:outline-none" onFocus={(e) => e.currentTarget.select()} />
        {s.active && (
          <Button size="sm" icon={<Copy className="size-3.5" />} onClick={() => copy(url)}>
            Copy
          </Button>
        )}
      </div>
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-2">
        <span>{s.access === "private" ? `Only ${s.emails.join(", ")}` : "Anyone with the link"}</span>
        {s.hasPassword && (
          <span className="inline-flex items-center gap-1">
            <KeyRound className="size-3" /> Password
          </span>
        )}
        <span>{s.allowDownload ? "Can download" : "View only"}</span>
        <span>{s.expiresAt ? `${s.active ? "Expires" : "Expired"} ${new Date(s.expiresAt).toLocaleDateString()}` : "No expiry"}</span>
        <span>
          {s.views} view{s.views === 1 ? "" : "s"}
          {s.lastViewedAt ? `, last ${formatRelative(s.lastViewedAt)}` : ""}
        </span>
        {state && <b className="text-danger">{state}</b>}
      </p>
      {s.active && (
        <Button size="sm" variant="ghost" className="text-danger" onClick={onRevoke}>
          Revoke access
        </Button>
      )}
    </li>
  );
}

/** Create and manage share links for one document. */
export function ShareDialog({ docId, name, open, onOpenChange, onChange }: { docId: string; name: string; open: boolean; onOpenChange: (o: boolean) => void; onChange?: () => void }) {
  const [shares, setShares] = React.useState<Share[] | null>(null);
  const [access, setAccess] = React.useState<"link" | "private">("link");
  const [emails, setEmails] = React.useState("");
  const [usePassword, setUsePassword] = React.useState(false);
  const [password, setPassword] = React.useState("");
  const [allowDownload, setAllowDownload] = React.useState(true);
  const [expiry, setExpiry] = React.useState("7");
  const [date, setDate] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [created, setCreated] = React.useState<string | null>(null);

  const load = React.useCallback(() => cloudApi.shares(docId).then((r) => setShares(r.shares)).catch(() => setShares([])), [docId]);
  React.useEffect(() => {
    if (open) {
      setCreated(null);
      setError(null);
      void load();
    }
  }, [open, load]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const expiresAt = expiry === "never" ? null : expiry === "custom" ? (date ? new Date(`${date}T23:59:59`).getTime() : NaN) : Date.now() + Number(expiry) * 86400_000;
      if (Number.isNaN(expiresAt)) throw new Error("Choose the date the link should stop working.");
      const { share } = await cloudApi.share(docId, {
        access,
        emails: access === "private" ? emails.split(/[\s,;]+/).filter(Boolean) : undefined,
        password: usePassword ? password : undefined,
        allowDownload,
        expiresAt,
      });
      setCreated(shareUrl(share.id));
      setPassword("");
      await load();
      onChange?.();
      await copy(shareUrl(share.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const active = shares?.filter((s) => s.active) ?? [];
  const past = shares?.filter((s) => !s.active) ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={`Share “${name}”`} description="Links are random and can't be guessed. You can revoke them at any time." className="w-[min(560px,calc(100vw-32px))]">
      <div className="scroll-thin max-h-[70vh] space-y-5 overflow-y-auto pr-1">
        <section className="space-y-3">
          <Segmented<"link" | "private">
            label="Who can open it"
            value={access}
            onChange={setAccess}
            options={[
              { value: "link", label: <span className="inline-flex items-center gap-1.5"><Link2 className="size-3.5" /> Anyone with the link</span> },
              { value: "private", label: <span className="inline-flex items-center gap-1.5"><Lock className="size-3.5" /> Only specific people</span> },
            ]}
          />
          {access === "private" && (
            <Field label="Their email addresses" htmlFor="share-emails" hint="They'll need to sign in to Pagelyt with one of these addresses to open it.">
              <Input id="share-emails" value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="name@example.com, other@example.com" />
            </Field>
          )}
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="share-pw" className="text-sm text-ink">
              Require a password
            </label>
            <Switch id="share-pw" checked={usePassword} onCheckedChange={setUsePassword} />
          </div>
          {usePassword && (
            <Field label="Link password" htmlFor="share-password" hint="At least 6 characters. Send it separately from the link.">
              <Input id="share-password" type="text" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          )}
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="share-dl" className="text-sm text-ink">
              Allow downloading
              <span className="block text-xs text-ink-3">Off: people can view it in the browser only.</span>
            </label>
            <Switch id="share-dl" checked={allowDownload} onCheckedChange={setAllowDownload} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Link stops working" htmlFor="share-expiry">
              <Select id="share-expiry" value={expiry} onChange={(e) => setExpiry(e.target.value)}>
                {EXPIRY.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            {expiry === "custom" && (
              <Field label="Date" htmlFor="share-date">
                <Input id="share-date" type="date" value={date} min={new Date(Date.now() + 86400_000).toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} />
              </Field>
            )}
          </div>
          {error && <Notice tone="danger">{error}</Notice>}
          {created && (
            <Notice tone="success">
              <span className="flex items-center gap-1.5">
                <Check className="size-4" /> Link created and copied.
              </span>
            </Notice>
          )}
          <Button variant="primary" className="w-full" loading={busy} onClick={create}>
            Create link
          </Button>
          {!allowDownload && <p className="text-xs leading-4 text-ink-3">View-only stops the download button and download links. Anyone who can see a document could still photograph or screenshot it.</p>}
        </section>

        {active.length > 0 && (
          <section>
            <p className="eyebrow mb-2">Active links</p>
            <ul className="space-y-2">
              {active.map((s) => (
                <ShareRow
                  key={s.id}
                  s={s}
                  onRevoke={async () => {
                    await cloudApi.revokeShare(s.id).catch((e) => toast((e as Error).message, "danger"));
                    toast("Access revoked. The link no longer works.", "success");
                    await load();
                    onChange?.();
                  }}
                />
              ))}
            </ul>
          </section>
        )}
        {past.length > 0 && (
          <section>
            <p className="eyebrow mb-2">Expired and revoked</p>
            <ul className="space-y-2">
              {past.map((s) => (
                <ShareRow key={s.id} s={s} onRevoke={() => undefined} />
              ))}
            </ul>
          </section>
        )}
      </div>
    </Sheet>
  );
}
