"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Inbox, MailCheck } from "lucide-react";
import { AppIcon } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/controls";
import { Notice } from "@/components/ui/feedback";
import { call, refreshAccount, useAccount } from "@/lib/client/account";

/** Same-site paths only, as the server enforces too. */
const nextPath = (p: string | null) => (p && /^\/(?![/\\])/.test(p) ? p : "/files");

function Card({ title, subtitle, children, footer }: { title: string; subtitle?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="flex min-h-[calc(100dvh-56px)] items-start justify-center px-4 py-10 sm:items-center">
      <div className="w-full max-w-[400px]">
        <div className="mb-6 flex flex-col items-center text-center">
          <AppIcon className="size-12" />
          <h1 className="mt-4 text-2xl font-semibold tracking-[-0.022em] text-ink">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-ink-2">{subtitle}</p>}
        </div>
        <div className="space-y-4 rounded-[20px] bg-surface p-6 shadow-card">{children}</div>
        {footer && <div className="mt-5 text-center text-sm text-ink-2">{footer}</div>}
      </div>
    </div>
  );
}

function GoogleButton({ next }: { next: string }) {
  const { features } = useAccount();
  if (!features.google) return null;
  return (
    <>
      <a href={`/api/auth/google?next=${encodeURIComponent(next)}`} className="flex h-11 w-full items-center justify-center gap-2.5 rounded-xl bg-surface text-[15px] font-medium text-ink shadow-[inset_0_0_0_1px_rgb(var(--line)/0.18)] transition-colors hover:bg-ink/[0.03]">
        <svg viewBox="0 0 48 48" className="size-[18px]" aria-hidden>
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
          <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
        </svg>
        Continue with Google
      </a>
      <div className="flex items-center gap-3 text-xs text-ink-3">
        <span className="h-px flex-1 bg-ink/10" /> or <span className="h-px flex-1 bg-ink/10" />
      </div>
    </>
  );
}

function DevInboxHint() {
  const { features } = useAccount();
  if (!features.devMailbox) return null;
  return (
    <Notice tone="info">
      This is a development server without email: messages appear in the <Link href="/dev/mail" className="font-medium text-accent hover:underline">dev inbox</Link>.
    </Notice>
  );
}

