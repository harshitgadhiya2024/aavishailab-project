"use client";

import { LockSimple, MagnifyingGlass, TrendDown } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { POP, StatePill, useTimeline } from "../landing/visuals";
import { LineChart } from "./kit";
import { ActionPill, Big, Panel, PanelCard, Row, Tick, Toggle, fmt, useProgress } from "./panel";

/* Demo week for a 40-device company. Blocked days add up to the 1,284 shown. */
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const BLOCKED = [210, 190, 232, 176, 198, 160, 118];
const ALERTED = [62, 58, 71, 49, 55, 47, 30];
const TOP = [
  { c: "Social media", n: 512 },
  { c: "Gambling", n: 214 },
  { c: "AI tools", n: 188 },
];

/** The overview: a week of requests, what was blocked, and the trend. */
export function WebGatewayOverview() {
  const { ref, p } = useProgress(1600);
  return (
    <div ref={ref} className="w-full">
      <Panel context="Last 7 days · 40 devices" className="md:grid-cols-[0.85fr_1.15fr]">
        <PanelCard className="flex flex-col">
          <p className="text-[13px] text-muted">Requests checked</p>
          <Big className="mt-2">{fmt(48210 * p)}</Big>
          <div className="mt-6 grid grid-cols-2 border-y border-line py-4">
            <div className="border-r border-line pr-4">
              <p className="text-[12.5px] text-muted">Blocked</p>
              <p className="mt-1.5 font-display text-[1.5rem] leading-none tracking-[-0.02em] text-fg tabular-nums">{fmt(1284 * p)}</p>
            </div>
            <div className="pl-5">
              <p className="text-[12.5px] text-muted">Allowed</p>
              <p className="mt-1.5 font-display text-[1.5rem] leading-none tracking-[-0.02em] text-fg tabular-nums">{fmt(46926 * p)}</p>
            </div>
          </div>
          <ul className="mt-4 grid gap-1">
            {TOP.map((r) => (
              <li key={r.c} className="flex items-center justify-between gap-3 py-1 text-[13px]">
                <span className="font-mono text-[12px] text-fg">{r.c}</span>
                <span className="tabular-nums text-muted">{fmt(r.n * p)} blocked</span>
              </li>
            ))}
          </ul>
          <div className="mt-auto flex items-center justify-between border-t border-line pt-4 text-[13px]">
            <span className="flex items-center gap-1.5 text-fg"><LockSimple size={14} /> Signed policy</span>
            <span className="text-muted">4 policies</span>
          </div>
        </PanelCard>

        <PanelCard className="flex flex-col">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[13px] text-muted">Blocked this week</p>
              <Big className="mt-2">{fmt(1284 * p)}</Big>
            </div>
            <div className="text-right">
              <p className="text-[13px] text-muted">Trend</p>
              <p className="mt-2 flex items-center justify-end gap-1 font-display text-[1.5rem] leading-none tracking-[-0.02em] text-[#1f7a3d]">
                <TrendDown size={18} weight="bold" /> 12%
              </p>
            </div>
          </div>
          <div className="mt-auto pt-6">
            <LineChart main={BLOCKED} second={ALERTED} labels={DAYS} p={p} />
          </div>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-[12.5px] text-muted">
            <span className="flex items-center gap-2"><span className="h-0.5 w-4 rounded-full bg-brand" /> Blocked</span>
            <span className="flex items-center gap-2"><span className="w-4 border-t border-dashed border-muted" /> Alerted {fmt(372)}</span>
          </div>
        </PanelCard>
      </Panel>
    </div>
  );
}

/* Policies in plain language. Counts tick up while the panel is on screen. */
const POLICIES: { name: string; action: "Block" | "Alert" | "Allow"; who: string; base: number }[] = [
  { name: "Block social media", action: "Block", who: "Everyone", base: 512 },
  { name: "Approved AI tools only", action: "Block", who: "Engineering", base: 188 },
  { name: "Flag file sharing", action: "Alert", who: "Everyone", base: 96 },
  { name: "Allow the bank portal", action: "Allow", who: "Finance", base: 44 },
];

