"use client";

import {
  AppWindow,
  CheckCircle,
  CircleNotch,
  Cpu,
  FileMagnifyingGlass,
  MagnifyingGlass,
  Article,
  GlobeHemisphereWest,
  Laptop,
  MonitorPlay,
  Prohibit,
  Bug,
  ShieldSlash,
} from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import type { ModuleSlug } from "@/lib/content";
import { LogoMark } from "../wordmark";
import { LiveFeed } from "./live-feed";
import { AgentTag, AppControlVisual, DlpVisual, LiveDot, PixelPanel, POP, PostureVisual, StatePill, UiCard, useTimeline, WebGatewayVisual } from "./visuals";
import { IsolationWidget, PolicyWidget, VpnWidget } from "./why-grid";

/*
 * Hero widgets for inner pages, in the landing page's language: a small UI
 * card on the orange pixel-grid stage, playing a short loop while on screen.
 * All names and numbers are fictional demo data, never claims.
 */

function Stage({ children, tag }: { children: React.ReactNode; tag?: React.ReactNode }) {
  return (
    <PixelPanel className="grid h-full min-h-[360px] place-items-center p-6 md:p-10">
      {children}
      {tag}
    </PixelPanel>
  );
}

/* Platform: the seven controls switch on one after another. */
const CONTROLS = [
  { I: GlobeHemisphereWest, n: "Web Gateway" },
  { I: FileMagnifyingGlass, n: "Data Loss Prevention" },
  { I: AppWindow, n: "Application Control" },
  { I: ShieldSlash, n: "VPN Control" },
  { I: Bug, n: "Malware Scanning" },
  { I: Laptop, n: "Device Posture" },
  { I: MonitorPlay, n: "Activity Monitoring" },
];

export function ControlsHero() {
  const { ref, t } = useTimeline(70, 69);
  return (
    <div ref={ref} className="h-full">
      <Stage tag={<AgentTag className="bottom-[5%] right-[6%]">One agent, one policy</AgentTag>}>
        <UiCard title="Controls" meta={<span className="flex items-center gap-1.5 font-mono text-[10px] text-muted"><Cpu size={12} /> aavishield-agent</span>} className="w-full max-w-[380px]">
          <ul className="grid gap-0.5">
            {CONTROLS.map(({ I, n }, i) => {
              const on = t >= 4 + i * 4;
              return (
                <li key={n} className={`flex items-center gap-3 rounded-[4px] px-1.5 py-1.5 transition-colors duration-300 ${on && t < 8 + i * 4 ? "bg-brand-soft" : ""}`}>
                  <span className={`grid size-7 place-items-center rounded-[4px] transition-colors duration-300 ${on ? "bg-brand text-on-brand" : "bg-bg-2 text-muted"}`}>
                    <I size={15} />
                  </span>
                  <span className="flex-1 text-[13px] text-fg">{n}</span>
                  <span className={`relative h-5 w-9 rounded-full transition-colors duration-300 ${on ? "bg-brand" : "bg-line-strong"}`}>
                    <motion.span layout transition={{ type: "spring", stiffness: 500, damping: 32 }} className={`absolute top-0.5 size-4 rounded-full bg-white shadow ${on ? "right-0.5" : "left-0.5"}`} />
                  </span>
                </li>
              );
            })}
          </ul>
        </UiCard>
      </Stage>
    </div>
  );
}

/* Industries: detectors count sensitive data as it is found. */
const DETECTORS = [
  { n: "Card numbers", k: 31, i: "Finance" },
  { n: "PAN and Aadhaar", k: 18, i: "All sectors" },
  { n: "Patient reports", k: 7, i: "Healthcare" },
  { n: "API keys and source code", k: 12, i: "Software" },
  { n: "Customer records", k: 24, i: "BPO" },
];

