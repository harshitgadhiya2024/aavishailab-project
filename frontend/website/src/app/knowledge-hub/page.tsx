import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, ChatsCircle, Compass, Question } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/button";
import { HubBrowser } from "@/components/cms/hub-browser";
import { CtaBand } from "@/components/cta-band";
import { HubHero } from "@/components/landing/hero-widgets";
import { Reveal } from "@/components/motion/reveal";
import { LinkCards } from "@/components/blocks";
import { PageHero } from "@/components/page-hero";
import { Section, SectionHead } from "@/components/section";
import { categoryId, groupGuides, listPosts } from "@/lib/cms";
import { JsonLd, SITE_URL, breadcrumbLd } from "@/lib/seo";

// Articles are edited in the superadmin panel; pick up changes every few minutes.
export const revalidate = 300;

export const metadata: Metadata = {
  title: "Knowledge Hub: Endpoint Security Guides",
  description:
    "Step-by-step guides for Aavishield: set up your organisation, install the agent, block websites and apps, understand DLP, and roll out to your team.",
  alternates: { canonical: "/knowledge-hub" },
  openGraph: { url: "/knowledge-hub" },
};

export default async function KnowledgeHubPage() {
  const posts = await listPosts("guide");
  const groups = groupGuides(posts).map((g) => ({ ...g, id: categoryId(g.name) }));
  const starters = posts.filter((p) => p.featured).slice(0, 3);

  return (
    <>
      <JsonLd data={breadcrumbLd([{ name: "Home", path: "" }, { name: "Knowledge hub", path: "/knowledge-hub" }])} />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: "Aavishield knowledge hub",
          url: `${SITE_URL}/knowledge-hub`,
          hasPart: posts.map((p) => ({ "@type": "TechArticle", headline: p.title, url: `${SITE_URL}/knowledge-hub/${p.slug}` })),
        }}
      />

      <PageHero
        visual={<HubHero />}
        eyebrow="Aavishield knowledge hub"
        title="Answers for every step of your rollout."
        accent={["rollout."]}
        body="Practical guides for setting up Aavishield, choosing policy, protecting data and bringing your team along. Written by the people who build it."
      >
        <Button href="#browse" size="lg">Browse articles</Button>
        <Button href="/contact" variant="ghost" size="lg">Ask the team</Button>
      </PageHero>

      {starters.length > 0 && (
        <Section>
          <SectionHead eyebrow="Start here" title="New to Aavishield? Read these first." />
          <div className="mt-10 grid grid-cols-1 gap-px overflow-hidden rounded-[6px] border border-line bg-line md:grid-cols-3">
            {starters.map((p, i) => (
              <Reveal key={p.slug} delay={i * 0.06} className="bg-bg">
                <Link href={`/knowledge-hub/${p.slug}`} className="group flex h-full flex-col p-6 transition-colors duration-300 hover:bg-brand-soft md:p-8">
                  <span className="font-mono text-[11px] text-brand-ink">{String(i + 1).padStart(2, "0")} · {p.category}</span>
                  <span className="mt-4 text-[1.3rem] leading-snug tracking-[-0.02em] text-fg">{p.title}</span>
                  <span className="mt-2 text-sm leading-relaxed text-muted">{p.excerpt}</span>
                  <span className="mt-auto inline-flex items-center gap-1.5 pt-6 font-mono text-[11px] uppercase tracking-[0.1em] text-fg group-hover:text-brand-ink">
                    {p.reading_minutes} min read <ArrowUpRight size={12} />
                  </span>
                </Link>
              </Reveal>
            ))}
          </div>
        </Section>
      )}

      <Section id="browse">
        {groups.length > 0 ? (
          <HubBrowser groups={groups} />
        ) : (
          <p className="text-muted">Articles are on their way. In the meantime, the <Link href="/faq" className="text-brand-ink underline">FAQ</Link> answers the common questions.</p>
        )}
      </Section>

      <Section>
        <SectionHead eyebrow="More help" title="Still looking for something?" />
        <div className="mt-10">
          <LinkCards
            items={[
              { href: "/faq", title: "FAQ", body: "Short answers to the questions teams ask most.", icon: <Question size={18} /> },
              { href: "/product-tour", title: "Product tour", body: "See every screen of the console with demo data.", icon: <Compass size={18} /> },
              { href: "/contact", title: "Talk to the team", body: "Ask the engineers who build Aavishield directly.", icon: <ChatsCircle size={18} /> },
            ]}
          />
        </div>
      </Section>

      <CtaBand />
    </>
  );
}
