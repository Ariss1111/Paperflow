"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Container, PageHeader } from "@/components/shell/AppShell";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/controls";
import { Sheet } from "@/components/ui/dialog";
import { Badge, Notice, toast } from "@/components/ui/feedback";
import { call, refreshAccount, useAccount } from "@/lib/client/account";
import { cloudApi, type StorageStats } from "@/lib/client/cloud";
import { formatBytes } from "@/lib/utils";
import { Avatar } from "./AccountButton";

function Section({ title, children, danger }: { title: string; children: React.ReactNode; danger?: boolean }) {
  return (
    <section className={`space-y-4 rounded-[18px] bg-surface p-5 shadow-card ${danger ? "ring-1 ring-danger/20" : ""}`}>
      <h2 className={`text-sm font-semibold ${danger ? "text-danger" : "text-ink"}`}>{title}</h2>
      {children}
    </section>
  );
}

export function AccountPage() {
  const router = useRouter();
  const { loaded, user } = useAccount();
  const [name, setName] = React.useState("");
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [storage, setStorage] = React.useState<StorageStats | null>(null);
  const [del, setDel] = React.useState(false);
  const [confirmText, setConfirmText] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (user) {
      setName(user.name);
      if (user.verified) cloudApi.storage().then(setStorage).catch(() => undefined);
    }
  }, [user]);

  if (!loaded) return null;
  if (!user)
    return (
      <Container>
        <div className="py-20 text-center">
          <Link href="/signin?next=/account" className="text-accent hover:underline">
            Sign in to see your account
          </Link>
        </div>
      </Container>
    );

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      toast(ok, "success");
    } catch (e) {
      if (key === "delete") setError((e as Error).message);
      else toast((e as Error).message, "danger");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Container>
      <PageHeader title="Account" subtitle="Your profile, sign-in and storage." />
      <div className="mx-auto grid max-w-3xl gap-5 pb-16">
        <Section title="Profile">
          <div className="flex items-center gap-3">
            <Avatar name={user.name} email={user.email} size={48} />
            <div className="min-w-0">
              <p className="truncate font-medium text-ink">{user.email}</p>
              <p className="flex flex-wrap gap-1.5 pt-0.5">
                {user.verified ? <Badge tone="success">Email confirmed</Badge> : <Badge tone="warning">Email not confirmed</Badge>}
                {user.google && <Badge>Google</Badge>}
                <span className="text-xs text-ink-3">Member since {new Date(user.createdAt).toLocaleDateString()}</span>
              </p>
            </div>
          </div>
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run("name", async () => {
                await call("/api/auth/me", "PATCH", { name });
                await refreshAccount();
              }, "Name saved.");
            }}
          >
            <div className="flex-1">
              <Field label="Name" htmlFor="acct-name">
                <Input id="acct-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
              </Field>
            </div>
            <Button type="submit" loading={busy === "name"} disabled={name === user.name}>
              Save
            </Button>
          </form>
        </Section>

        {storage && (
          <Section title="Storage">
            <div className="h-2 overflow-hidden rounded-full bg-ink/10">
              <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(1, (storage.used / storage.quota) * 100)}%` }} />
            </div>
            <p className="text-sm text-ink-2">
              {formatBytes(storage.used)} of {formatBytes(storage.quota)} used · {storage.documents} documents · {formatBytes(storage.available)} available
            </p>
          </Section>
        )}

        <Section title={user.hasPassword ? "Change password" : "Add a password"}>
          <p className="text-sm text-ink-2">{user.hasPassword ? "You'll stay signed in here; every other device is signed out." : "You sign in with Google. Add a password to also sign in with your email."}</p>
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run("pw", async () => {
                await call("/api/auth/password", "POST", { current, password: next });
                setCurrent("");
                setNext("");
                await refreshAccount();
              }, "Password saved. Other devices were signed out.");
            }}
          >
            {user.hasPassword && (
              <Field label="Current password" htmlFor="acct-current">
                <Input id="acct-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
              </Field>
            )}
            <Field label="New password" htmlFor="acct-new" hint="At least 10 characters.">
              <Input id="acct-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit" loading={busy === "pw"} disabled={next.length < 10}>
                Save password
              </Button>
            </div>
          </form>
        </Section>

        <Section title="Devices">
          <p className="text-sm text-ink-2">Lost a phone or used a shared computer? Sign out everywhere except here.</p>
          <Button loading={busy === "others"} onClick={() => run("others", () => call("/api/auth/logout", "POST", { others: true }), "Signed out of all other devices.")}>
            Sign out of other devices
          </Button>
        </Section>

        <Section title="Delete account" danger>
          <p className="text-sm text-ink-2">Deletes your account and everything in it: documents, all versions, folders and share links. This can&apos;t be undone.</p>
          <Button variant="danger" onClick={() => { setDel(true); setConfirmText(""); setError(null); }}>
            Delete my account
          </Button>
        </Section>
      </div>

      <Sheet
        open={del}
        onOpenChange={setDel}
        title="Delete your account?"
        description="Everything stored in it is deleted from our servers right away."
        footer={
          <>
            <Button onClick={() => setDel(false)}>Cancel</Button>
            <Button
              variant="danger"
              loading={busy === "delete"}
              disabled={!confirmText}
              onClick={() =>
                run("delete", async () => {
                  await call("/api/auth/me", "DELETE", user.hasPassword ? { password: confirmText } : { confirm: confirmText });
                  await refreshAccount();
                  router.push("/");
                }, "Your account was deleted.")
              }
            >
              Delete everything
            </Button>
          </>
        }
      >
        {user.hasPassword ? (
          <Field label="Your password" htmlFor="del-pw">
            <Input id="del-pw" type="password" autoComplete="current-password" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
          </Field>
        ) : (
          <Field label={`Type ${user.email} to confirm`} htmlFor="del-email">
            <Input id="del-email" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
          </Field>
        )}
        {error && <Notice tone="danger" className="mt-3">{error}</Notice>}
      </Sheet>
    </Container>
  );
}
