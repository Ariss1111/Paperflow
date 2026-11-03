// Plans shown on the homepage and /pricing. Edit this list to change pricing everywhere.
// Only plans that actually exist belong here: there is no billing system yet, so Pagelyt is free.
export interface Plan {
  id: string;
  name: string;
  price: string;
  period?: string;
  blurb: string;
  features: string[];
  cta: { label: string; href: string };
  highlighted?: boolean;
}

export const PLANS: Plan[] = [
  {
    id: "free",
    name: "Everything included",
    price: "Free",
    blurb: "Every tool, with no account and no watermark.",
    features: [
      "All PDF, conversion and editing tools",
      "Smart Scanner with automatic cropping",
      "Sign and password-protect documents",
      "Files deleted automatically after use",
      "AI chat, summaries, translation and extraction when enabled on this server, within a daily allowance",
    ],
    cta: { label: "Start now", href: "/tools" },
    highlighted: true,
  },
];
