import type { Metadata } from "next";
import { Container, PageHeader } from "@/components/shell/AppShell";
import { PricingPlans } from "@/components/home/Pricing";

export const metadata: Metadata = { title: "Pricing", description: "Every Pagelyt tool is free to use: PDF tools, the Smart Scanner, the editor and signing." };

export default function PricingPage() {
  return (
    <Container>
      <PageHeader title="Pricing" subtitle="Simple and transparent. Everything in Pagelyt is free to use today." />
      <PricingPlans />
    </Container>
  );
}
