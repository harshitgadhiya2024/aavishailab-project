import type { ReactNode } from "react";

/*
 * Building blocks for the "Under the hood" pixel stories (see stories.tsx and
 * wg-story.tsx): the site's own pixel and dither language on a 200×200
 * canvas. Each story follows one item per cycle across three cells that read
 * the same clock, using these phases of the cycle (p, 0 → 1):
 *   0.00–0.30  cell 1 works on the item
 *   0.33–0.48  cell 1 hands it on (a packet leaves to the right)
 *   0.45–0.62  cell 2 receives it (a packet enters from the left)
 *   0.62–0.86  cell 2 gives its verdict
 *   0.80–0.95  cell 3 records the outcome
 */

export const W = "#fafafa";
export const B = "var(--brand)";
export const r = (n: number) => Math.round(n * 100) / 100; // identical numbers on server and client
export const frac = (n: number) => n - Math.floor(n);
export const clamp = (n: number) => Math.min(1, Math.max(0, n));
export const ease = (x: number) => 0.5 - Math.cos(clamp(x) * Math.PI) / 2;
export const span = (p: number, a: number, b: number) => clamp((p - a) / (b - a));

export const CYCLE = 4.8;

/** The item a story is on at time `t`, its index `n` and the cycle phase `p`. */
export function cycleOf<T>(items: T[], t: number) {
  const n = Math.floor(t / CYCLE);
  const len = items.length;
  return { n, p: frac(t / CYCLE), item: items[((n % len) + len) % len], nth: (k: number) => items[(((n - k) % len) + len) % len] };
}

export const Px = ({ x, y, s = 4, c = W, o = 1 }: { x: number; y: number; s?: number; c?: string; o?: number }) => (
  <rect x={r(x - s / 2)} y={r(y - s / 2)} width={s} height={s} fill={c} fillOpacity={r(clamp(o))} />
);

/** An item in transit: a small pixel cluster with a fading trail. */
export function Packet({ x, y, c = W, o = 1, dir = 1 }: { x: number; y: number; c?: string; o?: number; dir?: number }) {
  return (
    <g>
      {[0, 1, 2, 3].map((k) => <Px key={k} x={x - dir * (8 + k * 6)} y={y} s={3} c={c} o={o * (0.5 - k * 0.12)} />)}
      <Px x={x} y={y - 3} c={c} o={o} />
      <Px x={x} y={y + 3} c={c} o={o} />
      <Px x={x + dir * 5} y={y} c={c} o={o} />
    </g>
  );
}

export const Label = ({ x, y, children, c = W, o = 0.75, anchor = "middle" }: { x: number; y: number; children: ReactNode; c?: string; o?: number; anchor?: "start" | "middle" | "end" }) => (
  <text x={r(x)} y={r(y)} textAnchor={anchor} fill={c} fillOpacity={r(clamp(o))} style={{ font: "500 8.5px var(--font-mono), ui-monospace, monospace", letterSpacing: "0.04em" }}>
    {children}
  </text>
);

// A static scatter of faint pixels: the dither field from the site's hero.
const DITHER = Array.from({ length: 46 }, (_, i) => ({ x: 8 + ((i * 53) % 184), y: 8 + ((i * 97) % 184), o: 0.04 + ((i * 31) % 7) * 0.012 }));
export const Field = () => <>{DITHER.map((p, i) => <Px key={i} x={p.x} y={p.y} s={3} o={p.o} />)}</>;

