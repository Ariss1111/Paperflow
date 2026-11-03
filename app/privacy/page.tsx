import type { Metadata } from "next";
import { Container, PageHeader } from "@/components/shell/AppShell";
import { APP_NAME } from "@/lib/brand";
import { env } from "@/lib/server/env";

export const metadata: Metadata = { title: "Privacy & Security", description: "Exactly what happens to a document you give Pagelyt: what is uploaded, how it is processed, what is stored and for how long." };
export const dynamic = "force-dynamic";

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[16px] bg-surface p-6 shadow-card">
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      <div className="mt-2 space-y-2 text-[15px] leading-6 text-ink-2">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  const minutes = Math.round(env.retentionMs / 60000);
  return (
    <Container className="max-w-[820px]">
      <PageHeader title="Privacy & Security" subtitle={`Exactly what happens to a document you give ${APP_NAME}.`} />
      <div className="space-y-4">
        <Block title="What is uploaded">
          <p>Only the files you choose. They travel from your browser to this server over the connection you&apos;re using (HTTPS when deployed with TLS). Page previews and thumbnails are rendered in your browser from that same copy.</p>
          <p>No account, email or name is needed to use the tools. A random, anonymous session cookie (httpOnly, SameSite=Strict) links your files to your browser so nobody else can access them.</p>
        </Block>
        <Block title="If you create an account">
          <p>An account is optional and only needed to keep documents. We store your email address, the name you give, and your password as a salted scrypt hash (never the password itself). If you sign in with Google, we receive your Google account id, name and verified email address, and nothing else.</p>
          <p>Signing in creates a session: a random token in an httpOnly cookie. The server keeps only a SHA-256 hash of it, so a copy of the database can't be used to sign in. Sessions last 30 days; changing or resetting your password, or using “Sign out of other devices”, ends every other session.</p>
          <p>Documents you save are stored under random names in private storage that isn't reachable from the web: an S3-compatible bucket such as Cloudflare R2 in production, or a private folder on the server. Every request checks that the document is yours; another account's document looks exactly like one that doesn't exist. Files are delivered through signed links that stop working after a few minutes.</p>
          <p>Cloudflare R2 and Amazon S3 encrypt stored files at rest. {APP_NAME} doesn't add its own encryption layer on top, because the server has to read a document to process it.</p>
        </Block>
        <Block title="Sharing">
          <p>Share links contain 128 random bits, so they can't be guessed. You decide whether anyone with the link or only the people you name can open it, whether a password is needed, whether downloading is allowed, and when the link stops working. You can revoke a link at any time, and moving a document to the Trash turns off its links at once. Link passwords are stored as hashes, and wrong guesses are rate-limited.</p>
          <p>“View only” removes downloading, but anyone who can see a document can still photograph or screenshot it.</p>
        </Block>
        <Block title="How files are processed">
          <p>Each job runs in its own temporary folder with a random name; uploaded file names are never used as paths. Processing happens on this server with open-source engines: MuPDF and pdf-lib for PDFs, LibreOffice (headless, with a timeout) for Office formats, libvips for images, and Tesseract for OCR.</p>
          <p>Files are identified by their content rather than their extension, size-limited, and malformed files are rejected with an explanation. Documents are never sent to third-party services, with one exception you control: when you run an AI tool, that document is sent to Anthropic&apos;s Claude API to produce the answer. The Smart Scanner works entirely in your browser.</p>
        </Block>
        <Block title="What is stored, and for how long">
          <p>Files you use in tools without saving them are kept for {minutes} minutes so you can download them and chain tools, then deleted automatically. You can delete any of them immediately from My Documents.</p>
          <p>Documents saved to an account stay until you delete them. Deleted documents wait in the Trash for 30 days, then they and all their versions are removed from storage. Each document keeps its 10 most recent versions. Accounts whose email address is never confirmed are deleted after 7 days. Deleting your account removes its documents, versions, folders, links and sessions immediately. Backups kept by the hosting provider expire on that provider's schedule.</p>
          <p>Passwords you enter to protect or unlock PDFs are used for that single job and discarded when it finishes. They are never written to logs or disk. Document contents are never logged.</p>
          <p>Your preferences (theme, defaults) and the editor&apos;s autosaved working state live in your browser&apos;s local storage and never leave your device.</p>
        </Block>
        <Block title="What we don't claim">
          <p>{APP_NAME} does not offer end-to-end encryption or zero-knowledge processing — the server has to read a document to transform it. Signatures placed with Sign PDF are visual; they are not certificate-based digital signatures. Protect PDF uses AES-256 encryption, which is strong, but its permission flags are only honoured by compliant viewers.</p>
        </Block>
        <Block title="Security measures">
          <ul className="list-disc space-y-1 pl-5">
            <li>Downloads only work from the browser session that created them and stop working when files expire.</li>
            <li>State-changing requests must come from this site (same-origin checks plus SameSite cookies).</li>
            <li>Rate limits on uploads and jobs; size limits and decompression-bomb guards on images.</li>
            <li>Results are served with a sandboxing Content-Security-Policy so HTML or SVG outputs can&apos;t run code on this site.</li>
            <li>LibreOffice runs headless with a hard timeout; HTML inputs are stripped of scripts and remote resources before conversion.</li>
            <li>Optional ClamAV malware scanning for every upload, failing closed when enabled.</li>
          </ul>
        </Block>
      </div>
    </Container>
  );
}