export function SignInPage() {
  const router = useRouter();
  const params = useSearchParams();
  const next = nextPath(params.get("next"));
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(params.get("error"));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await call("/api/auth/login", "POST", { email, password });
      await refreshAccount();
      router.push(next);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <Card title="Sign in to Pagelyt" subtitle="Your documents, on every device." footer={<>New to Pagelyt? <Link href={`/signup${next !== "/files" ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-medium text-accent hover:underline">Create an account</Link></>}>
      <GoogleButton next={next} />
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email" htmlFor="si-email">
          <Input id="si-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" htmlFor="si-password">
          <Input id="si-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
          Sign in
        </Button>
        <p className="text-center text-sm">
          <Link href="/reset" className="text-accent hover:underline">
            Forgot your password?
          </Link>
        </p>
      </form>
      <p className="text-center text-xs text-ink-3">You don&apos;t need an account to use the PDF tools.</p>
    </Card>
  );
}

export function SignUpPage() {
  const params = useSearchParams();
  const next = nextPath(params.get("next"));
  const { features, loaded } = useAccount();
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await call("/api/auth/signup", "POST", { name, email, password });
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (sent)
    return (
      <Card title="Check your email" subtitle={<>We sent a confirmation link to <b className="text-ink">{email}</b>.</>}>
        <div className="flex flex-col items-center gap-3 py-2 text-center text-sm text-ink-2">
          <MailCheck className="size-10 text-accent" />
          <p>Open the link to confirm your address and sign in. It works for 48 hours. Check your spam folder if it doesn&apos;t arrive in a minute.</p>
        </div>
        <DevInboxHint />
      </Card>
    );
  return (
    <Card title="Create your account" subtitle="Save documents, open them anywhere, share them safely." footer={<>Already have an account? <Link href="/signin" className="font-medium text-accent hover:underline">Sign in</Link></>}>
      <GoogleButton next={next} />
      {loaded && !features.email ? (
        <Notice tone="warning">Sign-up with email isn&apos;t available because this server can&apos;t send email yet.{features.google ? " Use Continue with Google." : ""}</Notice>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Name" htmlFor="su-name">
            <Input id="su-name" autoComplete="name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Email" htmlFor="su-email">
            <Input id="su-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password" htmlFor="su-password" hint="At least 10 characters. A short phrase works well.">
            <Input id="su-password" type="password" autoComplete="new-password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {error && <Notice tone="danger">{error}</Notice>}
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
            Create account
          </Button>
          <p className="text-center text-xs leading-4 text-ink-3">
            By creating an account you agree to the <Link href="/terms" className="underline">terms</Link> and <Link href="/privacy" className="underline">privacy policy</Link>.
          </p>
        </form>
      )}
    </Card>
  );
}

export function VerifyPage() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token");
  const [state, setState] = React.useState<"working" | "done" | "error">("working");
  const [error, setError] = React.useState("");
  const ran = React.useRef(false);
  React.useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    call("/api/auth/verify", "POST", { token })
      .then(async () => {
        await refreshAccount();
        setState("done");
        setTimeout(() => router.push("/files"), 1500);
      })
      .catch((e) => {
        setError((e as Error).message);
        setState("error");
      });
  }, [token, router]);
  return (
    <Card title={state === "done" ? "Email confirmed" : state === "error" ? "That link didn't work" : "Confirming…"}>
      {state === "done" && (
        <div className="flex flex-col items-center gap-3 text-center text-sm text-ink-2">
          <CheckCircle2 className="size-10 text-success" />
          <p>You&apos;re signed in. Taking you to My Documents…</p>
        </div>
      )}
      {state === "error" && (
        <>
          <Notice tone="danger">{error}</Notice>
          <Button className="w-full" onClick={() => router.push("/signin")}>
            Sign in
          </Button>
        </>
      )}
    </Card>
  );
}

export function ResetRequestPage() {
  const [email, setEmail] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <Card title="Reset your password" subtitle="We'll email you a link to choose a new one." footer={<Link href="/signin" className="text-accent hover:underline">Back to sign in</Link>}>
      {sent ? (
        <>
          <p className="text-sm text-ink-2">
            If <b className="text-ink">{email}</b> has a Pagelyt account, a reset link is on its way. It works for 1 hour.
          </p>
          <DevInboxHint />
        </>
      ) : (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await call("/api/auth/reset", "POST", { email });
              setSent(true);
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Email" htmlFor="rs-email">
            <Input id="rs-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          {error && <Notice tone="danger">{error}</Notice>}
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
            Send reset link
          </Button>
        </form>
      )}
    </Card>
  );
}

export function ResetConfirmPage() {
  const router = useRouter();
  const token = useSearchParams().get("token");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <Card title="Choose a new password" subtitle="You'll be signed out on every other device.">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await call("/api/auth/reset", "POST", { token, password });
            await refreshAccount();
            router.push("/files");
          } catch (err) {
            setError((err as Error).message);
            setBusy(false);
          }
        }}
      >
        <Field label="New password" htmlFor="rc-password" hint="At least 10 characters.">
          <Input id="rc-password" type="password" autoComplete="new-password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
          Save password
        </Button>
      </form>
    </Card>
  );
}

export function DevMailPage() {
  const [messages, setMessages] = React.useState<{ id: string; to: string; subject: string; text: string; at: number }[] | null>(null);
  const [missing, setMissing] = React.useState(false);
  const load = React.useCallback(() => {
    fetch("/api/dev/mail", { cache: "no-store" }).then(async (r) => (r.ok ? setMessages((await r.json()).messages) : setMissing(true)));
  }, []);
  React.useEffect(load, [load]);
  if (missing) return <Card title="Not available">The dev inbox only exists on development servers without email.</Card>;
  return (
    <div className="mx-auto max-w-[760px] px-4 py-10">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-ink">
          <Inbox className="size-6 text-accent" /> Dev inbox
        </h1>
        <Button size="sm" onClick={load}>
          Refresh
        </Button>
      </div>
      <p className="mb-5 text-sm text-ink-2">Emails this development server would have sent. In production they go out through SMTP and this page doesn&apos;t exist.</p>
      <ul className="space-y-3">
        {messages?.map((m) => (
          <li key={m.id} className="rounded-2xl bg-surface p-4 shadow-card" data-testid="dev-mail">
            <p className="text-xs text-ink-3">
              To {m.to} · {new Date(m.at).toLocaleString()}
            </p>
            <p className="mt-1 font-semibold text-ink">{m.subject}</p>
            <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-sm text-ink-2">
              {m.text.split(/(https?:\/\/\S+)/).map((part, i) =>
                /^https?:\/\//.test(part) ? (
                  <a key={i} href={part} className="text-accent underline">
                    {part}
                  </a>
                ) : (
                  part
                ),
              )}
            </pre>
          </li>
        ))}
        {messages?.length === 0 && <li className="text-sm text-ink-3">No emails yet.</li>}
      </ul>
    </div>
  );
}