export function PolicyPanel() {
  const { ref, t } = useTimeline(80, 79);
  const paused = t >= 40 && t < 64;
  return (
    <div ref={ref} className="w-full">
      <Panel context="Policies">
        <PanelCard>
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[13px] text-muted">Active policies</p>
              <Big className="mt-2"><Tick value={paused ? 3 : 4} /></Big>
            </div>
            <p className="max-w-[18ch] text-right text-[12.5px] text-muted">{paused ? "One paused, not deleted" : "Changes reach devices on the next pull"}</p>
          </div>
          <ul className="mt-5 border-t border-line">
            {POLICIES.map((r, i) => {
              const on = !(paused && i === 2);
              return (
                <li key={r.name} className="flex items-center gap-4 border-b border-line py-3.5 last:border-b-0">
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-[14px] transition-colors ${on ? "text-fg" : "text-muted"}`}>{r.name}</span>
                    <span className="mt-0.5 block text-[12px] text-muted">
                      {r.who} · <Tick value={fmt(r.base + (on ? Math.floor(t / (6 + i)) : 0))} /> {r.action === "Allow" ? "allowed" : r.action === "Alert" ? "alerts" : "blocked"}
                    </span>
                  </span>
                  <ActionPill action={r.action} />
                  <Toggle on={on} />
                </li>
              );
            })}
          </ul>
        </PanelCard>
      </Panel>
    </div>
  );
}

/* The URL checker: what would happen to an address, and which policy decides. */
const CHECKS: { url: string; state: "blocked" | "allowed"; cat: string; policy: string; who: string }[] = [
  { url: "instagram.com", state: "blocked", cat: "Social media", policy: "Block social media", who: "Everyone" },
  { url: "chat.deepseek.com", state: "blocked", cat: "AI tools", policy: "Approved AI tools only", who: "Engineering" },
  { url: "docs.google.com", state: "allowed", cat: "Productivity", policy: "No policy matches", who: "Everyone" },
];

export function UrlCheckPanel() {
  const STEP = 50;
  const { ref, t } = useTimeline(CHECKS.length * STEP, 40);
  const idx = Math.floor(t / STEP);
  const local = t % STEP;
  const c = CHECKS[idx];
  const typed = c.url.slice(0, Math.min(c.url.length, local));
  const done = local >= c.url.length + 4;
  // While the next address is typed, the last decision stays on screen.
  const shown = done ? c : CHECKS[(idx + CHECKS.length - 1) % CHECKS.length];
  return (
    <div ref={ref} className="w-full">
      <Panel context="URL checker">
        <PanelCard>
          <p className="text-[13px] text-muted">Test any address</p>
          <div className="mt-3 flex items-center gap-2.5 rounded-[6px] bg-bg-2 px-3.5 py-3 font-mono text-[13.5px] text-fg">
            <MagnifyingGlass size={15} className="text-muted" />
            <span className="truncate">https://{typed}</span>
            {!done && <span className="-ml-1.5 inline-block h-[1em] w-px shrink-0 animate-pulse bg-fg" />}
          </div>
        </PanelCard>
        <PanelCard className={`transition-opacity duration-300 ${done ? "" : "opacity-50"}`}>
          <AnimatePresence mode="wait">
            <motion.div key={shown.url} {...POP}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[13px] text-muted">Decision for {shown.url}</p>
                  <Big className="mt-2">{shown.state === "blocked" ? "Blocked" : "Allowed"}</Big>
                </div>
                <StatePill state={shown.state} />
              </div>
              <div className="mt-5 border-t border-line pt-2">
                <Row label="Category" value={shown.cat} />
                <Row label="Decided by" value={shown.policy} />
                <Row label="Applies to" value={shown.who} />
              </div>
            </motion.div>
          </AnimatePresence>
        </PanelCard>
      </Panel>
    </div>
  );
}

/* Ready-made categories with a risk level, switched on one by one. */
const CATS: { n: string; risk: 1 | 2 | 3 }[] = [
  { n: "Phishing", risk: 3 },
  { n: "VPN and proxy", risk: 3 },
  { n: "Gambling", risk: 3 },
  { n: "Social media", risk: 2 },
  { n: "AI tools", risk: 2 },
  { n: "Streaming", risk: 1 },
];

export function CategoryPanel() {
  const { ref, t } = useTimeline(60, 59);
  const on = (i: number) => t >= 6 + i * 6;
  const count = CATS.filter((_, i) => on(i)).length;
  return (
    <div ref={ref} className="w-full">
      <Panel context="Categories">
        <PanelCard>
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[13px] text-muted">Blocked categories</p>
              <Big className="mt-2">
                <Tick value={count} />
                <span className="text-muted"> / 27</span>
              </Big>
            </div>
            <p className="max-w-[18ch] text-right text-[12.5px] text-muted">Add your own domains to any category</p>
          </div>
          <ul className="mt-5 grid gap-x-6 border-t border-line sm:grid-cols-2">
            {CATS.map((c, i) => (
              <li key={c.n} className="flex items-center justify-between gap-3 border-b border-line py-3">
                <span className="min-w-0">
                  <span className="block truncate text-[14px] text-fg">{c.n}</span>
                  <span className="mt-1.5 flex gap-1" aria-label={`Risk ${c.risk} of 3`}>
                    {[1, 2, 3].map((d) => (
                      <span key={d} className={`h-1 w-4 rounded-full ${d <= c.risk ? (c.risk === 3 ? "bg-danger" : "bg-brand") : "bg-line-strong"}`} />
                    ))}
                  </span>
                </span>
                <Toggle on={on(i)} />
              </li>
            ))}
          </ul>
        </PanelCard>
      </Panel>
    </div>
  );
}
