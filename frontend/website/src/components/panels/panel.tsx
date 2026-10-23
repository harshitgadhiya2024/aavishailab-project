"use client";

import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Logo } from "../wordmark";

/*
 * Product panels: composed renderings of console screens, used in place of
 * screenshots. One framed panel (header bar with the logo and a context
 * line), then inner cards with one big number each and a few labelled rows.
 * All names and numbers are fictional demo data.
 */

/** The outer frame: logo and context on top, inner cards below. */
export function Panel({ context, children, className = "" }: { context: string; children: React.ReactNode; className?: string }) {
  return (
    <div className="ui-panel w-full rounded-[12px] border border-line bg-bg-2 p-2 shadow-[0_40px_80px_-40px_rgb(120_50_0/0.4)]">
      <div className="flex items-center justify-between gap-4 px-3 pb-3 pt-2">
        <Logo className="text-[13px]" />
        <span className="truncate text-[12px] text-muted">{context}</span>
      </div>
      <div className={`grid gap-2 ${className}`}>{children}</div>
    </div>
  );
}

/** An inner card, with an optional title and right-hand meta line. */
export function PanelCard({ title, meta, children, className = "" }: { title?: string; meta?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 rounded-[8px] bg-surface p-5 shadow-[0_1px_2px_rgb(11_11_13/0.05)] sm:p-6 ${className}`}>
      {(title || meta) && (
        <div className="mb-3 flex items-baseline justify-between gap-3">
          {title && <span className="text-[13px] text-muted">{title}</span>}
          {meta && <span className="shrink-0 text-[12px] text-muted">{meta}</span>}
        </div>
      )}
      {children}
    </div>
  );
}

/** The headline number of a card. */
export function Big({ children, sub, className = "" }: { children: React.ReactNode; sub?: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <p className="font-display text-[2.2rem] leading-none tracking-[-0.035em] text-fg tabular-nums sm:text-[2.6rem]">{children}</p>
      {sub && <p className="mt-2 text-[12px] text-muted">{sub}</p>}
    </div>
  );
}

/** A label/value row. */
export function Row({ label, value, mono = false }: { label: React.ReactNode; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-[13.5px]">
      <span className={mono ? "font-mono text-[12px] text-fg" : "text-muted"}>{label}</span>
      <span className="text-right tabular-nums text-fg">{value}</span>
    </div>
  );
}

/** 0 → 1 over `ms` the first time the element scrolls into view (1 straight away with reduced motion). */
export function useProgress(ms = 1400) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.1 });
  const reduce = useReducedMotion();
  const [p, setP] = useState(0);
  useEffect(() => {
    if (!inView || reduce) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      // rAF timestamps can trail performance.now() slightly, so clamp at 0 too.
      const k = Math.min(1, Math.max(0, (now - start) / ms));
      setP(1 - Math.pow(1 - k, 3));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, reduce, ms]);
  return { ref, p: reduce ? 1 : p };
}

export const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

/** Policy action pill: Block, Alert or Allow. */
export function ActionPill({ action }: { action: "Block" | "Alert" | "Allow" }) {
  const cls = action === "Block" ? "bg-[#fdecea] text-danger" : action === "Alert" ? "bg-brand-soft text-brand-ink" : "bg-[#e8f5ec] text-[#1f7a3d]";
  return <span className={`ui-pill inline-flex rounded-[4px] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] ${cls}`}>{action}</span>;
}

/** A small on/off switch. */
// True inside card thumbnails, which sit in links: switches there are drawn, not clickable.
const StaticCtx = createContext(false);
export function StaticPanels({ children }: { children: React.ReactNode }) {
  return <StaticCtx.Provider value>{children}</StaticCtx.Provider>;
}

export function Toggle({ on }: { on: boolean }) {
  const still = useContext(StaticCtx);
  // Visitors can flip any switch to feel it; the demo keeps driving `on`,
  // and a click inverts whatever the demo currently shows.
  const [flipped, setFlipped] = useState(false);
  const value = flipped && !still ? !on : on;
  if (still) {
    return (
      <span className={`relative inline-block h-[18px] w-8 shrink-0 rounded-full transition-colors duration-300 ${value ? "bg-brand" : "bg-line-strong"}`}>
        <span className={`absolute top-[3px] size-3 rounded-full bg-white shadow transition-[left] duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${value ? "left-[17px]" : "left-[3px]"}`} />
      </span>
    );
  }
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label="Demo switch"
      onClick={() => setFlipped((f) => !f)}
      className={`group/t relative inline-block h-[18px] w-8 shrink-0 cursor-pointer rounded-full transition-[background-color,transform] duration-300 active:scale-90 ${value ? "bg-brand" : "bg-line-strong hover:bg-muted/40"}`}
    >
      <span
        className={`absolute top-[3px] size-3 rounded-full bg-white shadow transition-[left,width] duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-active/t:w-4 ${value ? "left-[17px] group-active/t:left-[13px]" : "left-[3px]"}`}
      />
    </button>
  );
}

/** A number that rolls up to its new value whenever it changes. */
export function Tick({ value }: { value: React.ReactNode }) {
  return (
    <span className="relative inline-flex overflow-hidden align-bottom">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={String(value)}
          initial={{ y: "70%", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: "-70%", opacity: 0 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="inline-block"
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
