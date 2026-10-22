import type { MetadataRoute } from "next";
import { listPosts } from "@/lib/cms";
import { modules } from "@/lib/content";
import { legalPages } from "@/lib/legal";
import { moduleShots } from "@/lib/module-shots";
import { SITE_URL } from "@/lib/seo";
import { shots } from "@/lib/shots";
import { industries, solutionsList } from "@/lib/solutions";

// Rebuilt every few minutes so newly published posts and articles appear.
export const revalidate = 300;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const entry = (path: string, priority: number, images?: string[]) => ({
    url: `${SITE_URL}${path}`,
    lastModified: now,
    changeFrequency: "monthly" as const,
    priority,
    ...(images ? { images: images.map((i) => `${SITE_URL}${i}`) } : {}),
  });
  const [guides, blog] = await Promise.all([listPosts("guide"), listPosts("blog")]);
  const post = (path: string, p: { updated_at: string }, priority: number) => ({ ...entry(path, priority), lastModified: new Date(p.updated_at), changeFrequency: "weekly" as const });
  return [
    entry("", 1, [shots.overview.src]),
    entry("/platform", 0.9, [shots.activity.src]),
    entry("/solutions", 0.9),
    entry("/industries", 0.8),
    entry("/product-tour", 0.8, Object.values(shots).map((s) => s.src)),
    entry("/how-it-works", 0.8),
    entry("/why-aavishield", 0.7),
    entry("/pricing", 0.8),
    entry("/security", 0.7),
    entry("/faq", 0.6),
    { ...entry("/knowledge-hub", 0.8), changeFrequency: "weekly" as const },
    { ...entry("/blog", 0.7), changeFrequency: "weekly" as const },
    ...guides.map((g) => post(`/knowledge-hub/${g.slug}`, g, 0.7)),
    ...blog.map((b) => post(`/blog/${b.slug}`, b, 0.6)),
    entry("/company", 0.6),
    entry("/contact", 0.7),
    ...modules.map((m) => entry(`/platform/${m.slug}`, 0.85, [shots[moduleShots[m.slug].hero].src])),
    ...solutionsList.map((s) => entry(`/solutions/${s.slug}`, 0.85, [shots[s.hero].src])),
    ...industries.map((i) => entry(`/industries/${i.slug}`, 0.75, [shots[i.hero].src])),
    ...legalPages.map((l) => ({ ...entry(`/${l.slug}`, 0.3), changeFrequency: "yearly" as const })),
  ];
}
