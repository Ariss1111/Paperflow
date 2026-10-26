import type { Metadata } from "next";
import { Container, PageHeader } from "@/components/shell/AppShell";
import { APP_NAME } from "@/lib/brand";
import { env } from "@/lib/server/env";

export const metadata: Metadata = { title: "Privacy & Security" };
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
          <p>No account, email or name is needed. A random, anonymous session cookie (httpOnly, SameSite=Strict) links your files to your browser so nobody else can access them.</p>
        </Block>
        <Block title="How files are processed">
          <p>Each job runs in its own temporary folder with a random name; uploaded file names are never used as paths. Processing happens on this server with open-source engines: MuPDF and pdf-lib for PDFs, LibreOffice (headless, with a timeout) for Office formats, libvips for images, and Tesseract for OCR.</p>
          <p>Files are identified by their content rather than their extension, size-limited, and malformed files are rejected with an explanation. Documents are never sent to third-party services.</p>
        </Block>
        <Block title="What is stored, and for how long">
          <p>Uploads and results are kept for {minutes} minutes so you can download them and chain tools, then deleted automatically. You can delete any file immediately from My Files. Restarting the server also clears everything.</p>
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
