"use client";

import { useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

/*
 * Small line-art animations for the Early Access points, in the same style
 * as the "Under the hood" art: thin white lines, orange accents, no glow.
 *   0 direct line: two nodes, a message travelling back and forth,
 *   1 feedback:    roadmap bars, the orange one growing with each round,
 *   2 pilot:       a grid of devices, a few lighting up first, then the rest,
 *   3 real:        a small app window with content lines and a cursor.
 */

const W = "#fafafa";
const r2d = (n: number) => Math.round(n * 100) / 100;
const frac = (n: number) => n - Math.floor(n);
const ease = (x: number) => 0.5 - Math.cos(Math.min(1, Math.max(0, x)) * Math.PI) / 2;

function DirectLine({ t }: { t: number }) {
  const p = ease(Math.abs(frac(t * 0.35) * 2 - 1)); // 0 → 1 → 0
  const x = r2d(18 + p * 44);
  return (
    <>
      <line x1={18} y1={40} x2={62} y2={40} stroke={W} strokeOpacity={0.25} strokeWidth={1.2} strokeDasharray="2 3" />
      <circle cx={18} cy={40} r={7} fill="none" stroke={W} strokeOpacity={0.85} strokeWidth={1.4} />
      <rect x={55} y={33} width={14} height={14} rx={3} fill="none" stroke={W} strokeOpacity={0.85} strokeWidth={1.4} />
      <circle cx={x} cy={40} r={2.6} fill="var(--brand)" />
    </>
  );
}

const BARS = [22, 34, 16, 28];
function Feedback({ t }: { t: number }) {
  const grow = ease(frac(t * 0.3) * 1.25); // grows, then holds briefly
  return (
    <>
      {BARS.map((h, i) => {
        const height = i === 2 ? h + grow * 26 : h;
        return <rect key={i} x={14 + i * 14} y={r2d(60 - height)} width={8} height={r2d(height)} rx={1.5} fill={i === 2 ? "var(--brand)" : "none"} stroke={i === 2 ? "none" : W} strokeOpacity={0.6} strokeWidth={1.2} />;
      })}
      <line x1={10} y1={62} x2={70} y2={62} stroke={W} strokeOpacity={0.3} strokeWidth={1} />
    </>
  );
}

function Pilot({ t }: { t: number }) {
  const s = frac(t * 0.22);
  const pilot = [0, 4, 8];
  return (
    <>
      {Array.from({ length: 9 }, (_, i) => {
        const x = 20 + (i % 3) * 20;
        const y = 20 + Math.floor(i / 3) * 20;
        const isPilot = pilot.includes(i);
        const on = isPilot ? s > 0.08 : s > 0.4 + i * 0.04;
        return <rect key={i} x={x - 6} y={y - 5} width={12} height={10} rx={2} fill={on ? (isPilot ? "var(--brand)" : W) : "none"} fillOpacity={on && !isPilot ? 0.75 : 1} stroke={W} strokeOpacity={on ? 0 : 0.35} strokeWidth={1.2} />;
      })}
    </>
  );
}

function Real({ t }: { t: number }) {
  const blink = frac(t * 1.2) < 0.55;
  const fill = ease(frac(t * 0.25) * 1.3);
  return (
    <>
      <rect x={10} y={14} width={60} height={52} rx={4} fill="none" stroke={W} strokeOpacity={0.8} strokeWidth={1.4} />
      <line x1={10} y1={24} x2={70} y2={24} stroke={W} strokeOpacity={0.3} strokeWidth={1} />
      <circle cx={16} cy={19} r={1.4} fill="var(--brand)" />
      <line x1={18} y1={34} x2={r2d(18 + 34 * fill)} y2={34} stroke={W} strokeOpacity={0.7} strokeWidth={1.4} strokeLinecap="round" />
      <line x1={18} y1={43} x2={r2d(18 + 24 * fill)} y2={43} stroke={W} strokeOpacity={0.45} strokeWidth={1.4} strokeLinecap="round" />
      <line x1={18} y1={52} x2={r2d(18 + 40 * fill)} y2={52} stroke="var(--brand)" strokeOpacity={0.9} strokeWidth={1.4} strokeLinecap="round" />
      {blink && <line x1={r2d(20 + 40 * fill)} y1={48} x2={r2d(20 + 40 * fill)} y2={56} stroke={W} strokeWidth={1.2} />}
    </>
  );
}

const ART = [DirectLine, Feedback, Pilot, Real];

export function EarlyArt({ kind }: { kind: number }) {
  const ref = useRef<SVGSVGElement>(null);
  const inView = useInView(ref, { amount: 0.2 });
  const reduce = useReducedMotion();
  const active = inView && !reduce;
  const [t, setT] = useState(1 + kind * 0.7);

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      setT((v) => v + Math.min(0.05, Math.max(0, (now - last) / 1000)));
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  const Art = ART[kind % ART.length];
  return (
    <svg ref={ref} viewBox="0 0 80 80" className="size-full" aria-hidden>
      <Art t={t} />
    </svg>
  );
}
