import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, ArrowUpRight, CaretRight } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/button";
import { CtaBand } from "@/components/cta-band";
import { EventPanel } from "@/components/event-panel";
import { Faq } from "@/components/faq";
import { ModuleIcon } from "@/components/icons";
import { Enter, HeadlineRise } from "@/components/motion/enter";
import { Float } from "@/components/motion/float";
import { Reveal, Stagger, StaggerItem, WordRise } from "@/components/motion/reveal";
import Image from "next/image";
import { FeatureSplit, LinkCards } from "@/components/blocks";
import { BrowserFrame } from "@/components/browser-frame";
import { ScrollTilt } from "@/components/scroll-tilt";
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
      <section className="relative overflow-hidden">
        <div className="dot-field absolute inset-0 -z-10" aria-hidden />
        <div className="mx-auto max-w-6xl px-4 pb-12 pt-28 md:px-6 md:pt-36">
          <Enter>
            <nav aria-label="Breadcrumb">
              <ol className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
                <li><Link href="/" className="hover:text-fg">Home</Link></li>
                <li aria-hidden><CaretRight size={11} /></li>
                <li><Link href="/platform" className="hover:text-fg">Platform</Link></li>
                <li aria-hidden><CaretRight size={11} /></li>
                <li aria-current="page" className="text-fg">{m.name}</li>
              </ol>
            </nav>
          </Enter>
          <div className="mt-8 grid items-end gap-8 lg:grid-cols-[1.4fr_1fr]">
            <div>
              <Enter delay={0.05} className="flex items-center gap-3">
                <span className="grid size-11 place-items-center rounded-2xl bg-brand text-on-brand shadow-[0_16px_40px_-14px_rgb(255_112_0/0.8)]">
                  <ModuleIcon icon={m.icon} size={22} />
                </span>
                <span className="text-base font-medium text-fg">{m.name}</span>
              </Enter>
              <h1 className="mt-6 text-[2.4rem] font-semibold leading-[1.03] tracking-[-0.035em] text-fg sm:text-5xl lg:text-6xl">
                <HeadlineRise text={m.headline} accent={[m.headline.split(" ").at(-1)!]} />
              </h1>
            </div>
            <div>
              <Enter delay={0.15}>
                <p className="max-w-[52ch] text-lg leading-relaxed text-muted">{m.intro}</p>
              </Enter>
              <Enter delay={0.25} className="mt-7 flex flex-wrap gap-3">
                <Button href="/contact" size="lg">{CTA.demo}</Button>
                <Button href="#faq" size="lg" variant="ghost">Read FAQs</Button>
              </Enter>
            </div>
          </div>
        </div>
      </section>

      {/* Real console screen with floating live panel */}
      <section className="mx-auto max-w-6xl px-4 md:px-6">
        <div className="relative">
          <ScrollTilt>
            <BrowserFrame shot={shots[ms.hero]} priority sizes="(max-width: 1200px) 100vw, 1150px" />
          </ScrollTilt>
          <div className="relative z-[1] mx-auto -mt-16 w-[calc(100%-1.5rem)] max-w-md sm:absolute sm:-bottom-10 sm:-right-4 sm:mt-0 sm:w-[360px] lg:-right-10">
            <Reveal delay={0.4} y={30}>
              <Float amplitude={8} duration={7}>
                <EventPanel title={m.name} events={m.events} />
              </Float>
            </Reveal>
          </div>
        </div>
      </section>

      {/* Capabilities */}
      <section className="mx-auto mt-28 max-w-6xl px-4 md:mt-36 md:px-6">
        <h2 className="mb-12 max-w-2xl text-4xl font-semibold leading-[1.05] tracking-tight md:text-5xl">
          <WordRise text={`What ${m.name} does.`} accent={["does."]} />
        </h2>
        <Stagger className="grid gap-px overflow-hidden rounded-[20px] border border-line bg-line sm:grid-cols-2">
          {m.capabilities.map((c) => (
            <StaggerItem key={c.title} className="group bg-bg p-8 transition-colors duration-300 hover:bg-surface md:p-10">
              <span className="mb-6 block h-0.5 w-8 bg-brand transition-[width] duration-500 ease-out-expo group-hover:w-16" />
              <h3 className="text-xl font-semibold tracking-tight text-fg">{c.title}</h3>
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

      {/* Detail crops + mood image */}
      <Section>
        <div className="grid gap-4 md:grid-cols-3">
          {ms.detail.map((d) => (
            <Reveal key={d.caption} className="min-w-0">
              <BrowserFrame shot={shots[d.shot]} crop={d.crop} aspect="aspect-[4/3]" chrome={false} sizes="(max-width: 768px) 100vw, 380px" />
              <p className="mt-3 text-sm text-muted">{d.caption}</p>
            </Reveal>
          ))}
          <Reveal delay={0.1} className="min-w-0">
            <div className="relative aspect-[4/3] overflow-hidden rounded-[18px] bg-ink">
              <Image src={x.image} alt={x.alt} fill sizes="(max-width: 768px) 100vw, 380px" className="object-cover" />
            </div>
            <p className="mt-3 text-sm text-muted">{m.short}</p>
          </Reveal>
        </div>
      </Section>

      {/* Flow */}
      <section className="mx-auto mt-28 max-w-6xl px-4 md:mt-36 md:px-6">
        <div className="ink-edge relative overflow-hidden rounded-[28px] bg-ink p-8 text-ink-fg md:p-14">
          <div className="dot-field-ink absolute inset-0 opacity-70" aria-hidden />
          <div aria-hidden className="absolute -right-24 -top-24 size-80 rounded-full bg-brand/20 blur-3xl" />
          <h2 className="relative text-3xl font-semibold tracking-tight md:text-4xl">Under the hood</h2>
          <Stagger className="relative mt-12 grid gap-10 md:grid-cols-3" gap={0.15}>
            {m.flow.map((f, i) => (
              <StaggerItem key={f.verb}>
                <div className="flex items-center gap-4">
                  <span className="size-2.5 rounded-full bg-brand shadow-[0_0_12px_rgb(255_112_0)]" />
                  <span className={`h-px flex-1 ${i === m.flow.length - 1 ? "bg-transparent" : "bg-ink-fg/20"}`} />
                </div>
                <h3 className="mt-6 text-2xl font-semibold">{f.verb}</h3>
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
              <Reveal key={st} delay={i * 0.06}>
                <li className="flex items-center gap-5 rounded-[18px] border border-line bg-surface p-5">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand font-mono text-sm font-semibold text-on-brand">{i + 1}</span>
                  <span className="text-fg-2">{st}</span>
                </li>
              </Reveal>
            ))}
          </ol>
        </div>
      </Section>

      {/* Use cases */}
      <section className="mx-auto mt-28 max-w-6xl px-4 md:mt-36 md:px-6">
        <h2 className="max-w-2xl text-4xl font-semibold leading-[1.05] tracking-tight md:text-5xl">
          <WordRise text="Where teams use it." accent={["use"]} />
        </h2>
        <div className="mt-14 grid gap-12 md:grid-cols-3 md:gap-8">
          {x.useCases.map((u, i) => (
            <Reveal key={u.title} delay={i * 0.1} className={i === 1 ? "md:mt-12" : i === 2 ? "md:mt-24" : ""}>
              <div className="border-t-2 border-brand pt-6">
                <h3 className="text-xl font-semibold tracking-tight text-fg">{u.title}</h3>
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
      <section id="faq" className="mx-auto mt-28 grid max-w-6xl scroll-mt-28 gap-10 px-4 md:mt-36 md:grid-cols-[0.8fr_1.2fr] md:px-6">
        <h2 className="text-4xl font-semibold leading-[1.05] tracking-tight md:text-5xl">
          {m.name} questions
        </h2>
        <Reveal delay={0.1}>
          <Faq items={x.faqs} />
        </Reveal>
      </section>

      {/* Related */}
      <section className="mx-auto mt-28 max-w-6xl px-4 md:mt-36 md:px-6">
        <h2 className="text-2xl font-semibold tracking-tight text-fg">Works well with</h2>
        <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 [&>*]:min-w-0">
          {related.map((r) => (
            <Link key={r.slug} href={`/platform/${r.slug}`} className="group flex items-center gap-5 rounded-[20px] border border-line p-6 transition-colors duration-300 hover:border-brand/50 hover:bg-surface">
              <span className="grid size-12 shrink-0 place-items-center rounded-2xl border border-line text-fg transition-colors duration-300 group-hover:border-brand group-hover:bg-brand group-hover:text-on-brand">
                <ModuleIcon icon={r.icon} size={22} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-fg">{r.name}</span>
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