/** A dashed guide line. */
export const Guide = ({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) => (
  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={W} strokeOpacity={0.08} strokeDasharray="2 4" />
);

/** Cell 1 → cell 2: the packet leaving on the right (phase 0.33–0.48). */
export function HandOff({ p, from = 128, y = 100, c = W }: { p: number; from?: number; y?: number; c?: string }) {
  const k = span(p, 0.33, 0.48);
  return k > 0 && k < 1 ? <Packet x={from + ease(k) * (204 - from)} y={y} c={c} /> : null;
}

/** Cell 2: the packet arriving from the left (phase 0.45–0.62), labelled. */
export function Arrive({ p, to, y = 100, label }: { p: number; to: number; y?: number; label?: string }) {
  const k = span(p, 0.45, 0.62);
  if (k <= 0 || p >= 0.62) return null;
  const x = ease(k) * to;
  return (
    <>
      <Packet x={x} y={y} />
      {label && <Label x={Math.max(40, x)} y={y - 14} o={0.85}>{label}</Label>}
    </>
  );
}

// Fixed burst directions for the dither dissolve.
const BURST = Array.from({ length: 18 }, (_, i) => ({ a: (i / 18) * Math.PI * 2 + (i % 3) * 0.2, d: 18 + (i % 5) * 9 }));

/** A blocked item bursting into orange dither pixels; k runs 0 → 1. */
export function Dissolve({ x, y, k }: { x: number; y: number; k: number }) {
  if (k <= 0 || k >= 1) return null;
  return <>{BURST.map((b, i) => <Px key={i} x={x + Math.cos(b.a) * b.d * ease(k)} y={y + Math.sin(b.a) * b.d * ease(k)} s={3.5} c={i % 4 === 0 ? W : B} o={1 - k} />)}</>;
}

/**
 * Cell 3's console: the newest outcome lands at the bottom (phase 0.80–0.95)
 * and pushes older ones up. `row(k)` describes the outcome k cycles ago.
 */
export function Console({ title, n, p, row }: { title: string; n: number; p: number; row: (k: number) => { text: string; tag: string; hot: boolean } }) {
  const arrive = span(p, 0.8, 0.95);
  const rows = 6;
  const gap = 20;
  return (
    <>
      <rect x={14} y={30} width={172} height={144} rx={6} fill="none" stroke={W} strokeOpacity={0.14} />
      <Label x={24} y={46} anchor="start" o={0.45}>{title}</Label>
      <line x1={14} y1={54} x2={186} y2={54} stroke={W} strokeOpacity={0.1} />
      {Array.from({ length: rows }, (_, k) => {
        const fresh = k === 0;
        const y = 158 - (k - 1 + arrive) * gap;
        const o = fresh ? arrive : Math.max(0, 1 - (k - 1 + arrive) / (rows - 1));
        if (y < 64 || o <= 0) return null;
        const d = row(k);
        const c = d.hot ? B : W;
        // Keep clear of the status tag on the right.
        const text = d.text.length > 17 ? `${d.text.slice(0, 16)}…` : d.text;
        return (
          <g key={n - k} opacity={r(o)}>
            {[0, 1, 2].map((q) => <Px key={q} x={26 + q * 5} y={y} s={3.5} c={c} o={fresh ? 1 : 0.7 - q * 0.15} />)}
            <Label x={44} y={y + 3} anchor="start" o={fresh ? 1 : 0.7}>{text}</Label>
            <Label x={178} y={y + 3} anchor="end" c={c} o={fresh ? 1 : 0.6}>{d.tag}</Label>
          </g>
        );
      })}
    </>
  );
}

/** A pixel outline of a rectangle, e.g. a device screen or a service box. */
export function PixelRect({ x, y, w, h, c = W, o = 0.8, s = 3 }: { x: number; y: number; w: number; h: number; c?: string; o?: number; s?: number }) {
  const out: ReactNode[] = [];
  for (let i = 0; i <= w; i += s * 2) {
    out.push(<Px key={`t${i}`} x={x + i} y={y} s={s} c={c} o={o} />, <Px key={`b${i}`} x={x + i} y={y + h} s={s} c={c} o={o} />);
  }
  for (let j = s * 2; j < h; j += s * 2) {
    out.push(<Px key={`l${j}`} x={x} y={y + j} s={s} c={c} o={o} />, <Px key={`r${j}`} x={x + w} y={y + j} s={s} c={c} o={o} />);
  }
  return <>{out}</>;
}
