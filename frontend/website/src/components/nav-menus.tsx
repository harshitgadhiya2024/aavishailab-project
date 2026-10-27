"use client";

// The navigation's mega menu panels and mobile menu. Split out of nav.tsx and
// loaded on demand (next/dynamic), so their icons and widgets are not part
// of every page's initial JavaScript.
//
// Each panel is a calm band pinned under the 64px header, inside the same
// frame (.frame-w) as the page: plain link names in roomy columns, and one
// product widget on the pixel-grid stage, as on the landing page. No
// screenshots, no per-link descriptions in the lists.

import { ArrowRight, CaretDown } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import { CTA, modules, resources, type ModuleSlug } from "@/lib/content";
import { industries, solutionsList } from "@/lib/solutions";
import { GridButton } from "./landing/grid-button";
import { ControlsHero, FeedHero, ModuleVisual } from "./landing/hero-widgets";
import { ModuleIcon } from "./icons";
import { SolutionIcon } from "./solution-icon";

const EASE = [0.16, 1, 0.3, 1] as const;

const panel = {
  initial: { opacity: 0, y: -6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4, transition: { duration: 0.12 } },
  transition: { duration: 0.25, ease: EASE },
};

const mono = "font-mono text-[11px] uppercase tracking-[0.12em]";

/** The band itself: fixed under the header, framed like the page. */
function MegaPanel({ children }: { children: React.ReactNode }) {
  return (
    <motion.div {...panel} className="fixed inset-x-0 top-16 z-40">
      {/* Never taller than the screen below the header; scrolls inside if it ever has to. */}
      <div className="frame-w max-h-[calc(100dvh-4rem)] overflow-y-auto overscroll-contain border-x border-b border-line bg-bg shadow-[0_30px_60px_-30px_rgb(24_24_27/0.3)]">{children}</div>
    </motion.div>
  );
}

function ColumnLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className={`mb-4 flex items-center gap-2 ${mono} text-brand-ink`}>
      <span className="size-1.5 bg-brand" />
      {children}
    </p>
  );
}

