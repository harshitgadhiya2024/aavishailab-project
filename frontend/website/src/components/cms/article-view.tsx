import Link from "next/link";
import { ArrowLeft, ArrowUpRight, ChatsCircle } from "@phosphor-icons/react/dist/ssr";
import { Breadcrumbs } from "@/components/blocks";
import { Button } from "@/components/button";
import { CtaBand } from "@/components/cta-band";
import { Label } from "@/components/landing/grid";
import { CTA } from "@/lib/content";
import { BASE, categoryId, formatDate, type Post, type PostSummary } from "@/lib/cms";
import { outline, parseMarkdown } from "@/lib/markdown";
import { JsonLd, SITE_URL, breadcrumbLd } from "@/lib/seo";
import { Cover, PostCard } from "./post-card";
import { Prose } from "./prose";

const SECTION = { blog: "Blog", guide: "Knowledge hub" } as const;

/**
 * One blog post or knowledge hub article: a quiet header, the article with
 * an "On this page" outline, then related reading and a way to get help.
 * Guides also get a side list of the other articles in their section.
 */
export function ArticleView({ post, related, siblings = [] }: { post: Post; related: PostSummary[]; siblings?: PostSummary[] }) {
  const base = BASE[post.kind];
  const path = `${base}/${post.slug}`;
  const blocks = parseMarkdown(post.body);
  const toc = outline(blocks);
  const isGuide = post.kind === "guide";
  const updated = post.updated_at && post.updated_at.slice(0, 10) !== post.published_at?.slice(0, 10) ? post.updated_at : null;

  return (
    <>
      <JsonLd
        data={breadcrumbLd([
          { name: "Home", path: "" },
          { name: SECTION[post.kind], path: base },
          { name: post.title, path },
        ])}
      />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": isGuide ? "TechArticle" : "BlogPosting",
          headline: post.title,
          description: post.seo_description || post.excerpt,
          url: `${SITE_URL}${path}`,
          mainEntityOfPage: `${SITE_URL}${path}`,
          datePublished: post.published_at ?? undefined,
          dateModified: post.updated_at,
          articleSection: post.category || undefined,
          keywords: post.tags?.join(", ") || undefined,
          author: { "@type": "Organization", name: post.author_name || "Aavishield" },
          publisher: { "@type": "Organization", name: "Aavish AI Lab", logo: { "@type": "ImageObject", url: `${SITE_URL}/brand/mark-512.png` } },
          ...(post.cover_image ? { image: post.cover_image.startsWith("/") ? `${SITE_URL}${post.cover_image}` : post.cover_image } : {}),
        }}
      />

      {/* Header */}
      <header className="grid-band px-5 pb-12 pt-10 sm:px-8 md:px-12 md:pb-16 md:pt-14">
        <Breadcrumbs trail={[{ name: "Home", href: "/" }, { name: SECTION[post.kind], href: base }, { name: post.category || post.title }]} />
        <div className={`mt-10 grid gap-10 ${isGuide ? "" : "lg:grid-cols-[1.1fr_0.9fr] lg:items-end"}`}>
          <div>
            {post.category && <Label>{post.category}</Label>}
            <h1 className="mt-6 max-w-[22ch] text-[2.3rem] font-normal leading-[1.05] tracking-[-0.035em] text-fg sm:text-[3rem] lg:text-[3.4rem]">{post.title}</h1>
            {post.excerpt && <p className="mt-6 max-w-[58ch] text-[17px] leading-relaxed text-fg-2">{post.excerpt}</p>}
            <p className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] uppercase tracking-[0.08em] text-muted">
              {post.author_name && <span className="text-fg">{post.author_name}</span>}
              {post.published_at && <><span aria-hidden>·</span><time dateTime={post.published_at}>{formatDate(post.published_at)}</time></>}
              {updated && <><span aria-hidden>·</span><span>Updated {formatDate(updated)}</span></>}
              <span aria-hidden>·</span>
              <span>{post.reading_minutes} min read</span>
            </p>
          </div>
          {!isGuide && <Cover post={post} large />}
        </div>
      </header>

      {/* Article */}
      <div className="grid-band px-5 py-12 sm:px-8 md:px-12 md:py-16">
        <div className={`grid grid-cols-1 gap-12 [&>*]:min-w-0 ${isGuide ? "lg:grid-cols-[220px_1fr] xl:grid-cols-[220px_1fr_220px]" : "lg:grid-cols-[1fr_220px]"}`}>
          {isGuide && (
            <nav aria-label={`${post.category} articles`} className="hidden lg:block">
              <div className="sticky top-28">
                <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted">{post.category || "Articles"}</p>
                <ul className="mt-4 grid gap-0.5 border-l border-line">
                  {siblings.map((s) => {
                    const on = s.slug === post.slug;
                    return (
                      <li key={s.slug}>
                        <Link
                          href={`${base}/${s.slug}`}
                          aria-current={on ? "page" : undefined}
                          className={`-ml-px block border-l py-1.5 pl-4 text-[13.5px] leading-snug transition-colors ${on ? "border-brand text-fg" : "border-transparent text-muted hover:text-fg"}`}
                        >
                          {s.title}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
                <Link href={`${base}#${categoryId(post.category)}`} className="mt-6 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-fg underline decoration-fg/30 underline-offset-4 hover:text-brand-ink">
                  <ArrowLeft size={12} /> All articles
                </Link>
              </div>
            </nav>
          )}

          <article>
            <Prose blocks={blocks} />
          </article>

          {toc.length > 1 && (
            <aside className={`hidden ${isGuide ? "xl:block" : "lg:block"}`}>
              <div className="sticky top-28">
                <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted">On this page</p>
                <ul className="mt-4 grid gap-2">
                  {toc.map((h) => (
                    <li key={h.id}>
                      <a href={`#${h.id}`} className="text-[13.5px] leading-snug text-muted transition-colors hover:text-brand-ink">{h.text.replace(/[*`_]/g, "")}</a>
                    </li>
                  ))}
                </ul>
                <div className="mt-8 rounded-[6px] border border-brand/20 bg-brand-soft p-4">
                  <p className="text-sm text-fg">See it on your own devices.</p>
                  <Link href="/contact" className="mt-3 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-brand-ink hover:underline">
                    {CTA.demo} <ArrowUpRight size={12} />
                  </Link>
                </div>
              </div>
            </aside>
          )}
        </div>
      </div>

      {/* Help */}
      <section className="grid-band px-5 py-12 sm:px-8 md:px-12">
        <div className="flex flex-col gap-6 rounded-[6px] border border-line bg-surface p-6 md:flex-row md:items-center md:justify-between md:p-8">
          <div className="flex items-start gap-4">
            <span className="grid size-10 shrink-0 place-items-center rounded-[4px] border border-brand/30 bg-brand-soft text-brand-ink">
              <ChatsCircle size={18} />
            </span>
            <div>
              <p className="text-lg tracking-[-0.01em] text-fg">{isGuide ? "Still have a question about this?" : "Want to see this on your own devices?"}</p>
              <p className="mt-1 text-sm text-muted">
                {isGuide ? "Ask the engineers who build Aavishield, or check the FAQ." : "A pilot can be live in an afternoon, on a small group of laptops."}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-3">
            <Button href="/contact">{isGuide ? "Ask the team" : CTA.demo}</Button>
            <Button href={isGuide ? "/faq" : "/knowledge-hub"} variant="ghost">{isGuide ? "Read the FAQ" : "Knowledge hub"}</Button>
          </div>
        </div>
      </section>

      {related.length > 0 && (
        <section className="grid-band px-5 py-16 sm:px-8 md:px-12 md:py-20">
          <Label>{isGuide ? "Related articles" : "Keep reading"}</Label>
          {isGuide ? (
            <div className="mt-8 grid grid-cols-1 gap-px overflow-hidden rounded-[6px] border border-line bg-line md:grid-cols-3">
              {related.map((r) => (
                <Link key={r.slug} href={`${base}/${r.slug}`} className="group flex flex-col bg-bg p-6 transition-shadow duration-300 hover:shadow-[inset_0_0_0_1px_rgb(255_112_0/0.45)]">
                  <span className="text-[1.1rem] leading-snug tracking-[-0.015em] text-fg">{r.title}</span>
                  <span className="mt-2 line-clamp-2 text-sm text-muted">{r.excerpt}</span>
                  <span className="mt-5 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-fg group-hover:text-brand-ink">
                    Read <ArrowUpRight size={12} />
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-3">
              {related.map((r) => <PostCard key={r.slug} post={r} />)}
            </div>
          )}
        </section>
      )}

      <CtaBand />
    </>
  );
}
