import { panelForShot } from "@/components/panels";
import { PanelThumb } from "@/components/panels/thumb";
import { ModesWidget } from "@/components/landing/section-widgets";
import type { Metadata } from "next";
import { ScreenShowcase } from "@/components/screen-showcase";
import { LiveFeed } from "@/components/landing/live-feed";
import { FeedHero } from "@/components/landing/hero-widgets";
import Link from "next/link";
import { ArrowUpRight, Check } from "@phosphor-icons/react/dist/ssr";
import { CardGrid, FaqSection } from "@/components/blocks";
import { Button } from "@/components/button";
import { CtaBand } from "@/components/cta-band";
import { ModuleIcon } from "@/components/icons";
import { Reveal, Stagger, StaggerItem } from "@/components/motion/reveal";
import { Spotlight } from "@/components/motion/spotlight";
import { PageHero } from "@/components/page-hero";
import { Section, SectionHead } from "@/components/section";
import { SolutionIcon } from "@/components/solution-icon";
import { CTA, modules } from "@/lib/content";
import { JsonLd, SITE_URL, breadcrumbLd } from "@/lib/seo";
import { shots } from "@/lib/shots";
import { industries, solutionsList } from "@/lib/solutions";

export const metadata: Metadata = {
  title: "Endpoint Security Solutions by Problem",
  description:
    "AI data leakage, remote work, insider risk, audits, shadow IT, VPN bypass and phishing: see how one Aavishield endpoint agent solves each problem.",
  alternates: { canonical: "/solutions" },
  openGraph: { url: "/solutions" },
};

const teams = [
  { title: "IT teams", body: "Roll out one agent instead of four products, and stop maintaining office-only firewalls." },
  { title: "Security leads", body: "See every blocked site, flagged upload and stopped download in one place." },
  { title: "Founders and HR", body: "Protect customer data and company IP without slowing anyone down." },
];

const approach = [
  { title: "Start with visibility", body: "DLP watches first and never blocks, so you learn what is really happening before you change anything." },
  { title: "Enforce on the device", body: "Policy travels with the laptop, so it holds on every network, not just in the office." },
  { title: "One agent, one console", body: "Every solution on this page uses the same agent and the same console. No new product per problem." },
];

const faq = [
  { q: "Do I need a different product for each problem?", a: "No. Every solution uses controls from the same Aavishield agent and console. You turn on what you need." },
  { q: "Which problem should we start with?", a: "Most companies start with AI data leakage or remote work, because they need visibility quickly. In a demo we map your priorities to the right controls." },
  { q: "Can solutions be rolled out gradually?", a: "Yes. Start with monitor-only DLP and web filtering, then add application control, monitoring or stricter policy over time." },
  { q: "Does it work for small companies?", a: "Yes. The console is designed for one IT person or a founder to run." },
];

