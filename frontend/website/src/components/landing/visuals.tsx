"use client";

import {
  ArrowRight,
  CheckCircle,
  CircleNotch,
  Eye,
  FileXls,
  Laptop,
  LockSimple,
  MagnifyingGlass,
  NavigationArrow,
  OpenAiLogo,
  Prohibit,
  ShieldCheck,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

/*
 * Product visuals for the landing page: small, faithful renderings of what
 * the Aavishield console and agent show, set on pixel-grid panels. All names
 * and files are the same fictional demo data the console screenshots use.
 *
 * Each widget plays a short looping story driven by one timeline (`t`, in
 * 100ms ticks) that only runs while the widget is on screen. With reduced
 * motion the timeline is pinned to its finished frame.
 */

const EASE = [0.16, 1, 0.3, 1] as const;
export const POP = { initial: { opacity: 0, scale: 0.9, y: 4 }, animate: { opacity: 1, scale: 1, y: 0 }, exit: { opacity: 0 }, transition: { duration: 0.35, ease: EASE } };

/** A looping tick counter that runs only while `ref` is in view. */
export function useTimeline(period: number, final: number) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.15 });
  const reduce = useReducedMotion();
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!inView || reduce) return;
    const id = setInterval(() => setT((v) => (v + 1) % period), 100);
    return () => clearInterval(id);
  }, [inView, reduce, period]);
  return { ref, t: reduce ? final : t, reduce: !!reduce };
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const easeOut = (n: number) => 1 - Math.pow(1 - clamp01(n), 3);

/** Light orange pixel-grid stage with "+" marks in the corners. */
export function PixelPanel({ children, className = "", ref }: { children: React.ReactNode; className?: string; ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className={`pixel-grid relative overflow-hidden rounded-[4px] border border-brand/15 bg-brand-soft ${className}`}>
      {["left-2 top-2", "right-2 top-2", "bottom-2 left-2", "bottom-2 right-2"].map((pos) => (
        <span key={pos} aria-hidden className={`absolute ${pos} text-[14px] leading-none text-fg/50`}>
          +
        </span>
      ))}
      {children}
    </div>
  );
}

/** Floating label with a cursor, like a teammate's pointer. Drifts gently. */
export function AgentTag({ children, tone = "brand", className = "" }: { children: React.ReactNode; tone?: "brand" | "tint" | "ink"; className?: string }) {
  const look = tone === "brand" ? "bg-brand text-on-brand" : tone === "tint" ? "bg-brand-tint text-[#2a1406]" : "bg-ink text-ink-fg";
  const arrow = tone === "ink" ? "text-ink" : "text-brand";
  return (
    <span aria-hidden className={`tag-float pointer-events-none absolute z-20 flex items-start gap-0.5 ${className}`}>
      <NavigationArrow size={18} weight="fill" className={`-scale-x-100 ${arrow}`} />
      <span className={`mt-3 whitespace-nowrap px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] ${look}`}>{children}</span>
    </span>
  );
}

