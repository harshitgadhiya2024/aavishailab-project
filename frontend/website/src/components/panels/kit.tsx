"use client";

import { TrendDown, TrendUp } from "@phosphor-icons/react";
import { useId, useState } from "react";
import { StatePill, useTimeline, type EventState } from "../landing/visuals";
import { Big, Panel, PanelCard, Tick, fmt, useProgress } from "./panel";

/*
 * Two reusable panel layouts, filled with data per screen:
 * StatChartPanel (numbers on the left, a trend chart on the right) and
 * FeedPanel (a headline number over a list of events that fade in live).
 */

function path(values: number[], w: number, h: number, max: number) {
  return values.map((v, i) => `${i === 0 ? "M" : "L"}${((i / (values.length - 1)) * w).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`).join(" ");
}

/**
 * A line chart that draws in from the left as `p` goes 0 → 1. Hovering
 * shows a crosshair on the nearest point with its value(s).
 */
export function LineChart({ main, second, labels, p, height = 170, auto = null }: { main: number[]; second?: number[]; labels: string[]; p: number; height?: number; /** A point to highlight on its own when the pointer is not over the chart. */ auto?: number | null }) {
  const id = useId().replace(/:/g, "");
  const [pointer, setHover] = useState<number | null>(null);
  const hover = pointer ?? auto;
  const W = 420;
  const H = height;
  const max = Math.max(...main, ...(second ?? [])) * 1.15;
  const d = path(main, W, H, max);
  const last = main.length - 1;
  const xAt = (i: number) => (i / last) * W;
  const yAt = (v: number) => H - (v / max) * H;
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * (W + 12) - 6;
    setHover(Math.max(0, Math.min(last, Math.round((x / W) * last))));
  };
  const tipW = second ? 92 : 64;
  return (
    <div className="w-full">
    <svg viewBox={`-6 -10 ${W + 12} ${H + 16}`} className="w-full cursor-crosshair overflow-visible" aria-hidden onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
      <defs>
        <pattern id={`h${id}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="var(--brand)" strokeOpacity="0.16" strokeWidth="2" />
        </pattern>
        <clipPath id={`c${id}`}>
          <rect x="-6" y="-10" height={H + 20} width={(W + 12) * p} />
        </clipPath>
      </defs>
      <line x1="0" x2={W} y1={H} y2={H} stroke="var(--line-strong)" strokeWidth="1" />
      <g clipPath={`url(#c${id})`}>
        <path d={`${d} L${W},${H} L0,${H} Z`} fill={`url(#h${id})`} />
        {second && <path d={path(second, W, H, max)} fill="none" stroke="var(--muted)" strokeOpacity="0.7" strokeWidth="1.5" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />}
        <path d={d} fill="none" stroke="var(--brand)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        <circle cx={W} cy={yAt(main[last])} r="4.5" fill="var(--brand)" stroke="var(--surface)" strokeWidth="2" className={`transition-opacity duration-200 ${hover !== null && hover !== last ? "opacity-30" : ""}`} />
      </g>
      {hover !== null && p > 0.98 && (
        <g className="pointer-events-none" style={{ transform: `translateX(${xAt(hover)}px)`, transition: "transform .25s cubic-bezier(.16,1,.3,1)" }}>
          <line x1="0" x2="0" y1="-4" y2={H} stroke="var(--fg)" strokeOpacity="0.25" strokeDasharray="2 3" />
          {second && <circle cx="0" cy={yAt(second[hover])} r="3.5" fill="var(--surface)" stroke="var(--muted)" strokeWidth="1.5" />}
          <circle cx="0" cy={yAt(main[hover])} r="5" fill="var(--brand)" stroke="var(--surface)" strokeWidth="2" />
          <g transform={`translate(${hover > last / 2 ? -tipW - 10 : 10}, ${Math.max(-6, yAt(main[hover]) - 34)})`}>
            <rect width={tipW} height="26" rx="5" fill="var(--fg)" />
            <text x="9" y="17" className="fill-[var(--bg)] font-mono text-[11px]">
              {fmt(main[hover])}
              {second && <tspan className="fill-[var(--bg)] opacity-60"> / {fmt(second[hover])}</tspan>}
            </text>
          </g>
        </g>
      )}
    </svg>
    {/* Axis labels are HTML so they stay 10px however wide the chart is drawn. */}
    <div className="mt-1 flex justify-between font-mono text-[10px] text-muted">
      {labels.map((l, i) => (
        <span key={l + i} className={`w-0 whitespace-nowrap text-center transition-colors duration-200 [&:first-child]:text-left [&:last-child]:text-right ${hover === i ? "text-fg" : ""}`}>
          <span className={i === 0 ? "" : i === labels.length - 1 ? "inline-block -translate-x-full" : "inline-block -translate-x-1/2"}>{l}</span>
        </span>
      ))}
    </div>
    </div>
  );
}

export type StatChartData = {
  context: string;
  left: {
    label: string;
    big: number;
    suffix?: string;
    split?: [{ label: string; value: number; suffix?: string }, { label: string; value: number; suffix?: string }];
    rows?: { label: string; value: string }[];
    foot?: { left: React.ReactNode; right: string };
  };
  right: {
    label: string;
    big: number;
    suffix?: string;
    trend?: { text: string; down: boolean; good: boolean };
    main: number[];
    second?: number[];
    labels: string[];
    legend: [string, string?];
  };
};

/** Numbers on the left, the trend on the right: the overview of a control. */
export function StatChartPanel({ data }: { data: StatChartData }) {
  const { ref, p } = useProgress(1600);
  const { left: l, right: r } = data;
  const Trend = r.trend?.down ? TrendDown : TrendUp;
  return (
    <div ref={ref} className="w-full">
      <Panel context={data.context} className="md:grid-cols-[0.85fr_1.15fr]">
        <PanelCard className="flex flex-col">
          <p className="text-[13px] text-muted">{l.label}</p>
          <Big className="mt-2">
            {fmt(l.big * p)}
            {l.suffix && <span className="text-muted">{l.suffix}</span>}
          </Big>
          {l.split && (
            <div className="mt-6 grid grid-cols-2 border-y border-line py-4">
              {l.split.map((s, i) => (
                <div key={s.label} className={i === 0 ? "border-r border-line pr-4" : "pl-5"}>
                  <p className="text-[12.5px] text-muted">{s.label}</p>
                  <p className="mt-1.5 font-display text-[1.5rem] leading-none tracking-[-0.02em] text-fg tabular-nums">
                    {fmt(s.value * p)}
                    {s.suffix}
                  </p>
                </div>
              ))}
            </div>
          )}
          {l.rows && (
            <ul className="mt-4 grid gap-1">
              {l.rows.map((row) => (
                <li key={row.label} className="flex items-center justify-between gap-3 py-1 text-[13px]">
                  <span className="truncate font-mono text-[12px] text-fg">{row.label}</span>
                  <span className="shrink-0 tabular-nums text-muted">{row.value}</span>
                </li>
              ))}
            </ul>
          )}
          {l.foot && (
            <div className="mt-auto flex items-center justify-between gap-3 border-t border-line pt-4 text-[13px]">
              <span className="flex items-center gap-1.5 text-fg">{l.foot.left}</span>
              <span className="text-muted">{l.foot.right}</span>
            </div>
          )}
        </PanelCard>

        <PanelCard className="flex flex-col">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[13px] text-muted">{r.label}</p>
              <Big className="mt-2">
                {fmt(r.big * p)}
                {r.suffix && <span className="text-muted">{r.suffix}</span>}
              </Big>
            </div>
            {r.trend && (
              <div className="text-right">
                <p className="text-[13px] text-muted">Trend</p>
                <p className={`mt-2 flex items-center justify-end gap-1 font-display text-[1.5rem] leading-none tracking-[-0.02em] ${r.trend.good ? "text-[#1f7a3d]" : "text-danger"}`}>
                  <Trend size={18} weight="bold" /> {r.trend.text}
                </p>
              </div>
            )}
          </div>
          <div className="mt-auto pt-6">
            <LineChart main={r.main} second={r.second} labels={r.labels} p={p} />
          </div>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-[12.5px] text-muted">
            <span className="flex items-center gap-2"><span className="h-0.5 w-4 rounded-full bg-brand" /> {r.legend[0]}</span>
            {r.legend[1] && <span className="flex items-center gap-2"><span className="w-4 border-t border-dashed border-muted" /> {r.legend[1]}</span>}
          </div>
        </PanelCard>
      </Panel>
    </div>
  );
}

export type FeedRow = { title: string; sub: string; state?: EventState; right?: string };

/**
 * A headline number over a list of rows that fade in one by one; the count
 * climbs as they land. Every row is in the layout from the start so the
 * orange stage around the panel does not grow when a row appears.
 */
export function FeedPanel({ context, label, base, aside, rows, unit }: { context: string; label: string; base: number; aside?: string; rows: FeedRow[]; unit?: string }) {
  const STEP = 8;
  const { ref, t } = useTimeline(8 + rows.length * STEP + 30, 8 + rows.length * STEP + 29);
  // Two rows are there from the start so the panel never looks empty; the rest arrive live.
  const shown = rows.filter((_, i) => i < 2 || t >= 4 + (i - 2) * STEP).length;
  return (
    <div ref={ref} className="w-full">
      <Panel context={context}>
        <PanelCard>
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[13px] text-muted">{label}</p>
              <Big className="mt-2">
                <Tick value={fmt(base + shown - 2)} />
                {unit && <span className="text-muted">{unit}</span>}
              </Big>
            </div>
            {aside && <p className="max-w-[20ch] text-right text-[12.5px] text-muted">{aside}</p>}
          </div>
          <ul className="mt-5 border-t border-line">
            {rows.map((r, i) => (
              <li
                key={r.title + r.sub}
                className={`flex items-center gap-4 border-b border-line py-3 last:border-b-0 transition-opacity duration-500 ${i < shown ? "opacity-100" : "opacity-0"}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] text-fg">{r.title}</span>
                  <span className="mt-0.5 block truncate text-[12px] text-muted">{r.sub}</span>
                </span>
                {r.right && <span className="shrink-0 font-mono text-[12px] tabular-nums text-fg">{r.right}</span>}
                {r.state && <StatePill state={r.state} />}
              </li>
            ))}
          </ul>
        </PanelCard>
      </Panel>
    </div>
  );
}