/** A menu link: icon and name, with an optional one-line hint. */
function MenuLink({ href, icon, children, sub, onNavigate, onHover, active = false }: { href: string; icon: React.ReactNode; children: React.ReactNode; sub?: string; onNavigate: () => void; onHover?: () => void; active?: boolean }) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      onPointerEnter={onHover}
      onFocus={onHover}
      className={`group -mx-3 flex gap-3 rounded-[4px] px-3 py-2 transition-colors duration-200 ${sub ? "items-start" : "items-center"} ${active ? "bg-brand-soft" : "hover:bg-brand-soft"}`}
    >
      <span className={`shrink-0 ${sub ? "mt-[3px]" : ""}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className={`block text-[15px] leading-snug transition-colors ${active ? "text-fg" : "text-fg-2 group-hover:text-fg"}`}>{children}</span>
        {sub && <span className="mt-0.5 block text-[12.5px] leading-snug text-muted">{sub}</span>}
      </span>
      <ArrowRight size={13} className={`shrink-0 ${sub ? "mt-[5px]" : ""} text-brand-ink transition-[opacity,transform] duration-200 ${active ? "translate-x-0 opacity-100" : "-translate-x-1 opacity-0 group-hover:translate-x-0 group-hover:opacity-100"}`} />
    </Link>
  );
}

function AllLink({
  href,
  children,
  onNavigate,
  onHover,
  active = false,
  pin = false,
}: {
  href: string;
  children: React.ReactNode;
  onNavigate: () => void;
  onHover?: () => void;
  active?: boolean;
  pin?: boolean;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      onPointerEnter={onHover}
      onFocus={onHover}
      className={`inline-flex items-center gap-1.5 ${mono} underline underline-offset-4 ${
        pin ? "mt-auto pt-6" : "mt-5"
      } ${active ? "text-brand-ink decoration-brand/40" : "text-fg decoration-fg/30 hover:text-brand-ink"}`}
    >
      {children} <ArrowRight size={12} />
    </Link>
  );
}

/** Right-hand stage: a live product widget on a tall pixel-grid stage. */
function Stage({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`min-h-0 overflow-hidden border-l border-line p-8 [&>*]:h-full [&_.pixel-grid]:h-full [&_.pixel-grid]:min-h-0 ${className}`}>
      {children}
    </div>
  );
}

/** A small callout card used to close a column: label, line, and a button. */
function Callout({ label, title, href, cta, onNavigate }: { label: string; title: string; href: string; cta: string; onNavigate: () => void }) {
  // Sits at the bottom of its column, but always at least 2rem below the list above.
  return (
    <div className="mt-auto pt-8">
      <div className="pixel-grid rounded-[6px] border border-brand/20 bg-brand-soft p-5">
        <p className={`${mono} text-brand-ink`}>{label}</p>
        <p className="mt-2 font-display text-[18px] leading-snug tracking-[-0.015em] text-fg">{title}</p>
        <div className="mt-4" onClick={onNavigate}>
          <GridButton href={href}>{cta}</GridButton>
        </div>
      </div>
    </div>
  );
}

// One template for every tab. Height is locked so hovering a control never
// resizes the band (different copy and widgets used to push it around).
const TAB = "grid h-[min(34rem,calc(100dvh-4rem))] grid-cols-[minmax(260px,0.85fr)_minmax(260px,0.8fr)_1.25fr]";
const COL = "flex min-h-0 flex-col p-10";

const OVERVIEW = {
  name: "Platform",
  headline: "Every control your devices need, in one agent.",
  short: "Web, DLP, apps, VPNs, malware, posture and activity monitoring. Turn each one on when you are ready.",
  href: "/platform",
  cta: "Explore platform",
} as const;

type Preview = ModuleSlug | "overview";

export function PlatformMenu({ onNavigate }: { onNavigate: () => void }) {
  const [hover, setHover] = useState<Preview>(modules[0].slug);
  const current = hover === "overview" ? OVERVIEW : modules.find((m) => m.slug === hover)!;
  const href = hover === "overview" ? OVERVIEW.href : `/platform/${hover}`;
  const cta = hover === "overview" ? OVERVIEW.cta : "Explore";
  return (
    <MegaPanel>
      <div className={TAB}>
        <div className={COL}>
          <ColumnLabel>Seven controls</ColumnLabel>
          <ul>
            {modules.map((m) => (
              <li key={m.slug}>
                <MenuLink
                  href={`/platform/${m.slug}`}
                  icon={<ModuleIcon icon={m.icon} size={17} className="text-brand-ink" />}
                  onNavigate={onNavigate}
                  onHover={() => setHover(m.slug)}
                  active={hover === m.slug}
                >
                  {m.name}
                </MenuLink>
              </li>
            ))}
          </ul>
          <AllLink href="/platform" onNavigate={onNavigate} onHover={() => setHover("overview")} active={hover === "overview"} pin>
            Platform overview
          </AllLink>
        </div>
        <div className={`${COL} border-l border-line`}>
          <ColumnLabel>{current.name}</ColumnLabel>
          <div className="relative min-h-[8.5rem]">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={hover}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="absolute inset-x-0 top-0"
              >
                <p className="font-display text-[24px] leading-snug tracking-[-0.02em] text-fg">{current.headline}</p>
                <p className="mt-3 text-sm leading-relaxed text-muted">{current.short}</p>
              </motion.div>
            </AnimatePresence>
          </div>
          <Callout label="See it working" title="See it on your own devices." href={href} cta={cta} onNavigate={onNavigate} />
        </div>
        <Stage>
          {hover === "overview" ? <ControlsHero /> : <ModuleVisual key={hover} slug={hover} />}
        </Stage>
      </div>
    </MegaPanel>
  );
}

export function SolutionsMenu({ onNavigate }: { onNavigate: () => void }) {
  return (
    <MegaPanel>
      {/* Names only (no hints) so the nine problems fit a small laptop in one column. */}
      <div className={TAB}>
        <div className={COL}>
          <ColumnLabel>By problem</ColumnLabel>
          <ul>
            {solutionsList.map((s) => (
              <li key={s.slug}>
                <MenuLink href={`/solutions/${s.slug}`} icon={<SolutionIcon icon={s.icon} size={16} className="text-brand-ink" />} onNavigate={onNavigate}>
                  {s.name}
                </MenuLink>
              </li>
            ))}
          </ul>
          <AllLink href="/solutions" onNavigate={onNavigate}>All solutions</AllLink>
        </div>
        <div className={`${COL} border-l border-line`}>
          <ColumnLabel>By industry</ColumnLabel>
          <ul>
            {industries.map((ind) => (
              <li key={ind.slug}>
                <MenuLink href={`/industries/${ind.slug}`} icon={<SolutionIcon icon={ind.icon} size={16} className="text-brand-ink" />} onNavigate={onNavigate}>
                  {ind.name}
                </MenuLink>
              </li>
            ))}
          </ul>
          <Callout label="Not sure where to start?" title="Tell us the problem. We will show you the fix." href="/contact" cta={CTA.demo} onNavigate={onNavigate} />
        </div>
        <Stage>
          <FeedHero />
        </Stage>
      </div>
    </MegaPanel>
  );
}

export function ResourcesMenu({ onNavigate }: { onNavigate: () => void }) {
  return (
    <MegaPanel>
      <div className={TAB}>
        <div className={COL}>
          <ColumnLabel>Resources</ColumnLabel>
          <ul>
            {resources.map((r) => (
              <li key={r.href}>
                <Link href={r.href} onClick={onNavigate} className="group -mx-3 flex items-center gap-3 rounded-[4px] px-3 py-2 text-[15px] text-fg-2 transition-colors duration-200 hover:bg-brand-soft hover:text-fg">
                  {r.label}
                  <ArrowRight size={13} className="ml-auto -translate-x-1 text-brand-ink opacity-0 transition-[opacity,transform] duration-200 group-hover:translate-x-0 group-hover:opacity-100" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div className={`${COL} border-l border-line`}>
          <ColumnLabel>Featured</ColumnLabel>
          <p className="font-display text-[24px] leading-snug tracking-[-0.02em] text-fg">Walk through the real console, screen by screen.</p>
          <p className="mt-3 text-sm leading-relaxed text-muted">Every control, every report, with demo data from a fictional company.</p>
          <AllLink href="/product-tour" onNavigate={onNavigate}>Take the product tour</AllLink>
          <div className={`mt-6 flex items-center gap-6 ${mono} text-muted`}>
            <Link href="/pricing" onClick={onNavigate} className="hover:text-fg">Pricing</Link>
            <Link href="/security" onClick={onNavigate} className="hover:text-fg">Security</Link>
          </div>
          <Callout label="See it on your devices" title="A pilot can be live in an afternoon." href="/contact" cta={CTA.demo} onNavigate={onNavigate} />
        </div>
        <Stage>
          <ModuleVisual slug="web-gateway" />
        </Stage>
      </div>
    </MegaPanel>
  );
}

function MobileGroup({ title, children }: { title: string; children: React.ReactNode }) {
  const [o, setO] = useState(false);
  return (
    <li className="border-b border-line">
      <button type="button" onClick={() => setO(!o)} aria-expanded={o} className="flex w-full items-center justify-between px-5 py-4 font-display text-lg text-fg">
        {title}
        <CaretDown size={14} weight="bold" className={`transition-transform duration-300 ${o ? "rotate-180 text-brand" : ""}`} />
      </button>
      <AnimatePresence initial={false}>
        {o && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.35, ease: EASE }} className="overflow-hidden">
            <div className="pb-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

const subLink = "flex items-center gap-3 px-5 py-2.5 text-[15px] text-fg-2 hover:bg-brand-soft hover:text-fg";
const subLabel = `px-5 pb-1 pt-3 ${mono} text-brand-ink`;

export function MobileMenu() {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.3, ease: EASE }}
      className="frame-w max-h-[calc(100dvh-64px)] overflow-y-auto border-x border-b border-line bg-bg lg:hidden"
    >
      <ul>
        <MobileGroup title="Platform">
          <ul className="grid grid-cols-1 sm:grid-cols-2">
            <li><Link href="/platform" className={subLink}>Platform overview</Link></li>
            {modules.map((m) => (
              <li key={m.slug}>
                <Link href={`/platform/${m.slug}`} className={subLink}>
                  <ModuleIcon icon={m.icon} size={17} className="text-brand-ink" />
                  {m.name}
                </Link>
              </li>
            ))}
          </ul>
        </MobileGroup>
        <MobileGroup title="Solutions">
          <p className={subLabel}>By problem</p>
          <ul className="grid grid-cols-1 sm:grid-cols-2">
            {solutionsList.map((s) => (
              <li key={s.slug}>
                <Link href={`/solutions/${s.slug}`} className={subLink}>
                  <SolutionIcon icon={s.icon} size={17} className="text-brand-ink" />
                  {s.name}
                </Link>
              </li>
            ))}
          </ul>
          <p className={subLabel}>By industry</p>
          <ul className="grid grid-cols-1 sm:grid-cols-2">
            {industries.map((i) => (
              <li key={i.slug}>
                <Link href={`/industries/${i.slug}`} className={subLink}>
                  <SolutionIcon icon={i.icon} size={17} className="text-brand-ink" />
                  {i.name}
                </Link>
              </li>
            ))}
          </ul>
        </MobileGroup>
        <MobileGroup title="Resources">
          <ul>
            {resources.map((r) => (
              <li key={r.href}><Link href={r.href} className={subLink}>{r.label}</Link></li>
            ))}
          </ul>
        </MobileGroup>
        {[
          { href: "/pricing", label: "Pricing" },
          { href: "/company", label: "Company" },
          { href: "/contact", label: "Contact" },
        ].map((l) => (
          <li key={l.href} className="border-b border-line">
            <Link href={l.href} className="block px-5 py-4 font-display text-lg text-fg hover:bg-brand-soft">{l.label}</Link>
          </li>
        ))}
      </ul>
      <div className="p-5 sm:hidden">
        <GridButton href="/contact" className="w-full justify-center">{CTA.demo}</GridButton>
      </div>
    </motion.div>
  );
}
