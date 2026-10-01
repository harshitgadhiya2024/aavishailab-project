"use client";

import { ArrowRight, CaretDown, List, X } from "@phosphor-icons/react";
import { AnimatePresence, motion, useMotionValueEvent, useScroll, useSpring } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { CTA, modules, nav, resources } from "@/lib/content";
import { moduleShots } from "@/lib/module-shots";
import { shots } from "@/lib/shots";
import { industries, solutionsList } from "@/lib/solutions";
import { Button } from "./button";
import { ModuleIcon } from "./icons";
import { SolutionIcon } from "./solution-icon";
import { ThemeToggle } from "./theme-toggle";
import { Wordmark } from "./wordmark";

const EASE = [0.16, 1, 0.3, 1] as const;
type MenuKey = "platform" | "solutions" | "resources";

const panel = {
  initial: { opacity: 0, y: 8, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 6, scale: 0.98, transition: { duration: 0.15 } },
  transition: { duration: 0.3, ease: EASE },
  style: { transformOrigin: "top center" },
};
const panelCls = "absolute left-1/2 top-full mt-3 -translate-x-1/2 border border-line bg-surface/[0.97] shadow-[var(--shadow)] backdrop-blur-xl rounded-[24px] p-3";

function PlatformMenu({ onNavigate }: { onNavigate: () => void }) {
  const [hover, setHover] = useState(modules[0].slug);
  return (
    <motion.div {...panel} className={`${panelCls} grid w-[760px] grid-cols-[1.35fr_1fr] gap-3`}>
      <ul className="grid grid-cols-1 gap-0.5">
        {modules.map((m) => (
          <li key={m.slug}>
            <Link
              href={`/platform/${m.slug}`}
              onPointerEnter={() => setHover(m.slug)}
              onFocus={() => setHover(m.slug)}
              onClick={onNavigate}
              className={`flex items-start gap-3 rounded-2xl px-3 py-2.5 transition-colors duration-200 ${hover === m.slug ? "bg-bg-2" : ""}`}
            >
              <span className={`grid size-9 shrink-0 place-items-center rounded-xl transition-colors duration-200 ${hover === m.slug ? "bg-brand text-on-brand" : "border border-line text-fg"}`}>
                <ModuleIcon icon={m.icon} size={18} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-fg">{m.name}</span>
                <span className="block truncate text-[12.5px] text-muted">{m.short}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <Link href={`/platform/${hover}`} onClick={onNavigate} className="group relative block overflow-hidden rounded-[18px] bg-ink">
        <AnimatePresence initial={false}>
          <motion.div key={hover} initial={{ opacity: 0, scale: 1.06 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.5, ease: EASE }} className="absolute inset-0">
            <Image src={shots[moduleShots[hover].hero].src} alt="" fill sizes="300px" className="object-cover object-left-top transition-transform duration-700 ease-out-expo group-hover:scale-105" />
          </motion.div>
        </AnimatePresence>
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-5 text-white">
          <p className="text-[15px] font-semibold">{modules.find((m) => m.slug === hover)!.name}</p>
          <p className="mt-1 flex items-center gap-1.5 text-[13px] text-white/75">
            See it in the console <ArrowRight size={12} weight="bold" className="transition-transform duration-300 group-hover:translate-x-1" />
          </p>
        </div>
      </Link>
      <Link href="/platform" onClick={onNavigate} className="col-span-2 flex items-center justify-between rounded-2xl bg-bg-2 px-4 py-3 text-sm text-fg hover:text-brand-ink">
        <span><span className="font-medium">Platform overview</span> <span className="text-muted">· seven controls, one agent, one console</span></span>
        <ArrowRight size={14} weight="bold" />
      </Link>
    </motion.div>
  );
}

function SolutionsMenu({ onNavigate }: { onNavigate: () => void }) {
  return (
    <motion.div {...panel} className={`${panelCls} grid w-[880px] grid-cols-[1.5fr_1fr] gap-3`}>
      <div>
        <p className="px-3 pb-2 pt-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted">By problem</p>
        <ul className="grid grid-cols-1 gap-0.5">
          {solutionsList.map((s) => (
            <li key={s.slug}>
              <Link href={`/solutions/${s.slug}`} onClick={onNavigate} className="group flex items-start gap-3 rounded-2xl px-3 py-2 transition-colors duration-200 hover:bg-bg-2">
                <span className="grid size-8 shrink-0 place-items-center rounded-xl border border-line text-fg transition-colors duration-200 group-hover:border-brand group-hover:bg-brand group-hover:text-on-brand">
                  <SolutionIcon icon={s.icon} size={16} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-fg">{s.name}</span>
                  <span className="block truncate text-[12px] text-muted">{s.menu}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col rounded-[18px] bg-bg-2 p-2">
        <p className="px-3 pb-2 pt-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted">By industry</p>
        <ul className="grid gap-0.5">
          {industries.map((i) => (
            <li key={i.slug}>
              <Link href={`/industries/${i.slug}`} onClick={onNavigate} className="group flex items-center gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-surface">
                <SolutionIcon icon={i.icon} size={17} className="shrink-0 text-brand-ink" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-fg">{i.name}</span>
                  <span className="block truncate text-[12px] text-muted">{i.menu}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <Link href="/solutions" onClick={onNavigate} className="group relative mt-auto block overflow-hidden rounded-[14px] bg-ink p-4 text-white">
          <Image src="/images/solution-ai.webp" alt="" fill sizes="320px" className="object-cover opacity-50 transition-transform duration-700 ease-out-expo group-hover:scale-105" />
          <span className="relative block text-sm font-semibold">All solutions</span>
          <span className="relative mt-1 flex items-center gap-1.5 text-[12.5px] text-white/75">
            Start from the problem you have <ArrowRight size={12} weight="bold" className="transition-transform group-hover:translate-x-1" />
          </span>
        </Link>
      </div>
    </motion.div>
  );
}

function ResourcesMenu({ onNavigate }: { onNavigate: () => void }) {
  return (
    <motion.div {...panel} className={`${panelCls} grid w-[620px] grid-cols-[1fr_1fr] gap-3`}>
      <ul className="grid gap-0.5">
        {resources.map((r) => (
          <li key={r.href}>
            <Link href={r.href} onClick={onNavigate} className="block rounded-2xl px-3 py-2.5 transition-colors hover:bg-bg-2">
              <span className="block text-sm font-medium text-fg">{r.label}</span>
              <span className="block text-[12.5px] text-muted">{r.body}</span>
            </Link>
          </li>
        ))}
      </ul>
      <Link href="/product-tour" onClick={onNavigate} className="group relative block min-h-[260px] overflow-hidden rounded-[18px] bg-ink">
        <Image src={shots.overview.src} alt="" fill sizes="300px" className="object-cover object-left-top transition-transform duration-700 ease-out-expo group-hover:scale-105" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-5 text-white">
          <p className="text-[15px] font-semibold">Take the product tour</p>
          <p className="mt-1 flex items-center gap-1.5 text-[13px] text-white/75">
            Real screens, real data <ArrowRight size={12} weight="bold" className="transition-transform duration-300 group-hover:translate-x-1" />
          </p>
        </div>
      </Link>
    </motion.div>
  );
}

export function Nav() {
  const pathname = usePathname();
  const { scrollY, scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 200, damping: 40, restDelta: 0.001 });
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState<MenuKey | null>(null);
  const [openedAt, setOpenedAt] = useState(pathname);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Close menus when the route changes.
  if ((open || menu) && openedAt !== pathname) {
    setOpen(false);
    setMenu(null);
  }

  // Boolean flip only; the scroll position itself never enters React state.
  useMotionValueEvent(scrollY, "change", (v) => {
    const next = v > 24;
    if (next !== scrolled) setScrolled(next);
  });

  const openMenu = (k: MenuKey) => {
    clearTimeout(closeTimer.current);
    setOpenedAt(pathname);
    setMenu(k);
  };
  const closeMenu = () => {
    closeTimer.current = setTimeout(() => setMenu(null), 140);
  };
  const isActive = (href: string, key?: MenuKey) =>
    key === "resources"
      ? resources.some((r) => pathname.startsWith(r.href))
      : key === "solutions"
        ? pathname.startsWith("/solutions") || pathname.startsWith("/industries")
        : pathname.startsWith(href);

  return (
    <header className="fixed inset-x-0 top-0 z-40 px-3 pt-3 sm:px-4 md:pt-4">
      <motion.div aria-hidden style={{ scaleX: progress }} className="fixed inset-x-0 top-0 h-[2px] origin-left bg-brand" />
      <nav
        aria-label="Main"
        onKeyDown={(e) => e.key === "Escape" && (setMenu(null), setOpen(false))}
        className={`nav-in relative mx-auto flex h-14 max-w-6xl items-center justify-between rounded-full pl-4 pr-2 transition-[background-color,border-color,box-shadow,backdrop-filter] duration-500 sm:pl-5 ${
          scrolled || open || menu ? "glass" : "border border-transparent"
        }`}
      >
        <Wordmark />

        <ul className="hidden items-center gap-0.5 lg:flex">
          {nav.map((item) => {
            const key = "menu" in item ? (item.menu as MenuKey) : undefined;
            const active = isActive(item.href, key);
            return (
              <li
                key={item.label}
                className={key ? "relative" : undefined}
                onPointerEnter={key ? () => openMenu(key) : undefined}
                onPointerLeave={key ? closeMenu : undefined}
                onFocus={key ? () => openMenu(key) : undefined}
                onBlur={
                  key
                    ? (e) => {
                        if (!e.currentTarget.contains(e.relatedTarget as Node)) closeMenu();
                      }
                    : undefined
                }
              >
                <Link
                  href={item.href}
                  aria-expanded={key ? menu === key : undefined}
                  aria-haspopup={key ? "true" : undefined}
                  className={`relative flex items-center gap-1 rounded-full px-4 py-2 text-sm transition-colors duration-200 ${active ? "text-fg" : "text-muted hover:text-fg"}`}
                >
                  {active && (
                    <motion.span layoutId="nav-active" className="absolute inset-0 -z-10 rounded-full bg-bg-2" transition={{ type: "spring", stiffness: 380, damping: 32 }} />
                  )}
                  {item.label}
                  {key && <CaretDown size={11} weight="bold" className={`transition-transform duration-300 ${menu === key ? "rotate-180" : ""}`} />}
                </Link>
                {key && (
                  <AnimatePresence>
                    {menu === key && key === "platform" && <PlatformMenu onNavigate={() => setMenu(null)} />}
                    {menu === key && key === "solutions" && <SolutionsMenu onNavigate={() => setMenu(null)} />}
                    {menu === key && key === "resources" && <ResourcesMenu onNavigate={() => setMenu(null)} />}
                  </AnimatePresence>
                )}
              </li>
            );
          })}
        </ul>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <div className="hidden sm:block">
            <Button href="/contact">{CTA.demo}</Button>
          </div>
          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => {
              setOpen((o) => !o);
              setOpenedAt(pathname);
            }}
            className="grid size-9 place-items-center rounded-full border border-line text-fg active:scale-[0.94] lg:hidden"
          >
            {open ? <X size={16} weight="bold" /> : <List size={16} weight="bold" />}
          </button>
        </div>
      </nav>

      <AnimatePresence>
        {open && <MobileMenu />}
      </AnimatePresence>
    </header>
  );
}

function MobileGroup({ title, children }: { title: string; children: React.ReactNode }) {
  const [o, setO] = useState(false);
  return (
    <li>
      <button type="button" onClick={() => setO(!o)} aria-expanded={o} className="flex w-full items-center justify-between rounded-xl px-4 py-3 text-lg font-medium text-fg hover:bg-bg-2">
        {title}
        <CaretDown size={14} weight="bold" className={`transition-transform duration-300 ${o ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence initial={false}>
        {o && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.35, ease: EASE }} className="overflow-hidden">
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

const subLink = "flex items-center gap-3 rounded-xl px-3 py-2 text-[15px] text-fg-2 hover:bg-bg-2";

function MobileMenu() {
  return (
    <motion.div
      initial={{ opacity: 0, y: -12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.98 }}
      transition={{ duration: 0.35, ease: EASE }}
      style={{ transformOrigin: "top center" }}
      className="mx-auto mt-2 max-h-[calc(100dvh-88px)] max-w-6xl overflow-y-auto rounded-[20px] border border-line bg-surface/[0.97] p-3 shadow-[var(--shadow)] backdrop-blur-xl lg:hidden"
    >
      <ul className="grid">
        <MobileGroup title="Platform">
          <ul className="mb-2 grid grid-cols-1 gap-0.5 pl-2 sm:grid-cols-2">
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
          <p className="px-5 pt-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted">By problem</p>
          <ul className="mb-2 grid grid-cols-1 gap-0.5 pl-2 sm:grid-cols-2">
            {solutionsList.map((s) => (
              <li key={s.slug}>
                <Link href={`/solutions/${s.slug}`} className={subLink}>
                  <SolutionIcon icon={s.icon} size={17} className="text-brand-ink" />
                  {s.name}
                </Link>
              </li>
            ))}
          </ul>
          <p className="px-5 pt-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted">By industry</p>
          <ul className="mb-2 grid grid-cols-1 gap-0.5 pl-2 sm:grid-cols-2">
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
          <ul className="mb-2 grid gap-0.5 pl-2">
            {resources.map((r) => (
              <li key={r.href}><Link href={r.href} className={subLink}>{r.label}</Link></li>
            ))}
          </ul>
        </MobileGroup>
        <li><Link href="/pricing" className="block rounded-xl px-4 py-3 text-lg font-medium text-fg hover:bg-bg-2">Pricing</Link></li>
        <li><Link href="/company" className="block rounded-xl px-4 py-3 text-lg font-medium text-fg hover:bg-bg-2">Company</Link></li>
        <li><Link href="/contact" className="block rounded-xl px-4 py-3 text-lg font-medium text-fg hover:bg-bg-2">Contact</Link></li>
      </ul>
      <div className="mt-2 border-t border-line p-2 pt-4 sm:hidden">
        <Button href="/contact" className="w-full justify-center">{CTA.demo}</Button>
      </div>
    </motion.div>
  );
}
