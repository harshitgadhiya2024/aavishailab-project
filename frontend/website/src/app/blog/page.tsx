import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/button";
import { BlogBrowser } from "@/components/cms/blog-browser";
import { Cover, Meta, PostCard } from "@/components/cms/post-card";
import { CtaBand } from "@/components/cta-band";
import { BlogHero } from "@/components/landing/hero-widgets";
import { Label } from "@/components/landing/grid";
import { PageHero } from "@/components/page-hero";
import { Section } from "@/components/section";
import { listPosts } from "@/lib/cms";
import { JsonLd, SITE_URL, breadcrumbLd } from "@/lib/seo";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Blog: Endpoint Security, DLP and Remote Work",
  description:
    "Practical writing from the Aavishield team on data loss prevention, AI data leakage, web filtering, VPN bypass and rolling out endpoint security.",
  alternates: { canonical: "/blog" },
  openGraph: { url: "/blog" },
};

export default async function BlogPage() {
  const posts = await listPosts("blog");
  const lead = posts.find((p) => p.featured) ?? posts[0];
  const rest = posts.filter((p) => p !== lead);

  return (
    <>
      <JsonLd data={breadcrumbLd([{ name: "Home", path: "" }, { name: "Blog", path: "/blog" }])} />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Blog",
          name: "Aavishield blog",
          url: `${SITE_URL}/blog`,
          blogPost: posts.map((p) => ({ "@type": "BlogPosting", headline: p.title, url: `${SITE_URL}/blog/${p.slug}`, datePublished: p.published_at ?? undefined })),
        }}
      />

      <PageHero
        visual={<BlogHero />}
        eyebrow="Aavishield blog"
        title="Notes on keeping company data where it belongs."
        accent={["belongs."]}
        body="Practical writing on data loss prevention, AI tools at work, web filtering and rolling out security without losing your team's trust."
      >
        <Button href="#posts" size="lg">Read the latest</Button>
        <Button href="/knowledge-hub" variant="ghost" size="lg">Knowledge hub</Button>
      </PageHero>

      {lead ? (
        <>
          <Section id="posts">
            <Label>Latest</Label>
            <Link href={`/blog/${lead.slug}`} className="group mt-8 grid items-center gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:gap-14">
              <Cover post={lead} large />
              <div>
                <Meta post={lead} />
                <h2 className="mt-4 text-[1.9rem] font-normal leading-[1.1] tracking-[-0.03em] text-fg transition-colors group-hover:text-brand-ink md:text-[2.4rem]">{lead.title}</h2>
                <p className="mt-4 max-w-[52ch] text-[16px] leading-relaxed text-muted">{lead.excerpt}</p>
                <span className="mt-8 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-fg underline decoration-fg/30 underline-offset-4 group-hover:text-brand-ink">
                  Read the post <ArrowUpRight size={12} />
                </span>
              </div>
            </Link>
          </Section>

          {rest.length > 0 && (
            <Section>
              <BlogBrowser posts={rest} cards={rest.map((p) => <PostCard key={p.slug} post={p} />)} />
            </Section>
          )}
        </>
      ) : (
        <Section id="posts">
          <p className="text-muted">The first posts are on their way. Meanwhile, the <Link href="/knowledge-hub" className="text-brand-ink underline">knowledge hub</Link> has practical guides.</p>
        </Section>
      )}

      <CtaBand />
    </>
  );
}
