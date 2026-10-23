import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, ChatsCircle, Clock, EnvelopeSimple } from "@phosphor-icons/react/dist/ssr";
import { Label } from "./landing/grid";
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

      {/* Full-width black band with a hairline grid of contact options, like the other dark bands. */}
      <section className="grid-band bg-ink px-5 py-16 text-ink-fg sm:px-8 md:px-12 md:py-20">
        <div className="grid gap-10 md:grid-cols-[1.1fr_1fr] md:items-center md:gap-16">
          <Reveal>
            <Label invert>Legal questions</Label>
            <h2 className="mt-5 text-[2rem] font-normal leading-[1.08] tracking-[-0.03em] md:text-[2.6rem]">
              Questions about this <span className="text-brand">policy?</span>
            </h2>
            <p className="mt-4 max-w-[46ch] text-[15px] leading-relaxed text-ink-fg/65">Write to us and a real person will answer.</p>
            <p className="mt-6 inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.1em] text-ink-fg/50">
              <Clock size={14} className="text-brand" /> Usually within two working days
            </p>
          </Reveal>
          <Reveal delay={0.1}>
            <div className="grid grid-cols-1 gap-px overflow-hidden rounded-[6px] border border-white/10 bg-white/10 sm:grid-cols-2">
              {[
                { href: `mailto:${LEGAL_EMAIL}`, I: EnvelopeSimple, label: "Email us", value: LEGAL_EMAIL },
                { href: "/contact", I: ChatsCircle, label: "Talk to the team", value: "Book a call or ask a question" },
              ].map(({ href, I, label, value }) => {
                const inner = (
                  <>
                    <span className="flex items-start justify-between">
                      <span className="grid size-11 place-items-center rounded-[4px] border border-white/15 text-ink-fg transition-colors duration-300 group-hover:border-brand group-hover:bg-brand group-hover:text-on-brand">
                        <I size={20} />
                      </span>
                      <ArrowUpRight size={18} className="text-ink-fg/40 transition-[transform,color] duration-300 ease-out-expo group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-brand" />
                    </span>
                    <span className="mt-8 block font-mono text-[11px] uppercase tracking-[0.1em] text-brand">{label}</span>
                    <span className="mt-2 block text-[16px] text-ink-fg">{value}</span>
                  </>
                );
                const cls = "group block bg-ink p-6 transition-shadow duration-300 hover:shadow-[inset_0_0_0_1px_rgb(255_112_0/0.5)] md:p-7";
                return href.startsWith("mailto:") ? (
                  <a key={label} href={href} className={cls}>{inner}</a>
                ) : (
                  <Link key={label} href={href} className={cls}>{inner}</Link>
                );
              })}
            </div>
          </Reveal>
        </div>
      </section>

      <section className="grid-band px-5 py-16 sm:px-8 md:px-12">
        <h2 className="text-lg font-normal text-fg">Other policies</h2>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {legalPages.filter((l) => l.slug !== slug).map((l) => (
            <Link key={l.slug} href={`/${l.slug}`} className="group flex items-center justify-between rounded-[6px] border border-line p-5 transition-colors duration-300 hover:border-brand/40">
              <span className="font-medium text-fg">{l.title}</span>
              <ArrowUpRight size={16} className="text-muted transition-[transform,color] duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-brand-ink" />
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
