/**
 * Canonical origin for every canonical tag, Open Graph URL, JSON-LD id,
 * sitemap entry and robots line. Pages are prerendered, so this is baked in
 * at build time: rebuild after changing it. Override with NEXT_PUBLIC_SITE_URL
 * (no trailing slash) for staging builds.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://aavishield.com").replace(/\/+$/, "");
export const SITE_NAME = "Aavishield";

/** Official profiles: linked in the footer and listed as Organization `sameAs`. */
export const SOCIAL = [
  { name: "LinkedIn", href: "https://www.linkedin.com/company/aavishield/" },
  { name: "X", href: "https://x.com/aavishield" },
  { name: "Instagram", href: "https://www.instagram.com/aavishield/" },
] as const;

/** Renders a JSON-LD block. `<` is escaped so content can't close the script tag. */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}

export function faqLd(items: { q: string; a: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
}

export function breadcrumbLd(trail: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((t, i) => ({ "@type": "ListItem", position: i + 1, name: t.name, item: `${SITE_URL}${t.path}` })),
  };
}
