"use client";

import { ChartLineUp, DownloadSimple, SlidersHorizontal } from "@phosphor-icons/react/dist/ssr";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useEffect, useRef, useState, type RefObject } from "react";

const ICONS = { install: DownloadSimple, policy: SlidersHorizontal, observe: ChartLineUp };

export type Step = { verb: string; icon: keyof typeof ICONS; title: string; body: string; detail: string[] };

/** True at the md breakpoint and up, where the cards are sticky. */
function useDesktop() {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const update = () => setDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return desktop;
}

/**
 * Real sticky stack: each card pins at the top and shrinks back as the next
 * one slides over it. Driven by Motion's scroll progress (already on the page
 * for every other animation) rather than a second animation library.
 */
export function StickySteps({ steps }: { steps: Step[] }) {
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const desktop = useDesktop();
  const reduce = useReducedMotion();
  const animate = desktop && !reduce;
  return (
    <div className="relative grid gap-6 md:gap-0">
      {steps.map((s, i) => (
        <StepCard
          key={s.verb}
          step={s}
          index={i}
          cardRef={(el) => {
            refs.current[i] = el;
          }}
          nextRef={refs}
          animate={animate && i < steps.length - 1}
        />
      ))}
    </div>
  );
}

function StepCard({
  step: s,
  index,
  cardRef,
  nextRef,
  animate,
}: {
  step: Step;
  index: number;
  cardRef: (el: HTMLDivElement | null) => void;
  nextRef: RefObject<(HTMLDivElement | null)[]>;
  animate: boolean;
}) {
  // Progress runs from the next card's top entering the viewport (0) to it
  // reaching this card's pinned position (1).
  const target = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    target.current = nextRef.current?.[index + 1] ?? null;
  });
  const { scrollYProgress } = useScroll({ target, offset: ["start end", "start 120px"] });
  const scale = useTransform(scrollYProgress, [0, 1], [1, 0.92]);
  const shade = useTransform(scrollYProgress, [0, 1], [0, 0.7]);

  return (
    <div ref={cardRef} className="md:sticky md:top-[120px] md:h-[72vh] md:min-h-[520px] md:pb-8" style={{ zIndex: index }}>
      <motion.div
        style={animate ? { scale } : undefined}
        className="relative grid h-full origin-top gap-8 overflow-hidden rounded-[20px] border border-line bg-surface p-7 shadow-[var(--shadow)] md:grid-cols-[1.1fr_1fr] md:p-12"
      >
        {/* Cards stay opaque; this shade dims one as the next slides over it. */}
        <motion.div aria-hidden style={animate ? { opacity: shade } : { opacity: 0 }} className="pointer-events-none absolute inset-0 z-10 bg-bg" />
        <div className="flex flex-col justify-between gap-10">
          <span className="font-mono text-sm text-brand-ink">{s.verb}</span>
          <div>
            <h3 className="text-3xl font-semibold leading-[1.05] tracking-tight text-fg md:text-5xl">{s.title}</h3>
            <p className="mt-5 max-w-[46ch] text-base leading-relaxed text-muted md:text-lg">{s.body}</p>
          </div>
        </div>
        <div className="relative flex min-h-[320px] flex-col justify-end ink-edge overflow-hidden rounded-2xl bg-ink p-6 text-ink-fg md:p-8">
          <div className="dot-field-ink absolute inset-0 opacity-70" />
          <StepVisual icon={s.icon} />
          <ul className="relative grid gap-3 font-mono text-[13px]">
            {s.detail.map((d) => (
              <li key={d} className="flex items-start gap-3">
                <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-brand" />
                <span className="opacity-90">{d}</span>
              </li>
            ))}
          </ul>
        </div>
      </motion.div>
    </div>
  );
}

function StepVisual({ icon }: { icon: Step["icon"] }) {
  const I = ICONS[icon];
  return (
    <div className="absolute inset-x-0 top-0 grid h-[62%] place-items-center" aria-hidden>
      <div className="relative grid size-28 place-items-center">
        <span className="absolute inset-0 animate-pulse-ring rounded-full border-2 border-brand/60" />
        <span className="absolute inset-0 animate-pulse-ring rounded-full border border-brand/40 [animation-delay:1.2s]" />
        <span className="absolute -inset-10 rounded-full border border-dashed border-ink-fg/15" />
        <span className="absolute -inset-20 rounded-full border border-ink-fg/[0.07]" />
        <span className="relative grid size-24 place-items-center rounded-full bg-brand text-on-brand shadow-[0_20px_60px_-10px_rgb(255_112_0/0.6)]">
          <I size={40} weight="light" />
        </span>
      </div>
    </div>
  );
}
