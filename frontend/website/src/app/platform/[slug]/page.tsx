import type { Metadata } from "next";
import { CheckCircle } from "@phosphor-icons/react/dist/ssr";
import { PixelPanel, UiCard } from "@/components/landing/visuals";
import { ScreenShowcase } from "@/components/screen-showcase";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/button";
import { CtaBand } from "@/components/cta-band";
import { EventPanel } from "@/components/event-panel";
import { Faq } from "@/components/faq";
import { ModuleIcon } from "@/components/icons";
import { Reveal, Stagger, StaggerItem, WordRise } from "@/components/motion/reveal";
import { Breadcrumbs, FeatureSplit, LinkCards } from "@/components/blocks";
import { ModuleVisual } from "@/components/landing/hero-widgets";
import { PageHero } from "@/components/page-hero";
import { Section, SectionHead } from "@/components/section";
import { SolutionIcon } from "@/components/solution-icon";
import { moduleShots } from "@/lib/module-shots";
import { shots } from "@/lib/shots";
import { solutionsList } from "@/lib/solutions";
import { CTA, getModule, moduleExtras, modules, type ModuleSlug } from "@/lib/content";
import { JsonLd, SITE_URL, breadcrumbLd, faqLd } from "@/lib/seo";

export function generateStaticParams() {
  return modules.map((m) => ({ slug: m.slug }));
}

export const dynamicParams = false;

export async function generateMetadata(props: PageProps<"/platform/[slug]">): Promise<Metadata> {
  const m = getModule((await props.params).slug);
  if (!m) return {};
  const x = moduleExtras[m.slug];
  const path = `/platform/${m.slug}`;
  return {
    title: x.seoTitle,
    description: x.description,
    keywords: x.keywords,
    alternates: { canonical: path },
    openGraph: { url: path, title: `${x.seoTitle} | Aavishield`, description: x.description, type: "article" },
    twitter: { title: `${x.seoTitle} | Aavishield`, description: x.description },
  };
}