export default function SolutionsPage() {
  return (
    <>
      <JsonLd data={breadcrumbLd([{ name: "Home", path: "" }, { name: "Solutions", path: "/solutions" }])} />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "ItemList",
          itemListElement: solutionsList.map((s, i) => ({ "@type": "ListItem", position: i + 1, name: s.name, url: `${SITE_URL}/solutions/${s.slug}` })),
        }}
      />

      {/* 1. Hero */}
      <PageHero visual={<FeedHero />} eyebrow="Endpoint security solutions" accent={["today."]} title="Start from the problem you have today." body="Nine problems companies face right now, and exactly how Aavishield solves each one.">
        <Button href="#problems" size="lg">See the problems</Button>
        <Button href="/contact" size="lg" variant="ghost">{CTA.demo}</Button>
      </PageHero>

      {/* 2. Problems */}
      <section id="problems" className="grid-band scroll-mt-24 px-5 py-16 sm:px-8 md:px-12 md:py-24">
        <Stagger className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {solutionsList.map((s, i) => (
            <StaggerItem key={s.slug} className="h-full">
              <Spotlight className="h-full">
                <Link href={`/solutions/${s.slug}`} className="flex h-full flex-col">
                  <div className="relative m-2 aspect-[16/10] overflow-hidden rounded-[6px] bg-bg-2">
                    <PanelThumb panel={panelForShot(shots[s.hero])} className="absolute inset-0" />
                  </div>
                  <div className="flex flex-1 flex-col p-6 pt-4">
                    <div className="flex items-center justify-between">
                      <span className="grid size-10 place-items-center rounded-[4px] border border-line text-fg transition-colors duration-300 group-hover:border-brand group-hover:bg-brand group-hover:text-on-brand">
                        <SolutionIcon icon={s.icon} size={20} />
                      </span>
                      <span className="font-mono text-xs text-muted">0{i + 1}</span>
                    </div>
                    <h2 className="mt-5 text-xl font-normal tracking-tight text-fg">{s.name}</h2>
                    <p className="mt-2 flex-1 leading-relaxed text-muted">{s.menu}.</p>
                    <span className="mt-5 flex items-center gap-1.5 text-sm font-medium text-brand-ink">
                      How we solve it <ArrowUpRight size={14} className="transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                    </span>
                  </div>
                </Link>
              </Spotlight>
            </StaggerItem>
          ))}
        </Stagger>
      </section>

      {/* 3. One console */}
      <Section>
        <SectionHead center eyebrow="One console" title="Nine problems. One place to see them." accent={["One", "place"]} body="Every solution reports into the same security overview, so you see the whole picture, not nine dashboards." />
        <div className="mt-14"><ScreenShowcase shot={shots.overview} widget={<LiveFeed />} /></div>
      </Section>

      {/* 4. Matrix */}
      <Section>
        <SectionHead eyebrow="Problem to control" title="Which controls solve which problem." body="Each solution combines a few of the seven Aavishield controls. All of them run in the same agent." />
        <Reveal className="mt-12 overflow-x-auto rounded-[6px] border border-line bg-surface">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead>
              <tr className="border-b border-line bg-bg-2">
                <th className="px-5 py-4 font-medium text-fg">Problem</th>
                {modules.map((m) => (
                  <th key={m.slug} className="px-3 py-4 text-center font-medium text-muted">
                    <span className="flex flex-col items-center gap-1.5">
                      <ModuleIcon icon={m.icon} size={18} className="text-fg" />
                      <span className="text-[11.5px] leading-tight">{m.name}</span>
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {solutionsList.map((s) => (
                <tr key={s.slug} className="border-b border-line last:border-0 hover:bg-bg-2/60">
                  <td className="px-5 py-3.5">
                    <Link href={`/solutions/${s.slug}`} className="font-medium text-fg hover:text-brand-ink">{s.name}</Link>
                  </td>
                  {modules.map((m) => (
                    <td key={m.slug} className="px-3 py-3.5 text-center">
                      {s.modules.includes(m.slug) ? (
                        <span className="inline-grid size-6 place-items-center rounded-[4px] bg-brand text-on-brand"><Check size={12} weight="bold" /></span>
                      ) : (
                        <span className="inline-block size-1.5 rounded-full bg-line-strong" />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Reveal>
      </Section>

      {/* 5. Industries */}
      <Section>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <SectionHead eyebrow="By industry" title="Built for the data your industry handles." />
          <Reveal><Button href="/industries" variant="ghost">All industries</Button></Reveal>
        </div>
        <Stagger className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {industries.map((ind) => (
            <StaggerItem key={ind.slug}>
              <Link href={`/industries/${ind.slug}`} className="group block h-full rounded-[6px] border border-line bg-surface p-6 transition-colors duration-300 hover:border-brand/40">
                <span className="flex items-start justify-between">
                  <span className="grid size-11 place-items-center rounded-[4px] border border-line text-fg transition-colors duration-300 group-hover:border-brand group-hover:bg-brand group-hover:text-on-brand">
                    <SolutionIcon icon={ind.icon} size={22} />
                  </span>
                  <ArrowUpRight size={18} className="text-muted transition-[transform,color] duration-300 ease-out-expo group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-brand-ink" />
                </span>
                <h3 className="mt-6 font-normal text-fg">{ind.name}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{ind.menu}</p>
              </Link>
            </StaggerItem>
          ))}
        </Stagger>
      </Section>

      {/* 6. Approach */}
      <Section>
        <div className="grid items-center gap-12 lg:grid-cols-[1fr_1fr]">
          <Reveal y={40}>
            <ModesWidget />
          </Reveal>
          <div>
            <SectionHead eyebrow="Our approach" title="Visibility first. Enforcement where it is clearly right." accent={["Visibility"]} />
            <div className="mt-10 grid gap-8">
              {approach.map((a, i) => (
                <Reveal key={a.title} delay={i * 0.08} className="border-l-2 border-brand pl-6">
                  <h3 className="text-xl font-normal tracking-tight text-fg">{a.title}</h3>
                  <p className="mt-2 leading-relaxed text-muted">{a.body}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </Section>

      {/* 7. Teams */}
      <Section>
        <SectionHead eyebrow="Who it is for" title="Built for the people who carry the risk." accent={["risk."]} />
        <div className="mt-12"><CardGrid items={teams} /></div>
      </Section>

      {/* 8. FAQ */}
      <FaqSection title="Choosing a solution" items={faq} />

      <CtaBand title="Tell us your problem. We will show you the policy." />
    </>
  );
}
