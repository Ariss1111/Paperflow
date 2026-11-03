import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/brand";

export const dynamic = "force-dynamic";

/** Public pages are open to search engines; accounts, documents, share links and APIs aren't. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/s/", "/documents/", "/account", "/files", "/settings", "/verify", "/reset", "/dev/"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
