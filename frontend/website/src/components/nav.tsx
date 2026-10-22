"use client";

import { CaretDown, List, X } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { CTA, nav, resources } from "@/lib/content";
import { GridButton } from "./landing/grid-button";
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
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState<MenuKey | null>(null);
  const [openedAt, setOpenedAt] = useState(pathname);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Close menus when the route changes.
  if ((open || menu) && openedAt !== pathname) {
    setOpen(false);
    setMenu(null);
  }

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
    // A flat bar pinned to the top, aligned to the page frame (.frame-w)
    // columns: solid background and a single hairline, no shadow or float.
    <header className="fixed inset-x-0 top-0 z-40 border-b border-line bg-bg">
      <nav
        aria-label="Main"
        onKeyDown={(e) => e.key === "Escape" && (setMenu(null), setOpen(false))}
        className="nav-in relative frame-w flex h-16 items-center justify-between gap-6 border-x border-line px-5 sm:px-8 md:px-12"
      >
        <Wordmark />

        <div className="flex items-center gap-1">
        <ul className="mr-3 hidden items-center gap-0.5 lg:flex">
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
                  className={`relative flex items-center gap-1 rounded-[6px] px-3.5 py-2 text-sm font-medium transition-colors duration-200 ${active ? "text-fg" : "text-fg-2 hover:text-fg"}`}
                >
                  {active && (
                    <motion.span layoutId="nav-active" className="absolute inset-0 -z-10 rounded-[6px] bg-bg-2" transition={{ type: "spring", stiffness: 380, damping: 32 }} />
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
          <div className="hidden sm:block">
            <GridButton href="/contact" className="h-10">{CTA.demo}</GridButton>
          </div>
          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => {
              setOpen((o) => !o);
              setOpenedAt(pathname);
            }}
            className="grid size-9 place-items-center rounded-[6px] border border-line text-fg active:scale-[0.94] lg:hidden"
          >
            {open ? <X size={16} weight="bold" /> : <List size={16} weight="bold" />}
          </button>
        </div>
        </div>
      </nav>

      <AnimatePresence>
        {open && <MobileMenu />}
      </AnimatePresence>
    </header>
  );
}

