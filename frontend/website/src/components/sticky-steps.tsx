"use client";

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ChartLineUp, DownloadSimple, SlidersHorizontal } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";

const ICONS = { install: DownloadSimple, policy: SlidersHorizontal, observe: ChartLineUp };

gsap.registerPlugin(ScrollTrigger);

export type Step = { verb: string; icon: keyof typeof ICONS; title: string; body: string; detail: string[] };

/**
 * Real sticky stack: each card pins at the top and shrinks back as the next
 * one slides over it. GSAP lives only in this leaf; nothing else animates it.
 */
export function StickySteps({ steps }: { steps: Step[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference) and (min-width: 768px)", () => {
      const cards = gsap.utils.toArray<HTMLElement>(".step-card", el);
      cards.forEach((card, i) => {
        if (i === cards.length - 1) return;
        // Cards stay opaque (so the one beneath never shows through); a shade
        // layer dims the card as the next one slides over it.
        const st = { trigger: cards[i + 1], start: "top bottom", end: "top 120px", scrub: true };
        gsap.to(card.querySelector(".step-inner"), { scale: 0.92, ease: "none", scrollTrigger: st });
        gsap.to(card.querySelector(".step-shade"), { opacity: 0.7, ease: "none", scrollTrigger: st });
      });
    });
    return () => mm.revert();
  }, []);

  return (
    <div ref={ref} className="relative grid gap-6 md:gap-0">
      {steps.map((s, i) => (
        <div key={s.verb} className="step-card md:sticky md:top-[120px] md:h-[72vh] md:min-h-[520px] md:pb-8" style={{ zIndex: i }}>
          <div className="step-inner relative grid h-full origin-top gap-8 overflow-hidden rounded-[20px] border border-line bg-surface p-7 shadow-[var(--shadow)] md:grid-cols-[1.1fr_1fr] md:p-12">
            <div aria-hidden className="step-shade pointer-events-none absolute inset-0 z-10 bg-bg opacity-0" />
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
          </div>
        </div>
      ))}
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
