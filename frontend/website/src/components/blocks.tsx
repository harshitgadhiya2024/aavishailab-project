import Link from "next/link";
import { ArrowRight, ArrowUpRight, CaretRight, Check, X } from "@phosphor-icons/react/dist/ssr";
import type { Shot } from "@/lib/shots";
import { BrowserFrame } from "./browser-frame";
import { panelForShot } from "./panels";
import { Faq } from "./faq";
import { Label } from "./landing/grid";
import { PixelPanel } from "./landing/visuals";
import { Reveal, Stagger, StaggerItem } from "./motion/reveal";
import { Section, SectionHead } from "./section";

export function Breadcrumbs({ trail }: { trail: { name: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-muted">
        {trail.map((t, i) => (
          <li key={t.name} className="flex items-center gap-1.5">
            {i > 0 && <CaretRight size={10} aria-hidden />}
            {t.href ? (
              <Link href={t.href} className="hover:text-fg">{t.name}</Link>
            ) : (
              <span aria-current="page" className="text-brand-ink">{t.name}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Text on one side, a real console screenshot (or a product panel) on a pixel-grid stage on the other; flips with `reverse`. */
export function FeatureSplit({
  eyebrow,
  title,
  body,
  points,
  shot,
  visual,
  real = false,
  reverse = false,
  crop,
  children,
}: {
  eyebrow?: string;
  title: string;
  body: string;
  points?: string[];
  shot?: Shot;
  /** A product panel to show instead of the screenshot. */
  visual?: React.ReactNode;
  /** Keep the real screenshot (Product tour) instead of its product panel. */
  real?: boolean;
  reverse?: boolean;
  crop?: { x: number; y: number; scale: number };
  children?: React.ReactNode;
}) {
  const panel = visual ?? (!real && shot ? panelForShot(shot) : undefined);
  return (
    <div className={`grid items-center gap-10 lg:gap-14 ${reverse ? "lg:grid-cols-[1.15fr_0.85fr]" : "lg:grid-cols-[0.85fr_1.15fr]"}`}>
      <div className={reverse ? "lg:order-2" : ""}>
        {eyebrow && (
          <Reveal>
            <Label>{eyebrow}</Label>
          </Reveal>
        )}
        <Reveal delay={0.05}>
          <h3 className="mt-5 text-[1.9rem] font-normal leading-[1.08] tracking-[-0.03em] text-fg md:text-[2.25rem]">{title}</h3>
        </Reveal>
        <Reveal delay={0.1}>
          <p className="mt-4 max-w-[52ch] text-[15px] leading-relaxed text-muted">{body}</p>
        </Reveal>
        {points && (
          <Reveal delay={0.15}>
            <ul className="mt-6 grid gap-2.5">
              {points.map((p) => (
                <li key={p} className="flex items-start gap-3 text-sm text-fg-2">
                  <span className="mt-[7px] size-1.5 shrink-0 bg-brand" />
                  {p}
                </li>
              ))}
            </ul>
          </Reveal>
        )}
        {children && <Reveal delay={0.2} className="mt-8">{children}</Reveal>}
      </div>
      <Reveal y={40} delay={0.1} className={`min-w-0 ${reverse ? "lg:order-1" : ""}`}>
        {/* Panels sit on a stage of one fixed height and width, so every split on the site matches. */}
        <PixelPanel className={panel ? "grid place-items-center p-4 sm:p-8 lg:h-[600px] lg:p-10" : "p-3 sm:p-6"}>
          {panel ? <div className="w-full max-w-[560px]">{panel}</div> : (shot && <BrowserFrame shot={shot} crop={crop} aspect={crop ? "aspect-[16/10]" : undefined} sizes="(max-width: 1024px) 100vw, 640px" />)}
        </PixelPanel>
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
          <p className="mt-6 text-sm text-muted">
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
    <div className="grid gap-px overflow-hidden rounded-[4px] border border-line bg-line md:grid-cols-2">
      <Reveal className="bg-bg p-7 md:p-9">
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">Before</span>
        <h3 className="mt-3 text-xl font-normal tracking-[-0.02em] text-fg">{beforeTitle}</h3>
        <ul className="mt-6 grid gap-3.5">
          {before.map((b) => (
            <li key={b} className="flex items-start gap-3 text-sm text-muted">
              <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-[4px] bg-[#fdecea] text-danger"><X size={11} weight="bold" /></span>
              {b}
            </li>
          ))}
        </ul>
      </Reveal>
      <Reveal delay={0.1} className="pixel-grid bg-brand-soft p-7 md:p-9">
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-brand-ink">After</span>
        <h3 className="mt-3 text-xl font-normal tracking-[-0.02em] text-fg">{afterTitle}</h3>
        <ul className="mt-6 grid gap-3.5">
          {after.map((a) => (
            <li key={a} className="flex items-start gap-3 text-sm text-fg-2">
              <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-[4px] bg-brand text-on-brand"><Check size={11} weight="bold" /></span>
              {a}
            </li>
          ))}
        </ul>
      </Reveal>
    </div>
  );
}

/** Grid of numbered cells with a title and body, separated by hairlines. */
export function CardGrid({ items, cols = 3 }: { items: { title: string; body: string }[]; cols?: 2 | 3 | 4 }) {
  const c = cols === 4 ? "sm:grid-cols-2 lg:grid-cols-4" : cols === 2 ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3";
  return (
    <Stagger className={`grid grid-cols-1 gap-px overflow-hidden rounded-[4px] border border-line bg-line ${c}`}>
      {items.map((x, i) => (
        <StaggerItem key={x.title} className="group bg-bg p-6 transition-colors duration-300 hover:bg-brand-soft md:p-7">
          <span className="font-mono text-[11px] text-brand-ink">{String(i + 1).padStart(2, "0")}</span>
          <h3 className="mt-4 text-lg font-normal tracking-[-0.015em] text-fg">{x.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted">{x.body}</p>
        </StaggerItem>
      ))}
    </Stagger>
  );
}

// Column spans that close the last row of a 2-column (md) / 3-column (lg)
// grid, so it never ends in an empty cell. Index by cells left to fill.
const MD_SPAN = ["", "md:col-span-1", "md:col-span-2"];
const LG_SPAN = ["", "lg:col-span-1", "lg:col-span-2", "lg:col-span-3"];

/**
 * Linked cards to other pages, as hairline-separated grid cells. The last row
 * is always full: with `more`, a "see all" card takes the leftover space (a
 * full-width strip when the row is already full); without it, the last card
 * stretches across the empty cells.
 */
export function LinkCards({
  items,
  more,
}: {
  items: { href: string; title: string; body: string; icon?: React.ReactNode }[];
  more?: { href: string; label: string };
}) {
  const n = items.length;
  const stretch = more ? "" : `${MD_SPAN[n % 2 ? 2 : 0]} ${LG_SPAN[[1, 3, 2][n % 3]]}`;
  const moreSpan = `${MD_SPAN[n % 2 ? 1 : 2]} ${LG_SPAN[n % 3 ? 3 - (n % 3) : 3]}`;
  return (
    <div className="grid grid-cols-1 gap-px overflow-hidden rounded-[4px] border border-line bg-line md:grid-cols-2 lg:grid-cols-3 [&>*]:min-w-0">
      {items.map((r, i) => (
        <Link key={r.href} href={r.href} className={`group flex items-start gap-4 bg-bg p-6 transition-shadow duration-300 hover:shadow-[inset_0_0_0_1px_rgb(255_112_0/0.45)] ${i === n - 1 ? stretch : ""}`}>
          {r.icon && (
            <span className="grid size-10 shrink-0 place-items-center rounded-[4px] border border-brand/30 bg-brand-soft text-brand-ink transition-colors duration-300 group-hover:border-brand group-hover:bg-brand group-hover:text-on-brand">{r.icon}</span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] text-fg">{r.title}</span>
            <span className="mt-1 block text-sm leading-relaxed text-muted">{r.body}</span>
          </span>
          <ArrowUpRight size={16} className="shrink-0 text-muted transition-transform duration-300 ease-out-expo group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-brand-ink" />
        </Link>
      ))}
      {more && (
        <Link href={more.href} className={`pixel-grid group flex items-center justify-between gap-4 bg-brand-soft p-6 transition-colors duration-300 hover:bg-brand-tint ${moreSpan}`}>
          <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-brand-ink">{more.label}</span>
          <span className="grid size-10 shrink-0 place-items-center rounded-[4px] bg-brand text-on-brand transition-transform duration-300 ease-out-expo group-hover:translate-x-1">
            <ArrowRight size={16} />
          </span>
        </Link>
      )}
    </div>
  );
}

/** Big numbers row with labels (only ever for facts about the product). */
export function FactStrip({ items }: { items: { k: string; label: string }[] }) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[4px] border border-line bg-line md:grid-cols-4">
      {items.map((s, i) => (
        <Reveal key={s.label} delay={i * 0.06} className="bg-bg p-6 md:p-8">
          <p className="font-mono text-4xl tracking-[-0.04em] text-fg md:text-5xl">{s.k}</p>
          <p className="mt-3 text-sm text-muted">{s.label}</p>
        </Reveal>
      ))}
    </div>
  );
}
