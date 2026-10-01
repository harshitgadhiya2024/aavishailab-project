"use client";

import { CaretDown, List, X } from "@phosphor-icons/react";
import { AnimatePresence, motion, useMotionValueEvent, useScroll, useSpring } from "motion/react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { CTA, nav, resources } from "@/lib/content";
import { Button } from "./button";
import { ThemeToggle } from "./theme-toggle";
import { Wordmark } from "./wordmark";

// Panels load on first hover/focus (see warmMenus), not with the page.
const loadMenus = () => import("./nav-menus");
const PlatformMenu = dynamic(() => loadMenus().then((m) => m.PlatformMenu), { ssr: false });
const SolutionsMenu = dynamic(() => loadMenus().then((m) => m.SolutionsMenu), { ssr: false });
const ResourcesMenu = dynamic(() => loadMenus().then((m) => m.ResourcesMenu), { ssr: false });
const MobileMenu = dynamic(() => loadMenus().then((m) => m.MobileMenu), { ssr: false });
type MenuKey = "platform" | "solutions" | "resources";

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
    void loadMenus();
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

