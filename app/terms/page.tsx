import type { Metadata } from "next";
import Link from "next/link";
import { Container, PageHeader } from "@/components/shell/AppShell";
import { APP_NAME } from "@/lib/brand";

export const metadata: Metadata = { title: "Terms of use", description: "The terms for using this Pagelyt site." };

export default function TermsPage() {
  return (
    <Container className="max-w-[760px]">
      <PageHeader title="Terms of use" subtitle="Plain-language terms for this deployment. Operators should replace this page with their own." />
      <div className="space-y-5 rounded-[16px] bg-surface p-6 text-[15px] leading-6 text-ink-2 shadow-card">
        <p>
          {APP_NAME} is provided as-is to help you work with your own documents. Only upload documents you have the right to process. Unlocking a password-protected PDF requires its
          password and is intended for documents you are authorised to access.
        </p>
        <p>Results are produced automatically. Check important output (for example converted layouts or OCR text) before relying on it.</p>
        <p>Signatures added with Sign PDF are visual marks, not certificate-based digital signatures.</p>
        <h2 id="contact" className="scroll-mt-20 pt-2 text-lg font-semibold text-ink">
          Contact
        </h2>
        <p>
          Questions about these terms go to the people who run this site: see the <Link href="/contact" className="text-accent hover:underline">contact page</Link>.
        </p>
      </div>
    </Container>
  );
}
