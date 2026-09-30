import type { MetadataRoute } from "next";
import { modules } from "@/lib/content";
import { SITE_URL } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const pages: [string, number][] = [
    ["", 1],
    ["/platform", 0.9],
    ["/solutions", 0.8],
    ["/pricing", 0.8],
    ["/security", 0.7],
    ["/company", 0.6],
    ["/contact", 0.7],
  ];
  return [
    ...pages.map(([path, priority]) => ({ url: `${SITE_URL}${path}`, lastModified: now, changeFrequency: "monthly" as const, priority })),
    ...modules.map((m) => ({
      url: `${SITE_URL}/platform/${m.slug}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.85,
      images: [`${SITE_URL}/images/${m.slug}.webp`],
    })),
  ];
}
