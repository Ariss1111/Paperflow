import type { Metadata } from "next";
import Link from "next/link";
import { Mail } from "lucide-react";
import { Container, PageHeader } from "@/components/shell/AppShell";
import { APP_NAME } from "@/lib/brand";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Contact", description: `How to reach the people who run this ${APP_NAME} site.` };

/** Shows the address set in CONTACT_EMAIL. Nothing is made up when it isn't set. */
export default function ContactPage() {
  const email = process.env.CONTACT_EMAIL?.trim();
  return (
    <Container className="max-w-[760px]">
      <PageHeader title="Contact" subtitle={`Questions, feedback or a problem with ${APP_NAME}.`} />
      <div className="space-y-4 rounded-[16px] bg-surface p-6 text-[15px] leading-6 text-ink-2 shadow-card">
        {email ? (
          <p className="flex flex-wrap items-center gap-2">
            <Mail className="size-4 text-accent" /> Email{" "}
            <a href={`mailto:${email}`} className="font-medium text-accent hover:underline">
              {email}
            </a>
          </p>
        ) : (
          <p>A contact address hasn&apos;t been published for this site yet.</p>
        )}
        <p>
          Please don&apos;t send documents by email. For questions about how files are handled, see <Link href="/privacy" className="text-accent hover:underline">Privacy &amp; Security</Link>.
        </p>
      </div>
    </Container>
  );
}
