import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, EnvelopeSimple } from "@phosphor-icons/react/dist/ssr";
import { Breadcrumbs } from "./blocks";
import { Enter, HeadlineRise } from "./motion/enter";
import { Reveal, Stagger, StaggerItem } from "./motion/reveal";
import { LEGAL_EMAIL, LEGAL_UPDATED, getLegal, legalPages } from "@/lib/legal";
import { JsonLd, breadcrumbLd } from "@/lib/seo";

export function legalMetadata(slug: string): Metadata {
  const p = getLegal(slug)!;
  return { title: p.title, description: p.description, alternates: { canonical: `/${slug}` }, openGraph: { url: `/${slug}` } };
}

export function LegalDoc({ slug }: { slug: string }) {
  const p = getLegal(slug)!;
  return (
    <>
      <JsonLd data={breadcrumbLd([{ name: "Home", path: "" }, { name: p.title, path: `/${slug}` }])} />
      <section className="grid-band relative overflow-hidden">
        <div className="px-5 pb-14 pt-14 sm:px-8 md:px-12 md:pt-20">
          <Enter><Breadcrumbs trail={[{ name: "Home", href: "/" }, { name: "Legal" }, { name: p.title }]} /></Enter>
          <h1 className="mt-8 max-w-3xl text-[2.5rem] font-normal leading-[1.03] tracking-[-0.035em] text-fg md:text-6xl">
            <HeadlineRise text={p.title} accent={[p.title.split(" ").at(-1)!]} />
          </h1>
          <Enter delay={0.15}><p className="mt-6 max-w-[60ch] text-lg leading-relaxed text-muted">{p.intro}</p></Enter>
          <Enter delay={0.2}><p className="mt-4 text-sm text-muted">Last updated {LEGAL_UPDATED}</p></Enter>
        </div>
      </section>

      <section className="grid-band px-5 py-16 sm:px-8 md:px-12 md:py-24" aria-label="In short">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-brand-ink">In short</h2>
        <Stagger className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {p.summary.map((s) => (
            <StaggerItem key={s.title} className="rounded-[6px] border border-line bg-surface p-6">
              <span className="mb-4 block h-0.5 w-8 bg-brand" />
              <h3 className="font-normal text-fg">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
            </StaggerItem>
          ))}
        </Stagger>
      </section>

      <section className="grid-band grid gap-12 px-5 py-16 sm:px-8 md:px-12 md:py-20 lg:grid-cols-[240px_1fr]">
        <nav aria-label="On this page" className="lg:sticky lg:top-28 lg:self-start">
          <p className="text-sm font-medium text-fg">On this page</p>
          <ol className="mt-4 grid gap-2 border-l border-line">
            {p.sections.map((s, i) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="-ml-px block border-l border-transparent pl-4 text-sm text-muted transition-colors hover:border-brand hover:text-fg">
                  {i + 1}. {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <div className="min-w-0 max-w-3xl">
          {p.sections.map((s, i) => (
            <section key={s.id} id={s.id} className="scroll-mt-28 border-t border-line py-10 first:border-t-0 first:pt-0">
              <h2 className="text-2xl font-normal tracking-tight text-fg">
                <span className="mr-3 font-mono text-base text-brand-ink">{String(i + 1).padStart(2, "0")}</span>
                {s.title}
              </h2>
              {s.body.map((b) => (
                <p key={b.slice(0, 40)} className="mt-4 leading-relaxed text-fg-2">{b}</p>
              ))}
              {s.list && (
                <ul className="mt-4 grid gap-2.5">
                  {s.list.map((l) => (
                    <li key={l} className="flex gap-3 leading-relaxed text-fg-2">
                      <span className="mt-2.5 size-1.5 shrink-0 bg-brand" />
                      {l}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      </section>

      <section className="grid-band px-5 py-16 sm:px-8 md:px-12">
        <Reveal className="ink-edge relative flex flex-col gap-6 overflow-hidden rounded-[6px] bg-ink p-8 text-ink-fg md:flex-row md:items-center md:justify-between md:p-12">
          <div className="relative">
            <h2 className="text-2xl font-normal tracking-tight md:text-3xl">Questions about this policy?</h2>
            <p className="mt-2 max-w-[48ch] opacity-70">Write to us and a real person will answer, usually within two working days.</p>
          </div>
          <a href={`mailto:${LEGAL_EMAIL}`} className="relative inline-flex h-12 shrink-0 items-center gap-2 rounded-[6px] bg-brand px-6 text-[15px] font-medium text-on-brand hover:bg-brand-dark">
            <EnvelopeSimple size={18} /> {LEGAL_EMAIL}
          </a>
        </Reveal>
      </section>

      <section className="grid-band px-5 py-16 sm:px-8 md:px-12">
        <h2 className="text-lg font-normal text-fg">Other policies</h2>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {legalPages.filter((l) => l.slug !== slug).map((l) => (
            <Link key={l.slug} href={`/${l.slug}`} className="group flex items-center justify-between rounded-[6px] border border-line p-5 transition-colors hover:border-brand/50 hover:bg-surface">
              <span className="font-medium text-fg">{l.title}</span>
              <ArrowUpRight size={16} className="text-muted transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
