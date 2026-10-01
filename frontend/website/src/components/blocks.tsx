import Link from "next/link";
import { ArrowUpRight, CaretRight, Check, X } from "@phosphor-icons/react/dist/ssr";
import type { Shot } from "@/lib/shots";
import { BrowserFrame } from "./browser-frame";
import { Faq } from "./faq";
import { Reveal, Stagger, StaggerItem } from "./motion/reveal";
import { Section, SectionHead } from "./section";

export function Breadcrumbs({ trail }: { trail: { name: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
        {trail.map((t, i) => (
          <li key={t.name} className="flex items-center gap-1.5">
            {i > 0 && <CaretRight size={11} aria-hidden />}
            {t.href ? (
              <Link href={t.href} className="hover:text-fg">{t.name}</Link>
            ) : (
              <span aria-current="page" className="text-fg">{t.name}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Text on one side, a framed product screenshot on the other; flips with `reverse`. */
export function FeatureSplit({
  eyebrow,
  title,
  body,
  points,
  shot,
  reverse = false,
  crop,
  children,
}: {
  eyebrow?: string;
  title: string;
  body: string;
  points?: string[];
  shot: Shot;
  reverse?: boolean;
  crop?: { x: number; y: number; scale: number };
  children?: React.ReactNode;
}) {
  return (
    <div className={`grid items-center gap-10 lg:gap-14 ${reverse ? "lg:grid-cols-[1.15fr_0.85fr]" : "lg:grid-cols-[0.85fr_1.15fr]"}`}>
      <div className={reverse ? "lg:order-2" : ""}>
        {eyebrow && (
          <Reveal>
            <span className="text-[12px] font-medium uppercase tracking-[0.16em] text-brand-ink">{eyebrow}</span>
          </Reveal>
        )}
        <Reveal delay={0.05}>
          <h3 className="mt-3 text-3xl font-semibold leading-[1.1] tracking-tight text-fg md:text-4xl">{title}</h3>
        </Reveal>
        <Reveal delay={0.1}>
          <p className="mt-4 max-w-[52ch] text-lg leading-relaxed text-muted">{body}</p>
        </Reveal>
        {points && (
          <Reveal delay={0.15}>
            <ul className="mt-6 grid gap-2.5">
              {points.map((p) => (
                <li key={p} className="flex items-start gap-3 text-[15px] text-fg-2">
                  <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-brand/15 text-brand-ink">
                    <Check size={11} weight="bold" />
                  </span>
                  {p}
                </li>
              ))}
            </ul>
          </Reveal>
        )}
        {children && <Reveal delay={0.2} className="mt-8">{children}</Reveal>}
      </div>
      <Reveal y={40} delay={0.1} className={`min-w-0 ${reverse ? "lg:order-1" : ""}`}>
        <BrowserFrame shot={shot} crop={crop} aspect={crop ? "aspect-[16/10]" : undefined} sizes="(max-width: 1024px) 100vw, 640px" />
      </Reveal>
    </div>
  );
}

export function FaqSection({ title, items, id = "faq" }: { title: string; items: { q: string; a: string }[]; id?: string }) {
  return (
    <Section id={id} className="grid gap-10 md:grid-cols-[0.8fr_1.2fr]">
      <div>
        <SectionHead eyebrow="FAQ" title={title} />
        <Reveal delay={0.2}>
          <p className="mt-6 text-muted">
            Something else? <Link href="/contact" className="font-medium text-brand-ink underline-offset-4 hover:underline">Ask our team</Link>.
          </p>
        </Reveal>
      </div>
      <Reveal delay={0.1}>
        <Faq items={items} />
      </Reveal>
    </Section>
  );
}

/** Two-column comparison: life before vs. after. */
export function BeforeAfter({ before, after, beforeTitle = "Without Aavishield", afterTitle = "With Aavishield" }: { before: string[]; after: string[]; beforeTitle?: string; afterTitle?: string }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Reveal className="rounded-[20px] border border-line bg-surface p-8">
        <h3 className="text-lg font-semibold text-fg">{beforeTitle}</h3>
        <ul className="mt-6 grid gap-4">
          {before.map((b) => (
            <li key={b} className="flex items-start gap-3 text-muted">
              <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-danger/10 text-danger"><X size={11} weight="bold" /></span>
              {b}
            </li>
          ))}
        </ul>
      </Reveal>
      <Reveal delay={0.1} className="ink-edge relative overflow-hidden rounded-[20px] bg-ink p-8 text-ink-fg">
        <div aria-hidden className="absolute -right-16 -top-16 size-56 rounded-full bg-brand/25 blur-3xl" />
        <h3 className="relative text-lg font-semibold">{afterTitle}</h3>
        <ul className="relative mt-6 grid gap-4">
          {after.map((a) => (
            <li key={a} className="flex items-start gap-3 opacity-90">
              <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-brand text-on-brand"><Check size={11} weight="bold" /></span>
              {a}
            </li>
          ))}
        </ul>
      </Reveal>
    </div>
  );
}

/** Grid of cards with a title, body and a thin brand rule. */
export function CardGrid({ items, cols = 3 }: { items: { title: string; body: string }[]; cols?: 2 | 3 | 4 }) {
  const c = cols === 4 ? "sm:grid-cols-2 lg:grid-cols-4" : cols === 2 ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3";
  return (
    <Stagger className={`grid gap-px overflow-hidden rounded-[20px] border border-line bg-line ${c}`}>
      {items.map((x) => (
        <StaggerItem key={x.title} className="group bg-bg p-7 transition-colors duration-300 hover:bg-surface md:p-8">
          <span className="mb-5 block h-0.5 w-8 bg-brand transition-[width] duration-500 ease-out-expo group-hover:w-16" />
          <h3 className="text-lg font-semibold tracking-tight text-fg">{x.title}</h3>
          <p className="mt-2.5 leading-relaxed text-muted">{x.body}</p>
        </StaggerItem>
      ))}
    </Stagger>
  );
}

/** Linked cards to other pages. */
export function LinkCards({ items }: { items: { href: string; title: string; body: string; icon?: React.ReactNode }[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 [&>*]:min-w-0">
      {items.map((r) => (
        <Link key={r.href} href={r.href} className="group flex items-start gap-4 rounded-[20px] border border-line bg-surface p-6 transition-colors duration-300 hover:border-brand/50">
          {r.icon && (
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl border border-line text-fg transition-colors duration-300 group-hover:border-brand group-hover:bg-brand group-hover:text-on-brand">{r.icon}</span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-fg">{r.title}</span>
            <span className="mt-1 block text-sm leading-relaxed text-muted">{r.body}</span>
          </span>
          <ArrowUpRight size={18} className="shrink-0 text-muted transition-transform duration-300 ease-out-expo group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </Link>
      ))}
    </div>
  );
}

/** Big numbers row with labels (only ever for facts about the product). */
export function FactStrip({ items }: { items: { k: string; label: string }[] }) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[20px] border border-line bg-line md:grid-cols-4">
      {items.map((s, i) => (
        <Reveal key={s.label} delay={i * 0.06} className="bg-bg p-6 md:p-8">
          <p className="text-4xl font-semibold tracking-tighter text-fg md:text-5xl">
            {s.k}
            <span className="text-brand">.</span>
          </p>
          <p className="mt-2 text-sm text-muted">{s.label}</p>
        </Reveal>
      ))}
    </div>
  );
}
