"use client";

import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { Shot } from "@/lib/shots";
import { AgentTag } from "./visuals";

export type ConsoleScreen = { id: string; label: string; title: string; body: string; shot: Shot; callouts: [string, string] };

const EASE = [0.16, 1, 0.3, 1] as const;
const DWELL = 60; // ticks of 100ms per screen

/**
 * Real console screenshots with a numbered list beside them. The list
 * advances on its own (paused on hover or when off screen); each screen is
 * zoomed into its content area and carries two callouts.
 */
export function ConsoleShowcase({ screens }: { screens: ConsoleScreen[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.3 });
  const reduce = useReducedMotion();
  const [active, setActive] = useState(0);
  const [t, setT] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!inView || reduce || paused) return;
    const id = setInterval(() => {
      setT((v) => {
        if (v + 1 < DWELL) return v + 1;
        setActive((a) => (a + 1) % screens.length);
        return 0;
      });
    }, 100);
    return () => clearInterval(id);
  }, [inView, reduce, paused, screens.length]);

  const s = screens[active];
  const pick = (i: number) => {
    setActive(i);
    setT(0);
  };

  return (
    <div ref={ref} onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)} className="grid gap-6 lg:grid-cols-[300px_1fr] lg:gap-10">
      <div role="tablist" aria-label="Console screens" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] lg:mx-0 lg:grid lg:content-start lg:gap-0 lg:overflow-visible lg:px-0">
        {screens.map((x, i) => {
          const on = i === active;
          return (
            <button
              key={x.id}
              role="tab"
              type="button"
              aria-selected={on}
              onClick={() => pick(i)}
              className={`relative shrink-0 rounded-[6px] border px-3 py-2 text-left transition-colors lg:rounded-none lg:border-0 lg:border-b lg:border-line lg:px-0 lg:py-5 ${on ? "border-brand bg-surface lg:bg-transparent" : "border-line-strong/70 bg-surface/60 lg:bg-transparent"}`}
            >
              <span className="flex items-baseline gap-3">
                <span className={`hidden font-mono text-[11px] lg:inline ${on ? "text-brand-ink" : "text-muted"}`}>{String(i + 1).padStart(2, "0")}</span>
                <span className={`text-sm lg:text-[17px] lg:tracking-[-0.01em] ${on ? "text-fg" : "text-muted hover:text-fg"}`}>{x.label}</span>
              </span>
              <AnimatePresence initial={false}>
                {on && (
                  <motion.span
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.4, ease: EASE }}
                    className="hidden overflow-hidden lg:block"
                  >
                    <span className="block pl-[30px] pt-2 text-[13.5px] leading-relaxed text-muted">{x.body}</span>
                  </motion.span>
                )}
              </AnimatePresence>
              {on && !reduce && <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-brand lg:-bottom-px" style={{ transform: `scaleX(${t / DWELL})` }} />}
            </button>
          );
        })}
      </div>

      <div className="relative">
        <figure className="overflow-hidden rounded-[8px] border border-line-strong/70 bg-surface shadow-[0_30px_70px_-35px_rgb(120_50_0/0.45)]">
          <div className="flex h-9 items-center gap-3 border-b border-line bg-bg-2 px-3.5" aria-hidden>
            <span className="flex gap-1.5">
              <span className="size-2.5 rounded-full bg-[#ff5f57]" />
              <span className="size-2.5 rounded-full bg-[#febc2e]" />
              <span className="size-2.5 rounded-full bg-[#28c840]" />
            </span>
            <span className="mx-auto hidden max-w-[60%] truncate rounded-[4px] bg-surface px-3 py-0.5 font-mono text-[11px] text-muted sm:block">{s.shot.url}</span>
            <span className="w-10" />
          </div>
          <div className="skeleton relative overflow-hidden" style={{ aspectRatio: `${s.shot.w * 0.83} / ${s.shot.h}` }}>
            <AnimatePresence initial={false}>
              <motion.div
                key={s.id}
                initial={{ opacity: 0, scale: 1.03 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.6, ease: EASE }}
                className="absolute inset-0"
              >
                {/* The screen minus its sidebar strip, at true scale: full height, pinned right. */}
                <Image
                  src={s.shot.src}
                  alt={s.shot.alt}
                  width={s.shot.w}
                  height={s.shot.h}
                  sizes="(max-width: 1024px) 120vw, 1040px"
                  className="absolute right-0 top-0 h-full max-w-none"
                  style={{ width: `${100 / 0.83}%` }}
                />
              </motion.div>
            </AnimatePresence>
          </div>
          <figcaption className="sr-only">{s.title}</figcaption>
        </figure>
        <AnimatePresence mode="wait">
          <motion.div key={s.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="hidden sm:block">
            <AgentTag className="-top-4 right-[8%]">{s.callouts[0]}</AgentTag>
            <AgentTag tone="ink" className="-bottom-5 left-[6%]">{s.callouts[1]}</AgentTag>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