export function DataTypesHero() {
  const { ref, t } = useTimeline(70, 69);
  const p = Math.min(1, t / 40);
  return (
    <div ref={ref} className="h-full">
      <Stage tag={<AgentTag tone="tint" className="bottom-[5%] left-[6%]">Reads inside files</AgentTag>}>
        <UiCard title="Sensitive data found" meta={<span className="flex items-center gap-1.5 font-mono text-[10px] text-muted"><LiveDot /> This week</span>} className="w-full max-w-[380px]">
          <ul className="grid gap-2">
            {DETECTORS.map((d, i) => {
              const v = Math.round(d.k * Math.min(1, Math.max(0, p * 1.4 - i * 0.12)));
              return (
                <li key={d.n} className="grid grid-cols-[1fr_auto] items-center gap-x-3">
                  <span className="text-[13px] text-fg">{d.n}</span>
                  <span className="font-mono text-[12px] tabular-nums text-brand-ink">{v}</span>
                  <span className="col-span-2 mt-1 flex items-center gap-2">
                    <span className="h-1 flex-1 overflow-hidden rounded-full bg-bg-2">
                      <span className="block h-full bg-brand transition-[width] duration-100" style={{ width: `${(v / 31) * 100}%` }} />
                    </span>
                    <span className="w-20 text-right font-mono text-[10px] text-muted">{d.i}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </UiCard>
      </Stage>
    </div>
  );
}

/* Pricing: a quote card that builds itself. Prices stay "custom": no numbers are invented. */
export function PlanHero() {
  const { ref, t } = useTimeline(60, 59);
  const devices = Math.round(48 * Math.min(1, t / 18));
  const items = ["Agent for macOS, Windows and Linux", "Admin console", "Employee self-enrollment", "Data Loss Prevention"];
  return (
    <div ref={ref} className="h-full">
      <Stage tag={<AgentTag className="bottom-[5%] right-[6%]">Priced per device</AgentTag>}>
        <UiCard title="Your quote" meta={<span className="font-mono text-[10px] text-muted">Billed annually</span>} className="w-full max-w-[360px]">
          <div className="grid grid-cols-3 gap-1 rounded-[4px] bg-bg-2 p-1 text-center text-[12px]">
            {["Essentials", "Business", "Enterprise"].map((pl) => (
              <span key={pl} className={`rounded-[3px] py-1.5 transition-colors duration-300 ${pl === "Business" && t >= 4 ? "bg-brand text-on-brand" : "text-muted"}`}>{pl}</span>
            ))}
          </div>
          <div className="mt-4 flex items-end justify-between">
            <span className="text-[12.5px] text-muted">Devices</span>
            <span className="font-mono text-2xl tabular-nums text-fg">{devices}</span>
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-bg-2">
            <div className="h-full bg-brand transition-[width] duration-100" style={{ width: `${(devices / 48) * 70}%` }} />
          </div>
          <ul className="mt-4 grid gap-1.5 border-t border-dashed border-line-strong pt-3">
            {items.map((it, i) => (
              <li key={it} className="flex h-[18px] items-center gap-2 text-[12.5px] text-fg">
                {t >= 20 + i * 3 ? (
                  <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}>
                    <CheckCircle size={14} weight="fill" className="text-brand" />
                  </motion.span>
                ) : (
                  <span className="size-[14px] rounded-full border border-line-strong" />
                )}
                {it}
              </li>
            ))}
          </ul>
          <div className="mt-4 flex items-center justify-between rounded-[4px] bg-brand-soft px-3 py-2.5">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-brand-ink">Price</span>
            <span className="text-sm text-fg">Custom quote</span>
          </div>
        </UiCard>
      </Stage>
    </div>
  );
}

/* How it works: the rollout checklist ticks itself off. */
const ROLLOUT = ["Create your organisation", "Add your people", "Install the agent", "Switch on policy", "Watch events arrive"];

export function RolloutHero() {
  const { ref, t } = useTimeline(70, 69);
  const done = Math.min(ROLLOUT.length, Math.floor(t / 8));
  return (
    <div ref={ref} className="h-full">
      <Stage tag={<AgentTag className="bottom-[5%] right-[6%]">Live in an afternoon</AgentTag>}>
        <UiCard title="Rollout" meta={<span className="font-mono text-[10px] tabular-nums text-muted">{done} / {ROLLOUT.length}</span>} className="w-full max-w-[360px]">
          <ol className="relative grid gap-3">
            <span aria-hidden className="absolute bottom-2 left-[9px] top-2 w-px bg-line" />
            {ROLLOUT.map((s, i) => {
              const state = i < done ? "done" : i === done ? "now" : "next";
              return (
                <li key={s} className="relative flex items-center gap-3 text-[13px]">
                  <span className="relative grid size-[19px] place-items-center rounded-full bg-surface">
                    {state === "done" ? (
                      <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}>
                        <CheckCircle size={19} weight="fill" className="text-brand" />
                      </motion.span>
                    ) : state === "now" ? (
                      <CircleNotch size={16} className="animate-spin text-brand" />
                    ) : (
                      <span className="size-3 rounded-full border border-line-strong" />
                    )}
                  </span>
                  <span className={state === "next" ? "text-muted" : "text-fg"}>{s}</span>
                  {state === "done" && i === ROLLOUT.length - 1 && <span className="ml-auto"><StatePill state="allowed" /></span>}
                </li>
              );
            })}
          </ol>
        </UiCard>
      </Stage>
    </div>
  );
}

/* Why Aavishield: four separate tools are struck out, one agent takes over. */
const PATCHWORK = ["Office firewall", "VPN for remote staff", "Separate DLP tool", "Compliance checker"];

export function ConsolidateHero() {
  const { ref, t } = useTimeline(60, 59);
  return (
    <div ref={ref} className="h-full">
      <Stage tag={<AgentTag className="bottom-[5%] right-[6%]">One console</AgentTag>}>
        <div className="grid w-full max-w-[360px] gap-3">
          <UiCard title="Before" meta={<span className="font-mono text-[10px] text-muted">4 tools</span>}>
            <ul className="grid gap-1.5">
              {PATCHWORK.map((p, i) => {
                const gone = t >= 4 + i * 4;
                return (
                  <li key={p} className="flex h-[22px] items-center justify-between gap-3 text-[13px]">
                    <span className={`transition-colors duration-300 ${gone ? "text-muted line-through decoration-danger/60" : "text-fg"}`}>{p}</span>
                    <AnimatePresence>{gone && <motion.span {...POP}><Prohibit size={14} weight="fill" className="text-danger/70" /></motion.span>}</AnimatePresence>
                  </li>
                );
              })}
            </ul>
          </UiCard>
          <AnimatePresence>
            {t >= 22 && (
              <motion.div {...POP} className="flex items-center gap-3 rounded-[6px] bg-brand px-4 py-3.5 text-on-brand">
                <Cpu size={22} />
                <span>
                  <span className="block text-sm">aavishield-agent</span>
                  <span className="block font-mono text-[10.5px] uppercase tracking-[0.06em] opacity-80">Replaces all four</span>
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </Stage>
    </div>
  );
}

/* FAQ: a question types itself, then the answer appears. */
const QA = [
  { q: "Will DLP block our uploads?", a: "No. DLP is monitor-only. It records what sensitive data left and where, without interrupting work." },
  { q: "Do we need a VPN or appliance?", a: "No. Enforcement happens on the device, so it works on any network." },
  { q: "Which systems are supported?", a: "macOS, Windows and Linux, with the same agent and the same policy on all three." },
];

export function FaqHero() {
  const { ref, t } = useTimeline(QA.length * 50, 30);
  const idx = Math.floor(t / 50);
  const local = t % 50;
  const { q, a } = QA[idx];
  const typed = q.slice(0, Math.min(q.length, local * 2));
  return (
    <div ref={ref} className="h-full">
      <Stage tag={<AgentTag tone="tint" className="bottom-[5%] left-[6%]">Straight answers</AgentTag>}>
        <UiCard title="Ask Aavishield" meta={<span className="font-mono text-[10px] text-muted">{idx + 1} / {QA.length}</span>} className="w-full max-w-[380px]">
          <div className="ml-auto w-fit max-w-[90%] rounded-[6px] rounded-br-[2px] bg-brand px-3 py-2 text-[13px] text-on-brand">
            {typed}
            {typed.length < q.length && <span className="ml-px inline-block h-[1em] w-px translate-y-[2px] animate-pulse bg-white" />}
          </div>
          <div className="mt-3 min-h-[76px]">
            <AnimatePresence mode="wait">
              {local >= 18 ? (
                <motion.p key={`a${idx}`} {...POP} className="max-w-[92%] rounded-[6px] rounded-bl-[2px] border border-line bg-bg px-3 py-2 text-[13px] leading-relaxed text-fg">
                  {a}
                </motion.p>
              ) : local >= 12 ? (
                <motion.span key={`w${idx}`} {...POP} className="inline-flex gap-1 rounded-[6px] border border-line bg-bg px-3 py-3">
                  {[0, 1, 2].map((d) => <span key={d} className="size-1.5 animate-pulse rounded-full bg-muted" style={{ animationDelay: `${d * 0.15}s` }} />)}
                </motion.span>
              ) : null}
            </AnimatePresence>
          </div>
        </UiCard>
      </Stage>
    </div>
  );
}

/* Activity monitoring: a day's timeline fills in, block by block. */
const BLOCKS = [
  { app: "Figma", w: 18, c: "bg-brand" },
  { app: "Slack", w: 9, c: "bg-brand-tint" },
  { app: "VS Code", w: 26, c: "bg-brand" },
  { app: "Idle", w: 6, c: "bg-bg-2" },
  { app: "Chrome", w: 14, c: "bg-brand-tint" },
  { app: "VS Code", w: 21, c: "bg-brand" },
];

export function ActivityVisual() {
  const { ref, t } = useTimeline(60, 59);
  const shown = Math.min(BLOCKS.length, Math.floor(t / 5));
  return (
    <div ref={ref} className="h-full">
      <Stage tag={<AgentTag tone="ink" className="bottom-[5%] right-[6%]">Only where you choose</AgentTag>}>
        <UiCard title="Activity timeline" meta={<span className="flex items-center gap-1.5 text-[11px] text-muted"><Laptop size={13} /> MacBook · Ananya</span>} className="w-full max-w-[400px]">
          <div className="flex h-7 overflow-hidden rounded-[4px] bg-bg-2">
            {BLOCKS.map((b, i) => (
              <motion.span key={i} className={`h-full ${b.c} border-r border-surface last:border-r-0`} initial={false} animate={{ width: i < shown ? `${b.w}%` : "0%" }} transition={{ duration: 0.4, ease: "easeOut" }} />
            ))}
          </div>
          <div className="mt-1.5 flex justify-between font-mono text-[10px] text-muted">
            <span>09:00</span>
            <span>13:00</span>
            <span>18:00</span>
          </div>
          <ul className="mt-4 grid gap-1.5 border-t border-dashed border-line-strong pt-3 text-[12.5px]">
            {[
              { a: "VS Code", v: "3h 51m" },
              { a: "Figma", v: "2h 14m" },
              { a: "Chrome", v: "1h 22m" },
            ].map((r, i) => (
              <li key={r.a} className={`flex items-center justify-between transition-opacity duration-300 ${shown > i + 2 ? "opacity-100" : "opacity-30"}`}>
                <span className="text-fg">{r.a}</span>
                <span className="font-mono tabular-nums text-muted">{r.v}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 grid grid-cols-4 gap-1.5" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={`aspect-[16/10] rounded-[3px] border border-line transition-colors duration-300 ${shown > i + 1 ? "pixel-grid bg-brand-soft" : "bg-bg-2"}`} />
            ))}
          </div>
          <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.06em] text-muted">Periodic screenshots · blurred</p>
        </UiCard>
      </Stage>
    </div>
  );
}

/** The hero widget that represents one platform module. */
export function ModuleVisual({ slug }: { slug: ModuleSlug }) {
  switch (slug) {
    case "web-gateway":
      return <WebGatewayVisual />;
    case "data-loss-prevention":
      return <DlpVisual />;
    case "application-control":
      return <AppControlVisual />;
    case "vpn-control":
      return (
        <Stage tag={<AgentTag tone="ink" className="bottom-[5%] right-[6%]">Blocked by default</AgentTag>}>
          <VpnWidget />
        </Stage>
      );
    case "malware-scanning":
    case "device-posture":
      return <PostureVisual />;
    case "activity-monitoring":
      return <ActivityVisual />;
  }
}

/** Solutions overview: the landing page's live decisions feed. */
export function FeedHero() {
  return (
    <Stage tag={<AgentTag className="left-6 top-4">Aavishield agent</AgentTag>}>
      <LiveFeed className="w-full max-w-[400px]" />
    </Stage>
  );
}

/** Security: the signed policy bundle above company isolation. */
export function TrustHero() {
  return (
    <Stage tag={<AgentTag className="bottom-[5%] right-[6%]">Verified on the device</AgentTag>}>
      <div className="grid w-full max-w-[300px] gap-4">
        <PolicyWidget />
        <IsolationWidget />
      </div>
    </Stage>
  );
}

/** Company: the mark on the pixel grid. */
export function MarkHero() {
  return (
    <Stage>
      <div className="grid place-items-center gap-4">
        <LogoMark className="h-28" />
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">Built by Aavish AI Lab</span>
      </div>
    </Stage>
  );
}

/* Knowledge hub: a question is typed and the matching articles appear. */
const SEARCHES: { q: string; hits: { t: string; c: string }[] }[] = [
  { q: "block a personal vpn", hits: [{ t: "How personal VPN and proxy blocking works", c: "Policies" }, { t: "Block websites by category or domain", c: "Policies" }] },
  { q: "install the agent", hits: [{ t: "Install the agent on macOS, Windows and Linux", c: "Getting started" }, { t: "Agent updates and offline devices", c: "Devices" }] },
  { q: "what does dlp detect", hits: [{ t: "What DLP detects", c: "Data protection" }, { t: "How data loss prevention works", c: "Data protection" }] },
];

export function HubHero() {
  const { ref, t } = useTimeline(SEARCHES.length * 50, 40);
  const idx = Math.floor(t / 50);
  const local = t % 50;
  const { q, hits } = SEARCHES[idx];
  const typed = q.slice(0, Math.min(q.length, local));
  const done = typed.length === q.length;
  return (
    <div ref={ref} className="h-full">
      <Stage tag={<AgentTag tone="tint" className="bottom-[5%] right-[6%]">Answers in one search</AgentTag>}>
        <UiCard title="Knowledge hub" meta={<span className="font-mono text-[10px] text-muted">{idx + 1} / {SEARCHES.length}</span>} className="w-full max-w-[380px]">
          <div className="flex items-center gap-2 rounded-[4px] border border-line-strong bg-bg px-3 py-2 text-[13px] text-fg">
            <MagnifyingGlass size={14} className="text-muted" />
            {typed}
            {!done && <span className="ml-px inline-block h-[1em] w-px translate-y-[1px] animate-pulse bg-fg" />}
          </div>
          <ul className="mt-3 grid min-h-[104px] content-start gap-2">
            <AnimatePresence mode="popLayout">
              {done &&
                hits.map((h, i) => (
                  <motion.li key={`${idx}-${h.t}`} {...POP} transition={{ ...POP.transition, delay: i * 0.12 }} className="flex items-start gap-2.5 rounded-[4px] border border-line bg-surface px-3 py-2">
                    <Article size={15} className="mt-0.5 shrink-0 text-brand-ink" />
                    <span className="min-w-0">
                      <span className="block text-[13px] leading-snug text-fg">{h.t}</span>
                      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted">{h.c}</span>
                    </span>
                  </motion.li>
                ))}
            </AnimatePresence>
          </ul>
        </UiCard>
      </Stage>
    </div>
  );
}

/* Blog: new posts land on the feed one after another. */
const POSTS = [
  { t: "What your team pastes into AI tools", c: "Data protection", m: 3 },
  { t: "Why personal VPNs break web filtering", c: "Web security", m: 2 },
  { t: "Rolling out without losing trust", c: "Guides", m: 2 },
];

export function BlogHero() {
  const { ref, t } = useTimeline(60, 59);
  const shown = Math.min(POSTS.length, Math.floor(t / 10) + 1);
  return (
    <div ref={ref} className="h-full">
      <Stage tag={<AgentTag className="left-6 top-4">From the team</AgentTag>}>
        <UiCard title="Aavishield blog" meta={<LiveDot />} className="w-full max-w-[380px]">
          <ul className="grid min-h-[222px] content-start gap-2">
            <AnimatePresence initial={false}>
              {POSTS.slice(0, shown).map((p, i) => (
                <motion.li key={p.t} {...POP} className={`rounded-[4px] border px-3 py-2.5 ${i === shown - 1 ? "border-brand/40 bg-brand-soft" : "border-line bg-surface"}`}>
                  <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-brand-ink">{p.c}</span>
                  <span className="mt-1 block text-[13.5px] leading-snug text-fg">{p.t}</span>
                  <span className="mt-1 block font-mono text-[10px] text-muted">{p.m} min read</span>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </UiCard>
      </Stage>
    </div>
  );
}
