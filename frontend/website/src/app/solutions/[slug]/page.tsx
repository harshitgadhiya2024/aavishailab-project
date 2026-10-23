import { ArtBand } from "@/components/flow-steps";
import { ThreatQueueWidget } from "@/components/landing/section-widgets";
import type { Metadata } from "next";
import { ModuleVisual } from "@/components/landing/hero-widgets";
import { PageHero } from "@/components/page-hero";
import { notFound } from "next/navigation";
import { BeforeAfter, Breadcrumbs, CardGrid, FaqSection, FeatureSplit, LinkCards } from "@/components/blocks";
import { Button } from "@/components/button";
import { CtaBand } from "@/components/cta-band";
import { ModuleIcon } from "@/components/icons";
import { Reveal } from "@/components/motion/reveal";
import { Section, SectionHead } from "@/components/section";
import { SolutionIcon } from "@/components/solution-icon";
import { CTA, getModule } from "@/lib/content";
import { JsonLd, SITE_URL, breadcrumbLd, faqLd } from "@/lib/seo";
import { shots } from "@/lib/shots";
import { getSolution, industries, solutionsList } from "@/lib/solutions";

export function generateStaticParams() {
  return solutionsList.map((s) => ({ slug: s.slug }));
}

export const dynamicParams = false;

export async function generateMetadata(props: PageProps<"/solutions/[slug]">): Promise<Metadata> {
  const s = getSolution((await props.params).slug);
  if (!s) return {};
  const path = `/solutions/${s.slug}`;
  return {
    title: s.seoTitle,
    description: s.description,
    keywords: s.keywords,
    alternates: { canonical: path },
    openGraph: { url: path, title: `${s.seoTitle} | Aavishield`, description: s.description, type: "article" },
    twitter: { title: `${s.seoTitle} | Aavishield`, description: s.description },
  };
}

export default async function SolutionPage(props: PageProps<"/solutions/[slug]">) {
  const s = getSolution((await props.params).slug);
  if (!s) notFound();
  const path = `/solutions/${s.slug}`;
  const idx = solutionsList.indexOf(s);
  const related = [1, 2, 3].map((n) => solutionsList[(idx + n) % solutionsList.length]);
  const inds = industries.filter((i) => i.solutions.includes(s.slug)).slice(0, 3);

  return (
    <>
      <JsonLd data={breadcrumbLd([{ name: "Home", path: "" }, { name: "Solutions", path: "/solutions" }, { name: s.name, path }])} />
      <JsonLd data={faqLd(s.faqs)} />
      <JsonLd data={{ "@context": "https://schema.org", "@type": "WebPage", name: s.seoTitle, description: s.description, url: `${SITE_URL}${path}`, isPartOf: { "@id": `${SITE_URL}/#website` } }} />

      {/* 1. Hero */}
      <PageHero
        top={<Breadcrumbs trail={[{ name: "Home", href: "/" }, { name: "Solutions", href: "/solutions" }, { name: s.name }]} />}
        eyebrow={s.seoTitle}
        title={s.headline}
        accent={s.accent}
        body={s.intro}
        visual={<ModuleVisual slug={s.modules[0]} />}
      >
        <Button href="/contact" size="lg">{CTA.demo}</Button>
        <Button href="#how" size="lg" variant="ghost">How we solve it</Button>
      </PageHero>

      {/* 2. The problem */}

      <Section>
        <div className="grid gap-12 lg:grid-cols-[1fr_1fr] [&>*]:min-w-0">
          <div>
            <SectionHead eyebrow="The problem" title={s.problem.title} body={s.problem.body} />
            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              {s.problem.points.map((p, i) => (
                <Reveal key={p.title} delay={i * 0.06} className="rounded-[6px] border border-line bg-surface p-6">
                  <span className="font-mono text-xs text-brand-ink">0{i + 1}</span>
                  <h3 className="mt-3 font-normal text-fg">{p.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{p.body}</p>
                </Reveal>
              ))}
            </div>
          </div>
          <Reveal y={40}>
            <ThreatQueueWidget items={s.problem.points} modules={s.modules} />
          </Reveal>
        </div>
      </Section>

      {/* 3. Why now */}
      {/* Full-width black band with line art, as on the feature pages. Each
          point borrows art from the controls this solution uses, so the
          three differ from one solution page to the next. */}
      <section className="grid-band">
        <ArtBand
          label="Why it is happening now"
          title="The market changed faster than the"
          accent="controls."
          items={s.why.map((w, i) => ({ title: w.title, body: w.body, art: { slug: s.modules[i % s.modules.length], kind: i } }))}
        />
      </section>

      {/* 4. Cost of ignoring it */}
      <Section>
        <SectionHead eyebrow="What it costs" title="Ignoring it is the expensive option." accent={["expensive"]} />
        <div className="mt-12"><CardGrid items={s.cost} /></div>
      </Section>

      {/* 5. How Aavishield solves it */}
      <Section id="how">
        <SectionHead eyebrow="How Aavishield solves it" title="Three steps, screen by screen." accent={["screen"]} body="The console screens behind each step, shown with demo data." />
        <div className="mt-16 grid gap-24">
          {s.steps.map((st, i) => (
            <FeatureSplit key={st.title} eyebrow={`Step ${i + 1} · ${st.verb}`} title={st.title} body={st.body} shot={shots[st.shot]} reverse={i % 2 === 1} />
          ))}
        </div>
      </Section>

      {/* 6. Before / after */}
      <Section>
        <SectionHead eyebrow="Before and after" title="What changes in the first week." accent={["first", "week."]} />
        <div className="mt-12"><BeforeAfter before={s.before} after={s.after} /></div>
      </Section>

      {/* 7. Controls used */}
      <Section>
        <SectionHead eyebrow="Controls used" title="Built from the platform you already get." body="No extra product to buy. These controls run in the same agent and report to the same console." />
        <div className="mt-12">
          <LinkCards
            items={s.modules.map((slug) => {
              const m = getModule(slug)!;
              return { href: `/platform/${m.slug}`, title: m.name, body: m.short, icon: <ModuleIcon icon={m.icon} size={22} /> };
            })}
          />
        </div>
      </Section>

      {/* 8. Outcomes */}
      <Section>
        <SectionHead eyebrow="Outcomes" title="What you can say after rollout." accent={["say"]} />
        <div className="mt-12"><CardGrid items={s.outcomes} cols={4} /></div>
      </Section>

      {/* 9. FAQ */}
      <FaqSection title={`${s.name}: common questions`} items={s.faqs} />

      {/* 10. Related */}
      <Section>
        <SectionHead eyebrow="Keep exploring" title="Related problems we solve." />
        <div className="mt-10">
          <LinkCards items={related.map((r) => ({ href: `/solutions/${r.slug}`, title: r.name, body: r.menu, icon: <SolutionIcon icon={r.icon} size={22} /> }))} more={{ href: "/solutions", label: "All solutions" }} />
        </div>
        {inds.length > 0 && (
          <div className="mt-6">
            <LinkCards items={inds.map((r) => ({ href: `/industries/${r.slug}`, title: r.name, body: r.menu, icon: <SolutionIcon icon={r.icon} size={22} /> }))} more={{ href: "/industries", label: "All industries" }} />
          </div>
        )}
      </Section>

      <CtaBand title="Show us your version of this problem." />
    </>
  );
}
