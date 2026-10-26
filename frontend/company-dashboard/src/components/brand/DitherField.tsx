"use client";

import { useEffect, useRef } from "react";

/**
 * The website's signature visual (copied from aavishield.com, landing/dither-field.tsx): a terrain drawn from square pixels
 * with ordered (Bayer) dithering, in the brand's orange ramp. Light areas
 * break into a fine dot grid, dense areas into solid blocks.
 *
 * Drawn on a canvas so thousands of cells cost one paint; redrawn when the
 * box resizes. The terrain is seeded noise, so it is the same on every load.
 */

// Lightest to deepest. Index 0 is never drawn (white paper).
const RAMP = ["", "#ffe7d4", "#ffc9a0", "#ffa461", "#ff8526", "#ff7000", "#e05f00"];
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

function hash(x: number, y: number, seed: number) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function noise(x: number, y: number, seed: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const s = (t: number) => t * t * (3 - 2 * t);
  const u = s(x - xi);
  const v = s(y - yi);
  const a = hash(xi, yi, seed);
  const b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed);
  const d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, y: number, seed = 3) {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < 5; i++) {
    sum += amp * noise(x * f, y * f, seed + i);
    f *= 2;
    amp *= 0.5;
  }
  return sum;
}

const clamp = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (t: number) => t * t * (3 - 2 * t);

type Variant = "hero" | "band";

/** Sharp-crested noise: peaks where plain noise crosses its midpoint. */
function ridged(x: number, seed: number) {
  let sum = 0;
  let amp = 0.6;
  let f = 1;
  for (let i = 0; i < 4; i++) {
    sum += amp * (1 - Math.abs(2 * noise(x * f, 0.5, seed + i) - 1));
    f *= 2.1;
    amp *= 0.45;
  }
  return sum;
}

/** Height of the ridge line (0 = top of the box, 1 = bottom) at x in 0..1. */
function ridge(x: number, variant: Variant) {
  const peaks = ridged(x * 2.6, 11) - 0.55;
  const fine = fbm(x * 16, 2.5, 17) - 0.5;
  if (variant === "hero") return 1 - (0.06 + 0.78 * Math.pow(x, 1.15) + 0.34 * peaks + 0.05 * fine);
  return 1 - (0.22 + 0.22 * smooth(x) + 0.22 * peaks + 0.04 * fine);
}

function draw(canvas: HTMLCanvasElement, variant: Variant, cell: number) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const { width, height } = canvas.getBoundingClientRect();
  if (!width || !height) return;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const top = variant === "hero" ? 1 : 0.62;
  const levels = RAMP.length - 1;

  for (let c = 0; c < cols; c++) {
    const x = c / cols;
    const r0 = ridge(x, variant);
    for (let r = 0; r < rows; r++) {
      const y = r / rows;
      const grain = fbm(x * 7, y * 7, 5) - 0.5;
      let v: number;
      if (y >= r0) {
        // Rock: diagonal gullies run down from the crest, faces deepen
        // toward the right, and a lit edge traces the ridge line.
        const depth = y - r0;
        const gully = fbm(x * 5 + depth * 3.2, depth * 7, 23) - 0.5;
        v = 0.12 + x * 0.55 + gully * 1.1 + grain * 0.35 - depth * 0.3 + (depth < 0.018 ? 0.2 : 0);
      } else {
        // Sky: a thin haze hugging the ridge, fading upward.
        const d = r0 - y;
        v = clamp(0.32 - d * 2.4 + grain * 0.5) * 0.7;
      }
      v = clamp(v) * top;
      const t = (BAYER[r % 4][c % 4] + 0.5) / 16;
      const scaled = v * levels;
      const lo = Math.floor(scaled);
      const level = Math.min(levels, lo + (scaled - lo > t ? 1 : 0));
      if (level === 0) continue;
      // Light levels draw as small dots, dense levels as near-full blocks.
      const size = level === 1 ? cell * 0.34 : level === 2 ? cell * 0.58 : cell - 1;
      const off = (cell - size) / 2;
      ctx.fillStyle = RAMP[level];
      ctx.fillRect(c * cell + off, r * cell + off, size, size);
    }
  }
}

export function DitherField({ variant = "hero", cell = 7, className = "" }: { variant?: Variant; cell?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let frame = 0;
    const redraw = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        draw(canvas, variant, cell);
        // Start the wipe-in only once there is something to reveal.
        canvas.dataset.ready = "";
      });
    };
    redraw();
    const ro = new ResizeObserver(redraw);
    ro.observe(canvas);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [variant, cell]);

  return <canvas ref={ref} aria-hidden className={`dither-reveal block h-full w-full ${className}`} />;
}
