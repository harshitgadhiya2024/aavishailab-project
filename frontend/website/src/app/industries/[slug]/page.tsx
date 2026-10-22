import type { Metadata } from "next";
import { ModuleVisual } from "@/components/landing/hero-widgets";
import { PageHero } from "@/components/page-hero";
import Image from "next/image";
import { notFound } from "next/navigation";
import { Breadcrumbs, CardGrid, FaqSection, FeatureSplit, LinkCards } from "@/components/blocks";
import { Button } from "@/components/button";
import { CtaBand } from "@/components/cta-band";
import { ModuleIcon } from "@/components/icons";
import { Reveal } from "@/components/motion/reveal";
import { Section, SectionHead } from "@/components/section";
import { SolutionIcon } from "@/components/solution-icon";
import { CTA, getModule } from "@/lib/content";
import { JsonLd, breadcrumbLd, faqLd } from "@/lib/seo";
import { shots } from "@/lib/shots";
import { getIndustry, getSolution, industries } from "@/lib/solutions";

export function generateStaticParams() {
  return industries.map((i) => ({ slug: i.slug }));
}

export const dynamicParams = false;

export async function generateMetadata(props: PageProps<"/industries/[slug]">): Promise<Metadata> {
  const ind = getIndustry((await props.params).slug);
  if (!ind) return {};
  const path = `/industries/${ind.slug}`;
  return {
    title: ind.seoTitle,
    description: ind.description,
    alternates: { canonical: path },
    openGraph: { url: path, title: `${ind.seoTitle} | Aavishield`, description: ind.description },
  };
}

const rollout = [
  { title: "Week 1: pilot", body: "Enroll a handful of devices, switch on monitor-only DLP and the web categories you care about." },
  { title: "Week 2: review", body: "Look at real findings with your team and decide what to block, allow or watch." },
  { title: "Week 3: roll out", body: "Send the enrollment link to everyone. Policy applies the moment each device enrolls." },
  { title: "Ongoing: report", body: "Use the executive summary and compliance reports for leadership, clients and auditors." },
];

export default async function IndustryPage(props: PageProps<"/industries/[slug]">) {
  const ind = getIndustry((await props.params).slug);
  if (!ind) notFound();
  const path = `/industries/${ind.slug}`;
  const others = industries.filter((i) => i.slug !== ind.slug);

  return (
    <>
      <JsonLd data={breadcrumbLd([{ name: "Home", path: "" }, { name: "Industries", path: "/industries" }, { name: ind.name, path }])} />
      <JsonLd data={faqLd(ind.faqs)} />

      {/* 1. Hero */}
      <PageHero
        top={<Breadcrumbs trail={[{ name: "Home", href: "/" }, { name: "Industries", href: "/industries" }, { name: ind.name }]} />}
        eyebrow={ind.seoTitle}
        title={ind.headline}
        accent={ind.accent}
        body={ind.intro}
        visual={<ModuleVisual slug={ind.modules[0]} />}
      >
        <Button href="/contact" size="lg">{CTA.demo}</Button>
        <Button href="#use-cases" size="lg" variant="ghost">Use cases</Button>
      </PageHero>

      {/* 2. Challenges */}

      <Section>
        <SectionHead eyebrow="Challenges" title={`What makes security hard in ${ind.name.toLowerCase()}.`} />
        <div className="mt-12"><CardGrid items={ind.challenges} cols={4} /></div>
      </Section>

      {/* 3. Sensitive data */}
      <Section>
        <div className={`grid items-center gap-12 ${ind.image ? "lg:grid-cols-2" : ""}`}>
          <div>
            <SectionHead eyebrow="The data at stake" title="Aavishield knows what this data looks like." accent={["looks"]} body="Pattern detectors and AI classification recognise it in files, images and messages, and record when it leaves a device." />
            <Reveal delay={0.2} className="mt-8 flex flex-wrap gap-2.5">
              {ind.data.map((d) => (
                <span key={d} className="rounded-[4px] border border-line bg-surface px-3 py-1.5 text-sm font-medium text-fg">{d}</span>
              ))}
            </Reveal>
          </div>
          {ind.image && (
            <Reveal y={40} className="relative aspect-[4/3] overflow-hidden rounded-[6px] bg-ink">
              <Image src={ind.image.src} alt={ind.image.alt} fill sizes="(max-width: 1024px) 100vw, 560px" className="object-cover" />
            </Reveal>
          )}
        </div>
      </Section>

      {/* 4. Use cases */}
      <Section id="use-cases">
        <SectionHead eyebrow="Use cases" title="How teams like yours use Aavishield." accent={["yours"]} />
        <div className="mt-16 grid gap-24">
          {ind.useCases.map((u, i) => (
            <FeatureSplit key={u.title} eyebrow={`Use case ${i + 1}`} title={u.title} body={u.body} shot={shots[u.shot]} reverse={i % 2 === 1} />
          ))}
        </div>
      </Section>

      {/* 5. Controls */}
      <Section>
        <SectionHead eyebrow="Controls" title="The controls that matter most here." />
        <div className="mt-12">
          <LinkCards items={ind.modules.map((slug) => { const m = getModule(slug)!; return { href: `/platform/${m.slug}`, title: m.name, body: m.short, icon: <ModuleIcon icon={m.icon} size={22} /> }; })} />
        </div>
      </Section>

      {/* 6. Rollout */}
      <Section>
        <div className="ink-edge relative overflow-hidden rounded-[6px] bg-ink p-8 text-ink-fg md:p-14">
          <div className="dot-field-ink absolute inset-0 opacity-70" aria-hidden />
          <SectionHead invert eyebrow="Rollout" title="From pilot to every device in three weeks." className="relative" />
          <div className="relative mt-12 grid gap-8 md:grid-cols-4">
            {rollout.map((r, i) => (
              <Reveal key={r.title} delay={i * 0.08}>
                <span className="font-mono text-sm text-brand">0{i + 1}</span>
                <h3 className="mt-3 text-lg font-normal">{r.title}</h3>
                <p className="mt-2 text-sm leading-relaxed opacity-70">{r.body}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </Section>

      {/* 7. Related problems */}
      <Section>
        <SectionHead eyebrow="Related problems" title="Problems we solve in this industry." />
        <div className="mt-12">
          <LinkCards items={ind.solutions.map((sl) => { const s = getSolution(sl)!; return { href: `/solutions/${s.slug}`, title: s.name, body: s.menu, icon: <SolutionIcon icon={s.icon} size={22} /> }; })} />
        </div>
      </Section>

      {/* 8. FAQ */}
      <FaqSection title={`${ind.name}: questions`} items={ind.faqs} />

      {/* 9. Other industries */}
      <Section>
        <h2 className="text-2xl font-normal tracking-tight text-fg">Other industries</h2>
        <div className="mt-8">
          <LinkCards items={others.map((o) => ({ href: `/industries/${o.slug}`, title: o.name, body: o.menu, icon: <SolutionIcon icon={o.icon} size={22} /> }))} />
        </div>
      </Section>

      <CtaBand title={`See Aavishield for ${ind.name.toLowerCase()}.`} />
    </>
  );
}
