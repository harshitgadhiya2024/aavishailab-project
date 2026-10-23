"use client";

import { useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ModuleSlug } from "@/lib/content";
import { STORIES } from "./stories";
import { wgDecide, wgIntercept, wgRecord } from "./wg-story";

/*
 * The animation in each "Under the hood" cell: three pixel scenes per
 * control that follow one item across the band (Web Gateway in
 * wg-story.tsx, the other six in stories.tsx). Other bands borrow these by
 * control and step. They run continuously while on screen and hold still
 * with reduced motion.
 */

type Scene = (t: number) => ReactNode;

const ART: Record<ModuleSlug, readonly [Scene, Scene, Scene]> = {
  "web-gateway": [wgIntercept, wgDecide, wgRecord],
  ...STORIES,
};

// The still frame used before the clock starts and with reduced motion.
const START = 3.4;

export function StepArt({ slug, kind }: { slug: ModuleSlug; kind: number }) {
  const ref = useRef<SVGSVGElement>(null);
  const inView = useInView(ref, { amount: 0.2 });
  const reduce = useReducedMotion();
  const active = inView && !reduce;
  const [t, setT] = useState(START);

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    // Every cell reads the same page clock, so a story that runs across a
    // band (one item from the first cell to the last) stays in step.
    const tick = (now: number) => {
      setT(START + now / 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  const draw = (ART[slug] ?? ART["web-gateway"])[kind % 3];
  return (
    <svg ref={ref} viewBox="0 0 200 200" className="size-full" aria-hidden>
      {draw(t)}
    </svg>
  );
}
