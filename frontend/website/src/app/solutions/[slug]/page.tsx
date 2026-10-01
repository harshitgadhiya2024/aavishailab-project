import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { BeforeAfter, Breadcrumbs, CardGrid, FaqSection, FeatureSplit, LinkCards } from "@/components/blocks";
import { BrowserFrame } from "@/components/browser-frame";
import { Button } from "@/components/button";
import { CtaBand } from "@/components/cta-band";
import { ModuleIcon } from "@/components/icons";
import { Enter, HeadlineRise } from "@/components/motion/enter";
import { Reveal, Stagger, StaggerItem } from "@/components/motion/reveal";
import { ScrollTilt } from "@/components/scroll-tilt";
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
      <section className="relative overflow-hidden">
        <div className="dot-field absolute inset-0 -z-10" aria-hidden />
        <div aria-hidden className="absolute left-1/2 top-[30%] -z-10 size-[620px] -translate-x-1/2 rounded-full bg-brand/10 blur-3xl" />
        <div className="mx-auto max-w-6xl px-4 pt-28 md:px-6 md:pt-36">
          <Enter><Breadcrumbs trail={[{ name: "Home", href: "/" }, { name: "Solutions", href: "/solutions" }, { name: s.name }]} /></Enter>
          <div className="mt-8 grid items-end gap-8 lg:grid-cols-[1.35fr_1fr]">
            <div>
              <Enter delay={0.05} className="flex items-center gap-3">
                <span className="grid size-11 place-items-center rounded-2xl bg-brand text-on-brand shadow-[0_16px_40px_-14px_rgb(255_112_0/0.8)]">
                  <SolutionIcon icon={s.icon} size={22} />
                </span>
                <span className="text-sm font-medium uppercase tracking-[0.14em] text-brand-ink">{s.eyebrow}</span>
              </Enter>
              <h1 className="mt-6 text-[2.3rem] font-semibold leading-[1.04] tracking-[-0.035em] text-fg sm:text-5xl lg:text-[3.4rem]">
                <HeadlineRise text={s.headline} accent={s.accent} />
              </h1>
            </div>
            <div>
              <Enter delay={0.15}><p className="max-w-[52ch] text-lg leading-relaxed text-muted">{s.intro}</p></Enter>
              <Enter delay={0.25} className="mt-7 flex flex-wrap gap-3">
                <Button href="/contact" size="lg">{CTA.demo}</Button>
                <Button href="#how" size="lg" variant="ghost">How we solve it</Button>
              </Enter>
            </div>
          </div>
        </div>
        <ScrollTilt className="mx-auto mt-14 max-w-6xl px-4 md:px-6">
          <BrowserFrame shot={shots[s.hero]} priority sizes="(max-width: 1200px) 100vw, 1150px" />
        </ScrollTilt>
      </section>

      {/* 2. The problem */}
      <Section>
        <div className={`grid gap-12 ${s.image ? "lg:grid-cols-[1fr_1fr]" : ""}`}>
          <div>
            <SectionHead eyebrow="The problem" title={s.problem.title} body={s.problem.body} />
            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              {s.problem.points.map((p, i) => (
                <Reveal key={p.title} delay={i * 0.06} className="rounded-[20px] border border-line bg-surface p-6">
                  <span className="font-mono text-xs text-brand-ink">0{i + 1}</span>
                  <h3 className="mt-3 font-semibold text-fg">{p.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{p.body}</p>
                </Reveal>
              ))}
            </div>
          </div>
          {s.image && (
            <Reveal y={40} className="relative min-h-[420px] overflow-hidden rounded-[28px] bg-ink lg:min-h-0">
              <Image src={s.image.src} alt={s.image.alt} fill sizes="(max-width: 1024px) 100vw, 560px" className="object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
              <p className="absolute inset-x-0 bottom-0 p-6 text-lg font-medium leading-snug text-white md:p-8">{s.menu}.</p>
            </Reveal>
          )}
        </div>
      </Section>

      {/* 3. Why now */}
      <Section>
        <div className="ink-edge relative overflow-hidden rounded-[28px] bg-ink p-8 text-ink-fg md:p-14">
          <div className="dot-field-ink absolute inset-0 opacity-70" aria-hidden />
          <div aria-hidden className="absolute -right-24 -top-24 size-80 rounded-full bg-brand/20 blur-3xl" />
          <SectionHead invert eyebrow="Why it is happening now" title="The market changed faster than the controls." className="relative" />
          <Stagger className="relative mt-12 grid gap-10 md:grid-cols-3" gap={0.12}>
            {s.why.map((w, i) => (
              <StaggerItem key={w.title}>
                <div className="flex items-center gap-4">
                  <span className="size-2.5 rounded-full bg-brand shadow-[0_0_12px_rgb(255_112_0)]" />
                  <span className={`h-px flex-1 ${i === s.why.length - 1 ? "bg-transparent" : "bg-ink-fg/20"}`} />
                </div>
                <h3 className="mt-6 text-xl font-semibold">{w.title}</h3>
                <p className="mt-3 leading-relaxed opacity-70">{w.body}</p>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </Section>

      {/* 4. Cost of ignoring it */}
      <Section>
        <SectionHead eyebrow="What it costs" title="Ignoring it is the expensive option." accent={["expensive"]} />
        <div className="mt-12"><CardGrid items={s.cost} /></div>
      </Section>

      {/* 5. How Aavishield solves it */}
      <Section id="how">
        <SectionHead eyebrow="How Aavishield solves it" title="Three steps, shown in the real console." accent={["real"]} body="Every screen below is a real capture of the Aavishield console with demo data." />
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
          <LinkCards items={related.map((r) => ({ href: `/solutions/${r.slug}`, title: r.name, body: r.menu, icon: <SolutionIcon icon={r.icon} size={22} /> }))} />
        </div>
        {inds.length > 0 && (
          <div className="mt-6">
            <LinkCards items={inds.map((r) => ({ href: `/industries/${r.slug}`, title: r.name, body: r.menu, icon: <SolutionIcon icon={r.icon} size={22} /> }))} />
          </div>
        )}
      </Section>

      <CtaBand title="Show us your version of this problem." />
    </>
  );
}