/** Small UI card shell: mono title bar, then content. */
export function UiCard({ title, meta, children, className = "" }: { title: string; meta?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`ui-panel relative rounded-[6px] border border-line-strong/70 bg-surface shadow-[0_18px_40px_-24px_rgb(120_50_0/0.35)] ${className}`}>
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-fg">{title}</span>
        {meta}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

const STATE = {
  blocked: { I: Prohibit, label: "Blocked", cls: "bg-[#fdecea] text-danger" },
  flagged: { I: WarningCircle, label: "Flagged", cls: "bg-brand-soft text-brand-ink" },
  allowed: { I: CheckCircle, label: "Allowed", cls: "bg-[#e8f5ec] text-[#1f7a3d]" },
} as const;
export type EventState = keyof typeof STATE;

export function StatePill({ state }: { state: EventState }) {
  const s = STATE[state];
  return (
    <span className={`ui-pill inline-flex shrink-0 items-center gap-1 rounded-[4px] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] ${s.cls}`}>
      <s.I size={11} weight="fill" />
      {s.label}
    </span>
  );
}

export function LiveDot({ className = "" }: { className?: string }) {
  return (
    <span className={`relative flex size-1.5 ${className}`}>
      <span className="absolute inset-0 animate-pulse-ring rounded-full bg-brand" />
      <span className="relative size-1.5 rounded-full bg-brand" />
    </span>
  );
}

function Caret() {
  return <span className="ml-px inline-block h-[1.05em] w-px translate-y-[2px] animate-pulse bg-fg" />;
}

/* ── 01 Web gateway: the console's URL checker ─────────────────────────── */
const CHECKS: { host: string; cat: string; state: EventState }[] = [
  { host: "instagram.com", cat: "Social media", state: "blocked" },
  { host: "docs.google.com", cat: "Productivity", state: "allowed" },
  { host: "bet365.com", cat: "Gambling", state: "blocked" },
  { host: "chat.deepseek.com", cat: "AI tools", state: "blocked" },
];
// Per domain: type it (1 char per tick), check for 7 ticks, show for 22.
const SEGMENTS = CHECKS.map((c) => c.host.length + 7 + 22);
const URL_PERIOD = SEGMENTS.reduce((a, b) => a + b, 0);

function urlAt(t: number) {
  let idx = 0;
  let local = t;
  while (local >= SEGMENTS[idx]) {
    local -= SEGMENTS[idx];
    idx++;
  }
  const len = CHECKS[idx].host.length;
  const phase = local < len ? "typing" : local < len + 7 ? "checking" : "result";
  return { idx, typed: Math.min(local, len), phase };
}

export function WebGatewayVisual() {
  const { ref, t } = useTimeline(URL_PERIOD, SEGMENTS[0] - 1);
  const { idx, typed, phase } = urlAt(t);
  const cur = CHECKS[idx];
  const recent = [1, 2, 3].map((k) => CHECKS[(idx - k + CHECKS.length * 2) % CHECKS.length]);
  return (
    <PixelPanel ref={ref} className="grid min-h-[360px] place-items-center p-6 md:p-10">
      <UiCard title="URL checker" meta={<span className="font-mono text-[10px] text-muted">Company policy</span>} className="w-full max-w-[380px]">
        <div className={`flex items-center gap-2 rounded-[4px] border bg-bg px-3 py-2 text-sm text-fg transition-colors duration-300 ${phase === "typing" ? "border-brand/60" : "border-line"}`}>
          <MagnifyingGlass size={14} className="text-muted" />
          <span>{cur.host.slice(0, typed)}</span>
          {phase === "typing" && <Caret />}
        </div>
        <div className="mt-3 h-[42px]">
          <AnimatePresence mode="wait">
            {phase === "result" ? (
              <motion.div
                key={`r${idx}`}
                {...POP}
                className={`flex h-full items-center justify-between rounded-[4px] border px-3 ${cur.state === "blocked" ? "border-danger/20 bg-[#fdecea] text-danger" : "border-[#1f7a3d]/20 bg-[#e8f5ec] text-[#1f7a3d]"}`}
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  {cur.state === "blocked" ? <Prohibit size={16} weight="fill" /> : <CheckCircle size={16} weight="fill" />}
                  {cur.state === "blocked" ? "Blocked" : "Allowed"}
                </span>
                <span className="font-mono text-[10.5px] opacity-80">{cur.cat}</span>
              </motion.div>
            ) : phase === "checking" ? (
              <motion.div key={`c${idx}`} {...POP} className="flex h-full items-center gap-2 rounded-[4px] border border-dashed border-line-strong px-3 font-mono text-[11px] text-muted">
                <CircleNotch size={14} className="animate-spin text-brand" /> Checking signed policy…
              </motion.div>
            ) : (
              <motion.div key={`w${idx}`} {...POP} className="flex h-full items-center px-3 font-mono text-[11px] text-muted/70">
                Type any address to test it
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <ul className="mt-4 grid gap-2 border-t border-dashed border-line-strong pt-3">
          <AnimatePresence initial={false}>
            {recent.map((r) => (
              <motion.li
                key={r.host}
                layout
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4, ease: EASE }}
                className="flex items-center justify-between gap-3 text-[12.5px]"
              >
                <span className="min-w-0 truncate text-fg">{r.host}</span>
                <span className="flex items-center gap-2">
                  <span className="hidden text-[11px] text-muted sm:inline">{r.cat}</span>
                  <StatePill state={r.state} />
                </span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </UiCard>
      <AgentTag className="bottom-[7%] right-[6%]">On any network</AgentTag>
    </PixelPanel>
  );
}

/* ── 02 Data loss prevention: one finding being built ───────────────────── */
export function DlpVisual() {
  const { ref, t } = useTimeline(80, 79);
  const detectors = ["Salary data · AI", "PAN × 12", "Bank account × 4"];
  const risk = Math.round(86 * easeOut((t - 30) / 14));
  const sending = t >= 4 && t < 16;
  return (
    <PixelPanel ref={ref} className="grid min-h-[360px] place-items-center p-6 md:p-10">
      <UiCard title="DLP finding" meta={t >= 46 ? <motion.span {...POP}><StatePill state="flagged" /></motion.span> : <span className="font-mono text-[10px] text-muted">Scanning…</span>} className="w-full min-w-0 max-w-[400px]">
        {/* Wraps on narrow screens: the destination drops to its own line. */}
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid size-10 place-items-center rounded-[4px] bg-[#e8f5ec] text-[#1f7a3d]">
            <FileXls size={22} weight="fill" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-fg">Q3-salaries.xlsx</span>
            <span className="block text-[11.5px] text-muted">Ananya Rao · MacBook Pro</span>
          </span>
          {/* The file travels along the arrow to its destination. */}
          <span className="relative h-4 w-8">
            <ArrowRight size={14} className="absolute right-0 top-0.5 text-muted" />
            {sending && <motion.span key={t >= 4 ? "go" : "idle"} className="absolute top-1.5 size-1.5 bg-brand" initial={{ left: 0, opacity: 1 }} animate={{ left: 22, opacity: [1, 1, 0] }} transition={{ duration: 1.1, ease: "easeInOut" }} />}
          </span>
          <span className={`flex items-center gap-1.5 rounded-[4px] border px-2 py-1 text-[12px] text-fg transition-colors duration-500 ${t >= 14 ? "border-brand/50 bg-brand-soft" : "border-line"}`}>
            <OpenAiLogo size={14} weight="fill" /> chatgpt.com
          </span>
        </div>
        <div className="mt-4 flex min-h-[26px] flex-wrap gap-1.5">
          <AnimatePresence>
            {detectors.map((d, i) =>
              t >= 16 + i * 4 ? (
                <motion.span key={d} {...POP} className="rounded-[4px] bg-bg-2 px-2 py-1 font-mono text-[10.5px] text-fg-2">
                  {d}
                </motion.span>
              ) : null,
            )}
          </AnimatePresence>
        </div>
        <div className="mt-4">
          <div className="flex items-center justify-between font-mono text-[10.5px] uppercase tracking-[0.06em] text-muted">
            <span>Risk score</span>
            <span className="tabular-nums text-brand-ink">{Math.max(0, risk)} / 100</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-bg-2">
            <div className="h-full bg-gradient-to-r from-brand-tint to-brand transition-[width] duration-100" style={{ width: `${Math.max(0, risk)}%` }} />
          </div>
        </div>
        <div className="mt-4 h-[18px]">
          <AnimatePresence>
            {t >= 46 && (
              <motion.p {...POP} className="flex items-center gap-1.5 text-[12px] text-muted">
                <Eye size={13} /> Recorded with the file. The upload was not blocked.
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </UiCard>
      <AgentTag tone="tint" className="bottom-[7%] left-[6%]">Reads inside files</AgentTag>
    </PixelPanel>
  );
}

/* ── 03 Application and VPN control: switches, then a stopped launch ────── */
export function AppControlVisual() {
  const { ref, t } = useTimeline(90, 30);
  const apps = [
    { name: "AnyDesk", cat: "Remote access", on: t >= 8, c: "#ef443b" },
    { name: "NordVPN", cat: "VPN · blocked by default", on: true, c: "#4687ff", locked: true },
    { name: "uTorrent", cat: "File sharing", on: t >= 14, c: "#76b83f" },
    { name: "Slack", cat: "Approved", on: false, c: "#611f69" },
  ];
  const alert = t >= 28 && t < 52 ? 0 : t >= 58 && t < 84 ? 1 : -1;
  const alerts = [
    { app: "AnyDesk", text: "Launch stopped on Rohan's ThinkPad" },
    { app: "NordVPN", text: "Connection blocked on build-02" },
  ];
  return (
    <PixelPanel ref={ref} className="grid min-h-[360px] place-items-center p-6 md:p-10">
      <div className="w-full max-w-[380px]">
        <UiCard title="Application control" meta={<span className="font-mono text-[10px] text-muted">48 devices</span>}>
          <ul className="grid gap-1">
            {apps.map((a, i) => {
              const hit = alert >= 0 && alerts[alert].app === a.name;
              return (
                <li key={a.name} className={`flex items-center gap-3 rounded-[4px] px-1.5 py-2 transition-colors duration-300 ${hit ? "bg-[#fdecea]" : ""}`}>
                  <span className="grid size-8 place-items-center rounded-[6px] font-display text-sm font-bold text-white" style={{ background: a.c }}>
                    {a.name[0]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-fg">{a.name}</span>
                    <span className="block truncate text-[11.5px] text-muted">{a.cat}</span>
                  </span>
                  {a.locked ? <LockSimple size={13} className={i === 1 && hit ? "text-danger" : "text-muted"} /> : null}
                  <span className={`relative h-5 w-9 rounded-full transition-colors duration-300 ${a.on ? "bg-brand" : "bg-line-strong"}`}>
                    <motion.span layout transition={{ type: "spring", stiffness: 500, damping: 32 }} className={`absolute top-0.5 size-4 rounded-full bg-white shadow ${a.on ? "right-0.5" : "left-0.5"}`} />
                  </span>
                </li>
              );
            })}
          </ul>
        </UiCard>
        <div className="mt-3 h-[52px]">
          <AnimatePresence mode="wait">
            {alert >= 0 && (
              <motion.div
                key={alert}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.4, ease: EASE }}
                className="flex items-center gap-3 rounded-[6px] border border-danger/25 bg-surface px-3 py-2.5 shadow-[0_18px_40px_-24px_rgb(120_50_0/0.35)]"
              >
                <Prohibit size={18} weight="fill" className="text-danger" />
                <span className="min-w-0 flex-1 text-[12.5px] text-fg">
                  <span className="font-medium">{alerts[alert].app}</span> <span className="text-muted">· {alerts[alert].text}</span>
                </span>
                <span className="font-mono text-[10px] text-muted">now</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      <AgentTag tone="ink" className="left-6 top-1">VPNs stay blocked</AgentTag>
    </PixelPanel>
  );
}

/* ── 04 Posture and malware: gauge fills, checks tick, a download is scanned ─ */
export function PostureVisual() {
  const { ref, t } = useTimeline(100, 99);
  const score = Math.round(78 * easeOut(t / 14));
  const r = 52;
  const half = Math.PI * r;
  const checks: { label: string; ok: boolean; note?: string }[] = [
    { label: "Disk encryption", ok: true },
    { label: "Firewall", ok: true },
    { label: "Antivirus", ok: true },
    { label: "OS updates", ok: false, note: "34 days behind" },
  ];
  const scan = clamp01((t - 22) / 20);
  const scanned = t >= 42;
  return (
    <PixelPanel ref={ref} className="grid min-h-[360px] place-items-center p-6 md:p-10">
      <div className="grid w-full max-w-[420px] gap-3">
        <UiCard title="Device posture" meta={<span className="flex items-center gap-1.5 text-[11px] text-muted"><Laptop size={13} /> ThinkPad · Rohan</span>}>
          <div className="flex items-center gap-5">
            <svg viewBox="0 0 124 70" className="w-[124px] shrink-0" aria-hidden>
              <path d={`M 10 64 A ${r} ${r} 0 0 1 114 64`} fill="none" stroke="var(--bg-2)" strokeWidth="10" strokeLinecap="round" />
              <path d={`M 10 64 A ${r} ${r} 0 0 1 114 64`} fill="none" stroke="var(--brand)" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${(half * score) / 100} ${half}`} />
              <text x="62" y="58" textAnchor="middle" className="fill-fg font-mono text-[20px] tabular-nums">
                {score}
              </text>
            </svg>
            <ul className="grid flex-1 gap-1.5">
              {checks.map((c, i) => {
                const shown = t >= 3 + i * 3;
                return (
                  <li key={c.label} className="flex h-[19px] items-center justify-between gap-2 text-[12.5px]">
                    <span className="flex items-center gap-1.5 text-fg">
                      <span className="grid size-[14px] place-items-center">
                        {shown ? (
                          <motion.span initial={{ scale: 0 }} animate={c.ok ? { scale: 1 } : { scale: 1, x: [0, -2, 2, -1, 0] }} transition={{ duration: 0.4 }}>
                            {c.ok ? <CheckCircle size={14} weight="fill" className="text-[#1f7a3d]" /> : <XCircle size={14} weight="fill" className="text-danger" />}
                          </motion.span>
                        ) : (
                          <CircleNotch size={12} className="animate-spin text-muted" />
                        )}
                      </span>
                      {c.label}
                    </span>
                    {c.note && shown && <motion.span {...POP} className="font-mono text-[10px] text-danger">{c.note}</motion.span>}
                  </li>
                );
              })}
            </ul>
          </div>
        </UiCard>
        <div className={`rounded-[6px] border bg-surface px-4 py-3 shadow-[0_18px_40px_-24px_rgb(120_50_0/0.35)] transition-colors duration-500 ${scanned ? "border-danger/30" : "border-line-strong/70"}`}>
          <div className="flex items-center gap-3">
            <ShieldCheck size={20} weight="fill" className={scanned ? "text-danger" : "text-brand"} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-fg">invoice_0932.zip</span>
              <span className="block text-[11.5px] text-muted">{scanned ? "Trojan found in download · risk 96" : t >= 22 ? "Scanning before it reaches the disk…" : "Download started"}</span>
            </span>
            <AnimatePresence mode="wait">{scanned && <motion.span {...POP}><StatePill state="blocked" /></motion.span>}</AnimatePresence>
          </div>
          <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-bg-2">
            <div className={`h-full transition-[width] duration-100 ${scanned ? "bg-danger" : "bg-brand"}`} style={{ width: `${scan * 100}%` }} />
          </div>
        </div>
      </div>
      <AgentTag className="bottom-[5%] right-[6%]">Scanned before it lands</AgentTag>
    </PixelPanel>
  );
}

/* ── How it works: one request, step by step ────────────────────────────── */
type Scenario = {
  chip: string;
  device: string;
  verb: string;
  target: string;
  checks: [string, string][];
  decision: EventState;
  reason: string;
};

const SCENARIOS: Scenario[] = [
  {
    chip: "Gambling site",
    device: "ThinkPad · Rohan",
    verb: "Opens",
    target: "bet365.com",
    checks: [["Policy signature", "Verified"], ["Web category", "Gambling"], ["Rule", "Block gambling"]],
    decision: "blocked",
    reason: "Matched the Gambling category. The page never loads.",
  },
  {
    chip: "Salary sheet to ChatGPT",
    device: "MacBook Pro · Ananya",
    verb: "Uploads",
    target: "Q3-salaries.xlsx",
    checks: [["Policy signature", "Verified"], ["DLP scan", "Salary data, PAN × 12"], ["Mode", "Monitor only"]],
    decision: "flagged",
    reason: "The upload goes through. The finding and file are recorded.",
  },
  {
    chip: "Approved site",
    device: "MacBook Air · Meera",
    verb: "Opens",
    target: "docs.google.com",
    checks: [["Policy signature", "Verified"], ["Web category", "Productivity"], ["Rule", "Allowed"]],
    decision: "allowed",
    reason: "No rule matched. Work carries on, logged as allowed.",
  },
  {
    chip: "VPN install",
    device: "Ubuntu · build-02",
    verb: "Downloads",
    target: "protonvpn-setup.exe",
    checks: [["Policy signature", "Verified"], ["VPN control", "Known VPN installer"], ["Rule", "Blocked by default"]],
    decision: "blocked",
    reason: "VPNs are blocked on every device, with no setup needed.",
  },
];
const STEP = 60; // ticks per scenario (6s)

/** A connector between steps; a pulse runs along it while `active`. */
function Wire({ active }: { active: boolean }) {
  const pulse = { duration: 0.6, ease: "easeInOut" } as const;
  return (
    <div aria-hidden className="relative mx-auto h-8 w-px bg-line-strong lg:my-auto lg:h-px lg:w-full">
      {active && (
        <>
          {/* Down the wire on phones, across it on desktop. */}
          <motion.span className="absolute left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 bg-brand lg:hidden" initial={{ top: "0%" }} animate={{ top: "100%" }} transition={pulse} />
          <motion.span className="absolute top-1/2 hidden size-2 -translate-x-1/2 -translate-y-1/2 bg-brand lg:block" initial={{ left: "0%" }} animate={{ left: "100%" }} transition={pulse} />
        </>
      )}
    </div>
  );
}

function StepCard({ n, title, on, dark = false, children }: { n: string; title: string; on: boolean; dark?: boolean; children: React.ReactNode }) {
  return (
    <div className={`relative flex h-full min-h-[172px] flex-col overflow-hidden rounded-[6px] border p-4 transition-[border-color,box-shadow] duration-500 ${dark ? "bg-ink text-ink-fg" : "bg-surface"} ${on ? "border-brand/60 shadow-[0_0_0_4px_rgb(255_112_0/0.12)]" : "border-line-strong/70"}`}>
      <span className={`font-mono text-[10.5px] uppercase tracking-[0.1em] ${on ? "text-brand-ink" : dark ? "text-ink-fg/60" : "text-muted"}`}>
        {n} · {title}
      </span>
      <div className="mt-3 min-h-[112px] flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

export function FlowDiagram() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.3 });
  const reduce = useReducedMotion();
  const [scene, setScene] = useState(0);
  const [t, setT] = useState(reduce ? STEP - 1 : 0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!inView || reduce || paused) return;
    const id = setInterval(() => {
      setT((v) => {
        if (v + 1 < STEP) return v + 1;
        setScene((s) => (s + 1) % SCENARIOS.length);
        return 0;
      });
    }, 100);
    return () => clearInterval(id);
  }, [inView, reduce, paused]);

  // The console shows the last three requests; this one joins once its
  // event reaches the console.
  const logged = (reduce ? STEP : t) >= 34;
  const n = SCENARIOS.length;
  const log = [0, 1, 2].map((k) => (scene - k - (logged ? 0 : 1) + n * 2) % n);

  const s = SCENARIOS[scene];
  const typed = reduce ? s.target.length : Math.min(s.target.length, Math.floor(t * 1.6));
  const at = (n: number) => reduce || t >= n;

  return (
    <div ref={ref} onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)}>
      <div role="tablist" aria-label="Example requests" className="flex flex-wrap gap-2">
        {SCENARIOS.map((x, i) => (
          <button
            key={x.chip}
            role="tab"
            type="button"
            aria-selected={i === scene}
            onClick={() => {
              setScene(i);
              setT(0);
            }}
            className={`relative overflow-hidden rounded-[6px] border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.06em] transition-colors ${i === scene ? "border-brand bg-surface text-fg" : "border-line-strong/70 bg-surface/60 text-muted hover:text-fg"}`}
          >
            {x.chip}
            {i === scene && !reduce && <span className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-brand" style={{ transform: `scaleX(${t / STEP})` }} />}
          </button>
        ))}
      </div>

      <div className="mt-6 grid items-stretch gap-0 lg:grid-cols-[1fr_40px_1.15fr_40px_1fr_40px_1fr]">
        <StepCard n="01" title="Request" on={!at(10)}>
          <p className="flex items-center gap-2 text-[12px] text-muted">
            <Laptop size={14} /> {s.device}
          </p>
          <div className="mt-3 flex items-center gap-2 rounded-[4px] border border-line bg-bg px-2.5 py-2 text-[13px] text-fg">
            <span className="font-mono text-[10px] uppercase text-muted">{s.verb}</span>
            <span className="truncate">{s.target.slice(0, typed)}</span>
            {typed < s.target.length && <Caret />}
          </div>
          <p className="mt-3 text-[11.5px] text-muted">Home Wi-Fi, office or hotel</p>
        </StepCard>
        <Wire key={`a${scene}${at(10)}`} active={at(10) && !at(17) && !reduce} />
        <StepCard n="02" title="Aavishield agent" on={at(12) && !at(28)}>
          <ul className="grid gap-2">
            {s.checks.map(([k, v], i) => {
              const done = at(14 + i * 4);
              return (
                <li key={k} className="flex h-[22px] items-center justify-between gap-3 text-[12.5px]">
                  <span className="flex items-center gap-2 text-fg">
                    <span className="grid size-[14px] place-items-center">
                      {done ? <CheckCircle size={14} weight="fill" className="text-brand" /> : at(12) ? <CircleNotch size={12} className="animate-spin text-muted" /> : <span className="size-2 bg-line-strong" />}
                    </span>
                    {k}
                  </span>
                  <span className={`truncate font-mono text-[10.5px] transition-opacity duration-300 ${done ? "text-fg-2 opacity-100" : "opacity-0"}`}>{v}</span>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-muted">
            <LockSimple size={11} /> Runs on the device
          </p>
        </StepCard>
        <Wire key={`b${scene}${at(26)}`} active={at(26) && !at(32) && !reduce} />
        <StepCard n="03" title="Decision" on={at(28) && !at(36)}>
          <div className="relative h-[112px] overflow-hidden">
            <AnimatePresence mode="wait" initial={false}>
              {at(28) ? (
                <motion.div key={`d${scene}`} {...POP} className="absolute inset-0">
                  <StatePill state={s.decision} />
                  <p className="mt-2 truncate text-[13px] text-fg">{s.target}</p>
                  <p className="mt-1 text-[11.5px] leading-snug text-muted">{s.reason}</p>
                </motion.div>
              ) : (
                <motion.p key={`w${scene}`} {...POP} className="absolute inset-0 flex items-center gap-2 font-mono text-[11px] text-muted">
                  <CircleNotch size={12} className="animate-spin" /> Waiting for the agent
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        </StepCard>
        <Wire key={`c${scene}${at(32)}`} active={at(32) && !at(36) && !reduce} />
        <StepCard n="04" title="Admin console" on={at(34)} dark>
          <ul className="grid h-[96px] grid-rows-3 content-start gap-1.5 overflow-hidden">
            {log.map((i, slot) => (
              <li key={slot} className="flex min-h-0 items-center justify-between gap-2 border-b border-ink-fg/10 pb-1.5 text-[12px] last:border-0">
                <span className="min-w-0 truncate text-ink-fg/90">{SCENARIOS[i].target}</span>
                <StatePill state={SCENARIOS[i].decision} />
              </li>
            ))}
          </ul>
        </StepCard>
      </div>
    </div>
  );
}
