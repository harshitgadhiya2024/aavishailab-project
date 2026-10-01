"use client";

import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import { useState } from "react";
import type { Shot } from "@/lib/shots";

export type ProductTab = { id: string; label: string; title: string; body: string; shot: Shot };

const EASE = [0.16, 1, 0.3, 1] as const;

/** Tab strip that swaps between real console screenshots. */
export function ProductTabs({ tabs }: { tabs: ProductTab[] }) {
  const [active, setActive] = useState(tabs[0].id);
  const t = tabs.find((x) => x.id === active)!;
  return (
    <div>
      <div role="tablist" aria-label="Console screens" className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-2 [scrollbar-width:none] md:mx-0 md:flex-wrap md:justify-center md:px-0">
        {tabs.map((x) => (
          <button
            key={x.id}
            role="tab"
            type="button"
            aria-selected={active === x.id}
            onClick={() => setActive(x.id)}
            className={`relative shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors ${active === x.id ? "text-on-brand" : "text-muted hover:text-fg"}`}
          >
            {active === x.id && <motion.span layoutId="ptab" className="absolute inset-0 rounded-full bg-brand" transition={{ type: "spring", stiffness: 380, damping: 32 }} />}
            <span className="relative">{x.label}</span>
          </button>
        ))}
      </div>
      <div className="mt-8 overflow-hidden rounded-[22px] border border-line bg-surface shadow-[var(--shadow)]">
        <div className="flex h-10 items-center gap-3 border-b border-line bg-bg-2 px-4" aria-hidden>
          <span className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-[#ff5f57]" />
            <span className="size-2.5 rounded-full bg-[#febc2e]" />
            <span className="size-2.5 rounded-full bg-[#28c840]" />
          </span>
          <span className="mx-auto hidden truncate rounded-md bg-surface px-3 py-0.5 font-mono text-[11px] text-muted sm:block">{t.shot.url}</span>
          <span className="w-10" />
        </div>
        <div className="skeleton relative overflow-hidden" style={{ aspectRatio: "16 / 10" }}>
          <AnimatePresence initial={false}>
            <motion.div key={t.id} initial={{ opacity: 0, scale: 1.02 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.5, ease: EASE }} className="absolute inset-0">
              <Image src={t.shot.src} alt={t.shot.alt} fill sizes="(max-width: 1200px) 100vw, 1150px" className="object-cover object-left-top" />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={t.id} role="tabpanel" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.35, ease: EASE }} className="mx-auto mt-8 max-w-2xl text-center">
          <h3 className="text-2xl font-semibold tracking-tight text-fg">{t.title}</h3>
          <p className="mt-3 leading-relaxed text-muted">{t.body}</p>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
