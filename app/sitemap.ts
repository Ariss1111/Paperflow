import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/brand";
import { TOOLS, toolHref } from "@/lib/tools/catalog";

export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = ["/", "/tools", "/editor", "/scan", "/ai", "/convert", "/pricing", "/privacy", "/terms", "/contact", "/signup"];
  const tools = TOOLS.map(toolHref).filter((h) => h.startsWith("/tools/"));
  return [...new Set([...pages, ...tools])].map((p) => ({ url: `${SITE_URL}${p}`, changeFrequency: "monthly", priority: p === "/" ? 1 : p.startsWith("/tools/") ? 0.7 : 0.8 }));
}
