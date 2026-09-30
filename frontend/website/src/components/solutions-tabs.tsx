"use client";

import { CheckCircle } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import { getModule, solutions } from "@/lib/content";

export function SolutionsTabs() {
  const [active, setActive] = useState(solutions[0].id);
  const s = solutions.find((x) => x.id === active)!;

  return (
    <div>
      <div role="tablist" aria-label="Solutions" className="flex gap-1 overflow-x-auto rounded-full border border-line bg-surface p-1 [scrollbar-width:none]">
        {solutions.map((x) => (
          <button
            key={x.id}
            role="tab"
            aria-selected={active === x.id}
            onClick={() => setActive(x.id)}
            className={`relative whitespace-nowrap rounded-full px-5 py-2.5 text-sm font-medium transition-colors ${active === x.id ? "text-invert-fg" : "text-muted hover:text-fg"}`}
          >
            {active === x.id && (
              <motion.span layoutId="sol-pill" className="absolute inset-0 -z-0 rounded-full bg-invert-bg" transition={{ type: "spring", stiffness: 380, damping: 32 }} />
            )}
            <span className="relative">{x.name}</span>
          </button>
        ))}
      </div>

      <div className="relative mt-8 min-h-[420px]">
        <AnimatePresence mode="wait">
          <motion.div
            key={s.id}
            role="tabpanel"
            initial={{ opacity: 0, y: 16, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -10, filter: "blur(4px)" }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            className="grid gap-6 lg:grid-cols-[1.3fr_1fr]"
          >
            <div className="rounded-[20px] border border-line bg-surface p-8 md:p-10">
              <h2 className="text-3xl font-semibold leading-[1.1] tracking-tight text-fg md:text-4xl">{s.headline}</h2>
              <p className="mt-5 max-w-[52ch] text-lg leading-relaxed text-muted">{s.body}</p>
              <ul className="mt-8 grid gap-3">
                {s.points.map((p, i) => (
                  <motion.li
                    key={p}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.15 + i * 0.07, duration: 0.4 }}
                    className="flex items-center gap-3 text-fg-2"
                  >
                    <CheckCircle size={20} weight="fill" className="text-fg" />
                    {p}
                  </motion.li>
                ))}
              </ul>
            </div>
            <div className="relative overflow-hidden ink-edge rounded-[20px] bg-ink p-8 text-ink-fg md:p-10">
              <div className="dot-field-ink absolute inset-0 opacity-70" aria-hidden />
              <p className="relative text-sm opacity-60">Built from</p>
              <ul className="relative mt-6 grid gap-3">
                {s.modules.map((slug, i) => {
                  const m = getModule(slug)!;
                  return (
                    <motion.li key={slug} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 + i * 0.08, duration: 0.45 }}>
                      <Link
                        href={`/platform/${slug}`}
                        className="flex items-center justify-between rounded-xl border border-ink-fg/15 px-4 py-3.5 transition-colors hover:bg-ink-fg/[0.06]"
                      >
                        <span className="font-medium">{m.name}</span>
                        <span className="text-sm opacity-60">View</span>
                      </Link>
                    </motion.li>
                  );
                })}
              </ul>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