export default async function ModulePage(props: PageProps<"/platform/[slug]">) {
  const m = getModule((await props.params).slug);
  if (!m) notFound();
  const x = moduleExtras[m.slug as ModuleSlug];
  const idx = modules.indexOf(m);
  const prev = modules[(idx - 1 + modules.length) % modules.length];
  const next = modules[(idx + 1) % modules.length];
  const related = [modules[(idx + 1) % modules.length], modules[(idx + 2) % modules.length]];
  const path = `/platform/${m.slug}`;
  const ms = moduleShots[m.slug as ModuleSlug];
  const sols = solutionsList.filter((x) => x.modules.includes(m.slug as ModuleSlug)).slice(0, 3);

  return (
    <>
      <JsonLd data={breadcrumbLd([{ name: "Home", path: "" }, { name: "Platform", path: "/platform" }, { name: m.name, path }])} />
      <JsonLd data={faqLd(x.faqs)} />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: x.seoTitle,
          description: x.description,
          url: `${SITE_URL}${path}`,
          primaryImageOfPage: `${SITE_URL}${shots[ms.hero].src}`,
          about: { "@type": "SoftwareApplication", name: `Aavishield ${m.name}`, applicationCategory: "SecurityApplication", operatingSystem: "macOS, Windows, Linux" },
          isPartOf: { "@id": `${SITE_URL}/#website` },
        }}
      />

      {/* Header */}
      <PageHero
        top={<Breadcrumbs trail={[{ name: "Home", href: "/" }, { name: "Platform", href: "/platform" }, { name: m.name }]} />}
        eyebrow={x.seoTitle}
        title={m.headline}
        accent={[m.headline.split(" ").at(-1)!]}
        body={m.intro}
        visual={<ModuleVisual slug={m.slug as ModuleSlug} />}
      >
        <Button href="/contact" size="lg">{CTA.demo}</Button>
        <Button href="#faq" size="lg" variant="ghost">Read FAQs</Button>
      </PageHero>

      {/* The real console, shown the landing page's way */}
      <section className="grid-band px-5 py-16 sm:px-8 md:px-12 md:py-24">
        <ScreenShowcase shot={shots[ms.hero]} priority widget={<EventPanel title={m.name} events={m.events} />} />
      </section>


      {/* Capabilities */}
      <section className="grid-band px-5 py-16 sm:px-8 md:px-12 md:py-24">
        <h2 className="mb-12 max-w-2xl text-4xl font-normal leading-[1.05] tracking-tight md:text-5xl">
          <WordRise text={`What ${m.name} does.`} accent={["does."]} />
        </h2>
        <Stagger className="grid gap-px overflow-hidden rounded-[6px] border border-line bg-line sm:grid-cols-2">
          {m.capabilities.map((c) => (
            <StaggerItem key={c.title} className="group bg-bg p-8 transition-colors duration-300 hover:bg-surface md:p-10">
              <span className="mb-6 block h-0.5 w-8 bg-brand transition-[width] duration-500 ease-out-expo group-hover:w-16" />
              <h3 className="text-xl font-normal tracking-tight text-fg">{c.title}</h3>
              <p className="mt-3 max-w-[44ch] leading-relaxed text-muted">{c.body}</p>
            </StaggerItem>
          ))}
        </Stagger>
      </section>

      {/* Gallery: the console, screen by screen */}
      <Section>
        <SectionHead eyebrow="In the console" title={`${m.name}, screen by screen.`} accent={["screen"]} body="Real captures of the Aavishield console with demo data." />
        <div className="mt-16 grid gap-24">
          {ms.gallery.map((g, i) => (
            <FeatureSplit key={g.title} eyebrow={`0${i + 1}`} title={g.title} body={g.body} points={g.points} shot={shots[g.shot]} crop={g.crop} reverse={i % 2 === 1} />
          ))}
        </div>
      </Section>

      {/* At a glance: example events, coverage and the decision path, as landing-page widgets */}
      <Section>
        <SectionHead eyebrow="At a glance" title={`${m.name}, in three cards.`} accent={["three"]} />
        <div className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-[4px] border border-line bg-line lg:grid-cols-3">
          <div className="flex flex-col bg-bg">
            <PixelPanel className="grid min-h-[300px] place-items-center rounded-none border-0 border-b border-line p-6">
              <EventPanel title={m.name} events={m.events} className="w-full max-w-[340px]" />
            </PixelPanel>
            <p className="px-6 py-5 text-sm leading-relaxed text-muted">What a day of {m.name.toLowerCase()} decisions looks like in the console.</p>
          </div>
          <div className="flex flex-col bg-bg">
            <PixelPanel className="grid min-h-[300px] place-items-center rounded-none border-0 border-b border-line p-6">
              <UiCard title="What it covers" className="w-full max-w-[340px]">
                <ul className="grid gap-2.5">
                  {m.capabilities.map((c) => (
                    <li key={c.title} className="flex items-center gap-2.5 text-[13px] text-fg">
                      <CheckCircle size={15} weight="fill" className="shrink-0 text-brand" />
                      {c.title}
                    </li>
                  ))}
                </ul>
              </UiCard>
            </PixelPanel>
            <p className="px-6 py-5 text-sm leading-relaxed text-muted">{m.short}</p>
          </div>
          <div className="flex flex-col bg-bg">
            <PixelPanel className="grid min-h-[300px] place-items-center rounded-none border-0 border-b border-line p-6">
              <UiCard title="How it decides" className="w-full max-w-[340px]">
                <ol className="relative grid gap-4">
                  <span aria-hidden className="absolute bottom-3 left-[11px] top-3 w-px bg-line" />
                  {m.flow.map((f, i) => (
                    <li key={f.verb} className="relative flex gap-3">
                      <span className="grid size-6 shrink-0 place-items-center rounded-[4px] bg-brand font-mono text-[11px] text-on-brand">{i + 1}</span>
                      <span className="min-w-0">
                        <span className="block text-[13px] text-fg">{f.verb}</span>
                        <span className="mt-0.5 block text-[11.5px] leading-snug text-muted">{f.body}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </UiCard>
            </PixelPanel>
            <p className="px-6 py-5 text-sm leading-relaxed text-muted">Every decision happens on the device, against signed policy.</p>
          </div>
        </div>
      </Section>


      {/* Flow */}
      <section className="grid-band px-5 py-16 sm:px-8 md:px-12 md:py-24">
        <div className="ink-edge relative overflow-hidden rounded-[6px] bg-ink p-8 text-ink-fg md:p-14">
          <div className="dot-field-ink absolute inset-0 opacity-70" aria-hidden />
          <h2 className="relative text-3xl font-normal tracking-tight md:text-4xl">Under the hood</h2>
          <Stagger className="relative mt-12 grid gap-10 md:grid-cols-3" gap={0.15}>
            {m.flow.map((f, i) => (
              <StaggerItem key={f.verb}>
                <div className="flex items-center gap-4">
                  <span className="size-2.5 rounded-full bg-brand" />
                  <span className={`h-px flex-1 ${i === m.flow.length - 1 ? "bg-transparent" : "bg-ink-fg/20"}`} />
                </div>
                <h3 className="mt-6 text-2xl font-normal">{f.verb}</h3>
                <p className="mt-3 leading-relaxed opacity-70">{f.body}</p>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* Setup */}
      <Section>
        <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr]">
          <SectionHead eyebrow="Setup" title="Switched on in minutes." accent={["minutes."]} body="No appliance, no network change, no separate agent." />
          <ol className="grid gap-3">
            {ms.setup.map((st, i) => (
              <li key={st}>
                <Reveal delay={i * 0.06} className="flex items-center gap-5 rounded-[6px] border border-line bg-surface p-5">
                  <span className="grid size-10 shrink-0 place-items-center rounded-[4px] bg-brand font-mono text-sm font-medium text-on-brand">{i + 1}</span>
                  <span className="text-fg-2">{st}</span>
                </Reveal>
              </li>
            ))}
          </ol>
        </div>
      </Section>

      {/* Use cases */}
      <section className="grid-band px-5 py-16 sm:px-8 md:px-12 md:py-24">
        <h2 className="max-w-2xl text-4xl font-normal leading-[1.05] tracking-tight md:text-5xl">
          <WordRise text="Where teams use it." accent={["use"]} />
        </h2>
        <div className="mt-14 grid gap-12 md:grid-cols-3 md:gap-8">
          {x.useCases.map((u, i) => (
            <Reveal key={u.title} delay={i * 0.1} className={i === 1 ? "md:mt-12" : i === 2 ? "md:mt-24" : ""}>
              <div className="border-t-2 border-brand pt-6">
                <h3 className="text-xl font-normal tracking-tight text-fg">{u.title}</h3>
                <p className="mt-3 leading-relaxed text-muted">{u.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Problems this solves */}
      {sols.length > 0 && (
        <Section>
          <SectionHead eyebrow="Problems it solves" title={`Where ${m.name} makes the difference.`} />
          <div className="mt-12">
            <LinkCards items={sols.map((x2) => ({ href: `/solutions/${x2.slug}`, title: x2.name, body: x2.menu, icon: <SolutionIcon icon={x2.icon} size={22} /> }))} />
          </div>
        </Section>
      )}

      {/* FAQ */}
      <section id="faq" className="grid-band grid scroll-mt-24 gap-10 px-5 py-16 sm:px-8 md:grid-cols-[0.8fr_1.2fr] md:px-12 md:py-24">
        <h2 className="text-4xl font-normal leading-[1.05] tracking-tight md:text-5xl">
          {m.name} questions
        </h2>
        <Reveal delay={0.1}>
          <Faq items={x.faqs} />
        </Reveal>
      </section>

      {/* Related */}
      <section className="grid-band px-5 py-16 sm:px-8 md:px-12 md:py-24">
        <h2 className="text-2xl font-normal tracking-tight text-fg">Works well with</h2>
        <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 [&>*]:min-w-0">
          {related.map((r) => (
            <Link key={r.slug} href={`/platform/${r.slug}`} className="group flex items-center gap-5 rounded-[6px] border border-line p-6 transition-colors duration-300 hover:border-brand/50 hover:bg-surface">
              <span className="grid size-12 shrink-0 place-items-center rounded-[4px] border border-line text-fg transition-colors duration-300 group-hover:border-brand group-hover:bg-brand group-hover:text-on-brand">
                <ModuleIcon icon={r.icon} size={22} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-fg">{r.name}</span>
                <span className="mt-1 block truncate text-sm text-muted">{r.short}</span>
              </span>
              <ArrowUpRight size={18} className="shrink-0 text-muted transition-transform duration-300 ease-out-expo group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </Link>
          ))}
        </div>

        <nav aria-label="Other features" className="mt-10 flex items-center justify-between gap-4 border-t border-line pt-8 text-sm">
          <Link href={`/platform/${prev.slug}`} className="group flex min-w-0 items-center gap-2 text-muted hover:text-fg">
            <ArrowLeft size={14} weight="bold" className="shrink-0 transition-transform group-hover:-translate-x-1" />
            <span className="truncate">{prev.name}</span>
          </Link>
          <Link href={`/platform/${next.slug}`} className="group flex min-w-0 items-center gap-2 text-right text-muted hover:text-fg">
            <span className="truncate">{next.name}</span>
            <ArrowRight size={14} weight="bold" className="shrink-0 transition-transform group-hover:translate-x-1" />
          </Link>
        </nav>
      </section>

      <CtaBand />
    </>
  );
}
