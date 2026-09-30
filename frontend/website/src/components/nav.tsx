"use client";

import { ArrowRight, CaretDown, List, X } from "@phosphor-icons/react";
import { AnimatePresence, motion, useMotionValueEvent, useScroll, useSpring } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { CTA, moduleExtras, modules, nav } from "@/lib/content";
import { Button } from "./button";
import { ModuleIcon } from "./icons";
import { ThemeToggle } from "./theme-toggle";
import { Wordmark } from "./wordmark";

const EASE = [0.16, 1, 0.3, 1] as const;

function PlatformMenu({ onNavigate }: { onNavigate: () => void }) {
  const [hover, setHover] = useState(modules[0].slug);
  const extra = moduleExtras[hover];
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.98, transition: { duration: 0.15 } }}
      transition={{ duration: 0.3, ease: EASE }}
      style={{ transformOrigin: "top center" }}
      className="absolute left-1/2 top-full mt-3 grid w-[760px] border border-line bg-surface/[0.97] shadow-[var(--shadow)] backdrop-blur-xl -translate-x-1/2 grid-cols-[1.35fr_1fr] gap-3 rounded-[24px] p-3"
    >
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
            <Image src={extra.image} alt="" fill sizes="300px" className="object-cover transition-transform duration-700 ease-out-expo group-hover:scale-105" />
          </motion.div>
        </AnimatePresence>
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-5 text-white">
          <p className="text-[15px] font-semibold">{modules.find((m) => m.slug === hover)!.name}</p>
          <p className="mt-1 flex items-center gap-1.5 text-[13px] text-white/75">
            Explore feature <ArrowRight size={12} weight="bold" className="transition-transform duration-300 group-hover:translate-x-1" />
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
  const [mega, setMega] = useState(false);
  const [openedAt, setOpenedAt] = useState(pathname);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Close menus when the route changes.
  if ((open || mega) && openedAt !== pathname) {
    setOpen(false);
    setMega(false);
  }

  // Boolean flip only; the scroll position itself never enters React state.
  useMotionValueEvent(scrollY, "change", (v) => {
    const next = v > 24;
    if (next !== scrolled) setScrolled(next);
  });

  const openMega = () => {
    clearTimeout(closeTimer.current);
    setOpenedAt(pathname);
    setMega(true);
  };
  const closeMega = () => {
    closeTimer.current = setTimeout(() => setMega(false), 140);
  };

  return (
    <header className="fixed inset-x-0 top-0 z-40 px-3 pt-3 sm:px-4 md:pt-4">
      <motion.div aria-hidden style={{ scaleX: progress }} className="fixed inset-x-0 top-0 h-[2px] origin-left bg-brand" />
      <nav
        aria-label="Main"
        onKeyDown={(e) => e.key === "Escape" && (setMega(false), setOpen(false))}
        className={`nav-in relative mx-auto flex h-14 max-w-6xl items-center justify-between rounded-full pl-4 pr-2 transition-[background-color,border-color,box-shadow,backdrop-filter] duration-500 sm:pl-5 ${
          scrolled || open || mega ? "glass" : "border border-transparent"
        }`}
      >
        <Wordmark />

        <ul className="hidden items-center gap-1 lg:flex">
          {nav.map((item) => {
            const active = pathname.startsWith(item.href);
            const isPlatform = item.href === "/platform";
            return (
              <li
                key={item.href}
                className={isPlatform ? "relative" : undefined}
                onPointerEnter={isPlatform ? openMega : undefined}
                onPointerLeave={isPlatform ? closeMega : undefined}
                onFocus={isPlatform ? openMega : undefined}
                onBlur={
                  isPlatform
                    ? (e) => {
                        if (!e.currentTarget.contains(e.relatedTarget as Node)) closeMega();
                      }
                    : undefined
                }
              >
                <Link
                  href={item.href}
                  aria-expanded={isPlatform ? mega : undefined}
                  aria-haspopup={isPlatform ? "true" : undefined}
                  className={`relative flex items-center gap-1 rounded-full px-4 py-2 text-sm transition-colors duration-200 ${active ? "text-fg" : "text-muted hover:text-fg"}`}
                >
                  {active && (
                    <motion.span layoutId="nav-active" className="absolute inset-0 -z-10 rounded-full bg-bg-2" transition={{ type: "spring", stiffness: 380, damping: 32 }} />
                  )}
                  {item.label}
                  {isPlatform && <CaretDown size={11} weight="bold" className={`transition-transform duration-300 ${mega ? "rotate-180" : ""}`} />}
                </Link>
                {isPlatform && (
                  <AnimatePresence>{mega && <PlatformMenu onNavigate={() => setMega(false)} />}</AnimatePresence>
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
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.35, ease: EASE }}
            style={{ transformOrigin: "top center" }}
            className="mx-auto mt-2 max-h-[calc(100dvh-88px)] border border-line bg-surface/[0.97] shadow-[var(--shadow)] backdrop-blur-xl max-w-6xl overflow-y-auto rounded-[20px] p-3 lg:hidden"
          >
            <ul className="grid">
              {nav.map((item, i) => (
                <motion.li key={item.href} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.04 * i, duration: 0.4, ease: EASE }}>
                  <Link href={item.href} className="block rounded-xl px-4 py-3 text-lg font-medium text-fg hover:bg-bg-2">
                    {item.label}
                  </Link>
                  {item.href === "/platform" && (
                    <ul className="mb-2 grid grid-cols-1 gap-0.5 pl-2 sm:grid-cols-2">
                      {modules.map((m) => (
                        <li key={m.slug}>
                          <Link href={`/platform/${m.slug}`} className="flex items-center gap-3 rounded-xl px-3 py-2 text-[15px] text-fg-2 hover:bg-bg-2">
                            <ModuleIcon icon={m.icon} size={17} className="text-brand-ink" />
                            {m.name}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </motion.li>
              ))}
            </ul>
            <div className="mt-2 border-t border-line p-2 pt-4 sm:hidden">
              <Button href="/contact" className="w-full justify-center">
                {CTA.demo}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
