"use client";

import { AppleLogo, CheckCircle, CircleNotch, DownloadSimple, FileCsv, FilePdf, FileXls, LinuxLogo, Robot, ShieldCheck, WindowsLogo } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { LiveDot, POP, StatePill, useTimeline } from "../landing/visuals";
import { FeedPanel, LineChart } from "./kit";
import { Big, Panel, PanelCard, Row, Tick, Toggle, fmt, useProgress } from "./panel";

/*
 * Panels for the console's shared screens: overview, DLP, applications,
 * reports, devices, sign-in, installer download, settings, assistant and
 * monitoring, plus the activity feeds. Fictional demo data throughout.
 */


/* Security overview: devices, coverage, incidents by control and what needs a fix. */
const BY_CONTROL = [
  { c: "Web Gateway", n: 1284 },
  { c: "App Control", n: 143 },
  { c: "DLP", n: 86 },
  { c: "VPN Control", n: 57 },
  { c: "Malware", n: 23 },
];

// How often (in 100ms ticks) each control logs one more incident while live.
const RATE = [7, 23, 31, 43, 71];

export function OverviewPanel() {
  const { ref, p } = useProgress(1600);
  // `live` keeps climbing while on screen (a long period, so it never resets
  // in practice); `loop` drives the short story of a device getting fixed.
  const { ref: liveRef, t: live } = useTimeline(60000, 0);
  const { ref: loopRef, t: loop } = useTimeline(90, 0);
  const counting = p >= 1;
  const counts = BY_CONTROL.map((r, i) => r.n + (counting ? Math.floor(live / RATE[i]) : 0));
  const total = counts.reduce((a, b) => a + b, 0);
  const fixed = counting && loop >= 35 && loop < 70; // Rohan's firewall is back on
  const online = counting && loop >= 50 && loop < 80 ? 40 : 39;
  return (
    <div ref={ref} className="w-full">
      <div ref={liveRef}>
        <div ref={loopRef}>
          <Panel context="Security overview · live" className="md:grid-cols-2">
            <PanelCard className="flex flex-col">
              <p className="flex items-center gap-2 text-[13px] text-muted">
                Devices online <LiveDot />
              </p>
              <Big className="mt-2">
                {counting ? <Tick value={online} /> : fmt(39 * p)}
                <span className="text-muted"> / 40</span>
              </Big>
              <div className="mt-6 grid grid-cols-2 border-y border-line py-4">
                <div className="border-r border-line pr-4">
                  <p className="text-[12.5px] text-muted">Employees covered</p>
                  <p className="mt-1.5 font-display text-[1.5rem] leading-none tracking-[-0.02em] text-fg tabular-nums">{fmt(97 * p)}%</p>
                </div>
                <div className="pl-5">
                  <p className="text-[12.5px] text-muted">Need a fix</p>
                  <p className="mt-1.5 font-display text-[1.5rem] leading-none tracking-[-0.02em] text-fg tabular-nums">{counting ? <Tick value={fixed ? 3 : 4} /> : fmt(4 * p)}</p>
                </div>
              </div>
              <p className="mt-4 text-[13px] text-muted">Needs attention</p>
              <ul className="mt-1">
                {[
                  { t: "ThinkPad · Rohan", s: fixed ? "Firewall turned back on" : "Firewall turned off", ok: fixed },
                  { t: "MacBook · Priya", s: "Disk encryption off", ok: false },
                ].map((r) => (
                  <li key={r.t} className="flex items-center justify-between gap-3 border-b border-line py-2.5 last:border-b-0">
                    <span className="min-w-0">
                      <span className="block truncate text-[13.5px] text-fg">{r.t}</span>
                      <span className="text-[12px] text-muted">{r.s}</span>
                    </span>
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.span key={r.ok ? "ok" : "flag"} {...POP}>
                        {r.ok ? (
                          <span className="ui-pill inline-flex items-center gap-1 rounded-[4px] bg-[#e8f5ec] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-[#1f7a3d]">
                            <CheckCircle size={11} weight="fill" /> Fixed
                          </span>
                        ) : (
                          <StatePill state="flagged" />
                        )}
                      </motion.span>
                    </AnimatePresence>
                  </li>
                ))}
              </ul>
            </PanelCard>
            <PanelCard className="flex flex-col">
              <p className="text-[13px] text-muted">Incidents by control</p>
              <Big className="mt-2">{counting ? <Tick value={fmt(total)} /> : fmt(1593 * p)}</Big>
              <ul className="mt-6 grid gap-3.5">
                {BY_CONTROL.map((r, i) => (
                  <li key={r.c}>
                    <div className="flex items-center justify-between text-[13px]">
                      <span className="text-fg">{r.c}</span>
                      <span className="tabular-nums text-muted">{counting ? <Tick value={fmt(counts[i])} /> : fmt(r.n * p)}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-bg-2">
                      <div data-bar className="h-full rounded-full bg-brand transition-[width] duration-700 ease-out" style={{ width: `${Math.max(3, (counts[i] / counts[0]) * 100) * p}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </PanelCard>
          </Panel>
        </div>
      </div>
    </div>
  );
}

/* DLP: one incident at a time, with who, where, what was found and the risk. */
const INCIDENTS = [
  { file: "Q3-salaries.xlsx", who: "Priya · Finance", to: "ChatGPT", found: ["Salary data", "PAN × 12"], risk: 86 },
  { file: "deploy.env", who: "Rohan · Engineering", to: "Microsoft Teams", found: ["API key", "Database URL"], risk: 92 },
  { file: "IMG_2041.jpg", who: "Arjun · Sales", to: "WhatsApp Web", found: ["Aadhaar (OCR)"], risk: 74 },
];

export function DlpIncidentPanel() {
  const STEP = 45;
  const { ref, t } = useTimeline(INCIDENTS.length * STEP, 30);
  const i = Math.floor(t / STEP);
  const x = INCIDENTS[i];
  return (
    <div ref={ref} className="w-full">
      <Panel context={`DLP incidents · ${i + 1} of ${INCIDENTS.length}`}>
        <PanelCard>
          <AnimatePresence mode="wait">
            <motion.div key={x.file} {...POP}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[13px] text-muted">Sent to {x.to}</p>
                  <p className="mt-2 truncate font-display text-[1.7rem] leading-none tracking-[-0.03em] text-fg sm:text-[2rem]">{x.file}</p>
                </div>
                <StatePill state="flagged" />
              </div>
              <div className="mt-5 border-t border-line pt-2">
                <Row label="Employee" value={x.who} />
                <Row label="Detected" value={<span className="flex flex-wrap justify-end gap-1.5">{x.found.map((f) => <span key={f} className="rounded-[4px] bg-brand-soft px-1.5 py-0.5 font-mono text-[11px] text-brand-ink">{f}</span>)}</span>} />
                <Row label="Action" value="Recorded, not blocked" />
              </div>
            </motion.div>
          </AnimatePresence>
        </PanelCard>
        <PanelCard>
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-muted">Risk score</span>
            <span className="font-display text-[1.5rem] leading-none tracking-[-0.02em] text-fg tabular-nums"><Tick value={x.risk} /></span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-bg-2">
            <motion.div key={x.file} initial={{ width: 0 }} animate={{ width: `${x.risk}%` }} transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }} className={`h-full rounded-full ${x.risk >= 85 ? "bg-danger" : "bg-brand"}`} />
          </div>
        </PanelCard>
      </Panel>
    </div>
  );
}

/* Applications: the inventory with two switches per app. */
const APPS = [
  { n: "AnyDesk", v: "Remote access · 6 devices", net: false, app: true },
  { n: "uTorrent", v: "File sharing · 2 devices", net: true, app: true },
  { n: "Dropbox", v: "Personal sync · 9 devices", net: true, app: false },
  { n: "Slack", v: "Approved · 40 devices", net: false, app: false },
];

export function AppsPanel() {
  const { ref, t } = useTimeline(60, 59);
  return (
    <div ref={ref} className="w-full">
      <Panel context="Applications · 40 devices">
        <PanelCard>
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[13px] text-muted">Installed apps</p>
              <Big className="mt-2">212</Big>
            </div>
            <div className="flex gap-6 text-right font-mono text-[10px] uppercase tracking-[0.06em] text-muted">
              <span className="w-8">Network</span>
              <span className="w-8">App</span>
            </div>
          </div>
          <ul className="mt-5 border-t border-line">
            {APPS.map((a, i) => (
              <li key={a.n} className="flex items-center gap-6 border-b border-line py-3.5 last:border-b-0">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] text-fg">{a.n}</span>
                  <span className="mt-0.5 block truncate text-[12px] text-muted">{a.v}</span>
                </span>
                <Toggle on={a.net && t >= 6 + i * 8} />
                <Toggle on={a.app && t >= 10 + i * 8} />
              </li>
            ))}
          </ul>
        </PanelCard>
      </Panel>
    </div>
  );
}

/* Reports: the executive summary, ready to export. */
export function ReportsPanel() {
  const { ref, p } = useProgress(1600);
  // After the chart draws in, the highlight steps through the weeks, and an
  // export runs: Exporting, then Saved, then back to idle.
  const { ref: loopRef, t } = useTimeline(100, 0);
  const drawn = p >= 1;
  const week = drawn ? Math.floor(t / 25) % 4 : null;
  const exportState = !drawn || t < 40 ? "idle" : t < 60 ? "busy" : t < 85 ? "done" : "idle";
  return (
    <div ref={ref} className="w-full">
      <div ref={loopRef}>
      <Panel context="Executive summary · October">
        <PanelCard>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[13px] text-muted">Incidents this month</p>
              <Big className="mt-2">{fmt(5862 * p)}</Big>
            </div>
            <span className="rounded-[4px] bg-[#e8f5ec] px-1.5 py-0.5 font-mono text-[11px] text-[#1f7a3d]">−14% vs Sept</span>
          </div>
          <div className="mt-6">
            <LineChart main={[1702, 1488, 1390, 1282]} second={[1980, 1850, 1720, 1610]} labels={["Week 1", "Week 2", "Week 3", "Week 4"]} p={p} height={130} auto={week} />
          </div>
          <div className="mt-3 flex gap-6 text-[12.5px] text-muted">
            <span className="flex items-center gap-2"><span className="h-0.5 w-4 rounded-full bg-brand" /> October</span>
            <span className="flex items-center gap-2"><span className="w-4 border-t border-dashed border-muted" /> September</span>
          </div>
        </PanelCard>
        <PanelCard>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13px] text-muted">Export</span>
            <span className="flex gap-2">
              {[{ I: FilePdf, l: "PDF" }, { I: FileXls, l: "Excel" }, { I: FileCsv, l: "CSV" }].map(({ I, l }, i) => {
                const active = i === 0 && exportState !== "idle";
                return (
                  <span key={l} className={`flex items-center gap-1.5 rounded-[4px] border px-2.5 py-1.5 text-[12.5px] transition-colors duration-300 ${active ? "border-brand/40 bg-brand-soft text-fg" : "border-line text-fg"}`}>
                    {active && exportState === "busy" ? (
                      <CircleNotch size={14} className="animate-spin text-brand-ink" />
                    ) : active && exportState === "done" ? (
                      <CheckCircle size={14} weight="fill" className="text-[#1f7a3d]" />
                    ) : (
                      <I size={14} className="text-brand-ink" />
                    )}
                    {active ? (exportState === "busy" ? "Exporting" : "Saved") : l}
                  </span>
                );
              })}
            </span>
          </div>
        </PanelCard>
      </Panel>
      </div>
    </div>
  );
}

/* Device compliance report: who is out of baseline, and why. */
const NONCOMPLIANT = [
  { d: "ThinkPad · Rohan", issue: "Firewall off" },
  { d: "Dell XPS · Meera", issue: "Firewall off" },
  { d: "MacBook · Priya", issue: "Encryption off" },
  { d: "HP EliteBook · Arjun", issue: "Updates pending" },
];

export function CompliancePanel() {
  const { ref, p } = useProgress(1400);
  return (
    <div ref={ref} className="w-full">
      <Panel context="Device compliance report">
        <PanelCard>
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[13px] text-muted">Compliant devices</p>
              <Big className="mt-2">
                {fmt(36 * p)}
                <span className="text-muted"> / 40</span>
              </Big>
            </div>
            <span className="flex items-center gap-1.5 text-[12.5px] text-muted"><FilePdf size={15} className="text-brand-ink" /> Ready for the auditor</span>
          </div>
          <div className="mt-5 h-2 overflow-hidden rounded-full bg-bg-2">
            <div data-bar className="h-full rounded-full bg-brand" style={{ width: `${90 * p}%` }} />
          </div>
          <ul className="mt-5 border-t border-line">
            {NONCOMPLIANT.map((r) => (
              <li key={r.d} className="flex items-center justify-between gap-3 border-b border-line py-3 last:border-b-0">
                <span className="truncate text-[14px] text-fg">{r.d}</span>
                <span className="shrink-0 rounded-[4px] bg-[#fdecea] px-1.5 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.06em] text-danger">{r.issue}</span>
              </li>
            ))}
          </ul>
        </PanelCard>
      </Panel>
    </div>
  );
}

/* Employee risk report: who needs a conversation. */
const RISK = [
  { n: "Rohan · Engineering", c: 41 },
  { n: "Priya · Finance", c: 28 },
  { n: "Arjun · Sales", c: 19 },
  { n: "Meera · Support", c: 11 },
];

export function RiskPanel() {
  const { ref, p } = useProgress(1400);
  return (
    <div ref={ref} className="w-full">
      <Panel context="Employee risk report">
        <PanelCard>
          <p className="text-[13px] text-muted">Employees with incidents</p>
          <Big className="mt-2">{fmt(14 * p)}</Big>
          <ul className="mt-6 grid gap-4 border-t border-line pt-5">
            {RISK.map((r, i) => (
              <li key={r.n} className="grid grid-cols-[18px_1fr] gap-3">
                <span className="font-mono text-[11px] text-brand-ink">{i + 1}</span>
                <span>
                  <span className="flex items-center justify-between text-[13.5px]">
                    <span className="text-fg">{r.n}</span>
                    <span className="tabular-nums text-muted">{fmt(r.c * p)} incidents</span>
                  </span>
                  <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-bg-2">
                    <span data-bar className="block h-full rounded-full bg-brand" style={{ width: `${(r.c / RISK[0].c) * 100 * p}%` }} />
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </PanelCard>
      </Panel>
    </div>
  );
}

/* Devices: the inventory with OS, agent version and posture score. */
const DEVICES = [
  { d: "MacBook Pro · Priya", os: "macOS 15", score: 96, on: true },
  { d: "ThinkPad · Rohan", os: "Windows 11", score: 71, on: true },
  { d: "Dell XPS · Meera", os: "Ubuntu 24.04", score: 88, on: true },
  { d: "HP EliteBook · Arjun", os: "Windows 10", score: 79, on: false },
];

export function DevicesPanel() {
  const { ref, p } = useProgress(1400);
  return (
    <div ref={ref} className="w-full">
      <Panel context="Devices">
        <PanelCard>
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[13px] text-muted">Enrolled devices</p>
              <Big className="mt-2">
                {fmt(40 * p)}
                <span className="text-muted"> · 39 online</span>
              </Big>
            </div>
            <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted">Posture</span>
          </div>
          <ul className="mt-5 border-t border-line">
            {DEVICES.map((r) => (
              <li key={r.d} className="flex items-center gap-4 border-b border-line py-3 last:border-b-0">
                <span className={`size-2 shrink-0 rounded-full ${r.on ? "bg-[#1f7a3d]" : "bg-line-strong"}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] text-fg">{r.d}</span>
                  <span className="text-[12px] text-muted">{r.os} · agent up to date</span>
                </span>
                <span className={`font-display text-[1.25rem] tabular-nums ${r.score < 80 ? "text-danger" : "text-fg"}`}>{fmt(r.score * p)}</span>
              </li>
            ))}
          </ul>
        </PanelCard>
      </Panel>
    </div>
  );
}

/* Sign-in: password, then a second factor. */
export function SignInPanel() {
  const { ref, t } = useTimeline(70, 69);
  const code = "482913".slice(0, Math.max(0, Math.min(6, Math.floor((t - 14) / 3))));
  const ok = t >= 36;
  return (
    <div ref={ref} className="w-full">
      <Panel context="Admin sign-in">
        <PanelCard>
          <p className="text-[13px] text-muted">Step 2 of 2</p>
          <p className="mt-2 font-display text-[1.7rem] leading-tight tracking-[-0.03em] text-fg">Enter your code</p>
          <p className="mt-1 text-[13px] text-muted">From your authenticator app, or the code we emailed.</p>
          <div className="mt-6 grid grid-cols-6 gap-2">
            {Array.from({ length: 6 }, (_, i) => (
              <span key={i} className={`grid h-12 place-items-center rounded-[6px] border font-display text-[1.4rem] tabular-nums transition-colors ${code[i] ? "border-brand bg-brand-soft text-fg" : "border-line bg-bg text-muted"}`}>
                {code[i] ?? ""}
              </span>
            ))}
          </div>
          <div className="mt-5 flex min-h-[28px] items-center gap-2 text-[13px]">
            <AnimatePresence>
              {ok && (
                <motion.span {...POP} className="flex items-center gap-1.5 text-[#1f7a3d]">
                  <CheckCircle size={16} weight="fill" /> Verified. Signing you in
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </PanelCard>
      </Panel>
    </div>
  );
}

/* Employee portal: one-click installers, then the device enrolls itself. */
const OS = [
  { I: AppleLogo, n: "macOS" },
  { I: WindowsLogo, n: "Windows" },
  { I: LinuxLogo, n: "Linux" },
];

export function DownloadPanel() {
  const { ref, t } = useTimeline(80, 79);
  const prog = Math.min(100, Math.max(0, (t - 10) * 4));
  const enrolled = t >= 40;
  return (
    <div ref={ref} className="w-full">
      <Panel context="Employee portal">
        <PanelCard>
          <p className="text-[13px] text-muted">Install Aavishield</p>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {OS.map(({ I, n }, i) => (
              <span key={n} className={`flex flex-col items-center gap-2 rounded-[6px] border px-2 py-4 text-[13px] ${i === 0 ? "border-brand bg-brand-soft text-fg" : "border-line text-muted"}`}>
                <I size={22} weight={i === 0 ? "fill" : "regular"} className={i === 0 ? "text-brand-ink" : ""} />
                {n}
              </span>
            ))}
          </div>
          <div className="mt-5 flex items-center gap-3">
            <DownloadSimple size={16} className="shrink-0 text-brand-ink" />
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-2">
              <div className="h-full rounded-full bg-brand transition-[width] duration-100" style={{ width: `${prog}%` }} />
            </div>
            <span className="w-10 text-right font-mono text-[11px] tabular-nums text-muted">{prog}%</span>
          </div>
        </PanelCard>
        <PanelCard>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[13px] text-muted">This device</p>
              <p className="mt-1 text-[14px] text-fg">MacBook Pro · Priya</p>
            </div>
            <AnimatePresence mode="wait">
              {enrolled ? (
                <motion.span key="ok" {...POP} className="flex items-center gap-1.5 rounded-[4px] bg-[#e8f5ec] px-2 py-1 font-mono text-[10.5px] uppercase tracking-[0.06em] text-[#1f7a3d]">
                  <ShieldCheck size={13} weight="fill" /> Enrolled
                </motion.span>
              ) : (
                <motion.span key="wait" {...POP} className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-muted">Installing</motion.span>
              )}
            </AnimatePresence>
          </div>
        </PanelCard>
      </Panel>
    </div>
  );
}

/* Organisation settings: the security switches. */
export function SettingsPanel() {
  const { ref, t } = useTimeline(50, 49);
  return (
    <div ref={ref} className="w-full">
      <Panel context="Settings · Security">
        <PanelCard>
          <p className="text-[13px] text-muted">Sign-in protection</p>
          <ul className="mt-3 border-t border-line">
            {[
              { n: "Two-factor for every admin", s: "Emailed code or authenticator app", on: true },
              { n: "Require an authenticator app", s: "Applies to the whole organisation", on: t >= 12 },
              { n: "Email me on high-risk findings", s: "DLP, malware and bypass attempts", on: true },
            ].map((r) => (
              <li key={r.n} className="flex items-center gap-4 border-b border-line py-3.5 last:border-b-0">
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] text-fg">{r.n}</span>
                  <span className="text-[12px] text-muted">{r.s}</span>
                </span>
                <Toggle on={r.on} />
              </li>
            ))}
          </ul>
        </PanelCard>
        <PanelCard>
          <p className="text-[13px] text-muted">Signed-in sessions</p>
          <div className="mt-2">
            <Row label="Chrome · Mumbai" value="This session" />
            <Row label="Safari · Pune" value={<span className="text-brand-ink">Sign out</span>} />
          </div>
        </PanelCard>
      </Panel>
    </div>
  );
}

/* The assistant: questions answered from live data. */
const QA = [
  { q: "Which laptops have their firewall off?", a: "2 devices: ThinkPad · Rohan and Dell XPS · Meera. Both reported it today." },
  { q: "What did DLP flag this week?", a: "86 findings, 9 high risk. Most were salary data sent to AI tools." },
];

export function AssistantPanel() {
  const STEP = 60;
  const { ref, t } = useTimeline(QA.length * STEP, 50);
  const i = Math.floor(t / STEP);
  const local = t % STEP;
  const { q, a } = QA[i];
  const typed = q.slice(0, Math.min(q.length, local * 2));
  return (
    <div ref={ref} className="w-full">
      <Panel context="Assistant · live data">
        <PanelCard>
          <div className="ml-auto min-h-[40px] w-fit max-w-[88%] rounded-[8px] rounded-br-[2px] bg-brand px-3.5 py-2.5 text-[14px] text-on-brand">{typed || " "}</div>
          <div className="mt-3 min-h-[86px]">
            <AnimatePresence mode="wait">
              {local >= 28 && (
                <motion.div key={`a${i}`} {...POP} className="flex max-w-[92%] gap-3 rounded-[8px] rounded-bl-[2px] bg-bg-2 px-3.5 py-3 text-[14px] leading-relaxed text-fg">
                  <Robot size={18} className="mt-0.5 shrink-0 text-brand-ink" />
                  {a}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </PanelCard>
      </Panel>
    </div>
  );
}

/* Activity monitoring for one employee: time, a day timeline and blurred screenshots. */
const DAY = [
  { w: 18, c: "bg-brand" },
  { w: 9, c: "bg-brand-tint" },
  { w: 26, c: "bg-brand" },
  { w: 6, c: "bg-bg-2" },
  { w: 14, c: "bg-brand-tint" },
  { w: 21, c: "bg-brand" },
];

export function MonitoringPanel() {
  const { ref, p } = useProgress(1600);
  return (
    <div ref={ref} className="w-full">
      <Panel context="Activity · Priya · today">
        <PanelCard>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[13px] text-muted">Tracked time</p>
              <Big className="mt-2">7h 42m</Big>
            </div>
            <div>
              <p className="text-[13px] text-muted">Active time</p>
              <Big className="mt-2">6h 10m</Big>
            </div>
          </div>
          <div className="mt-6 flex h-3 overflow-hidden rounded-full bg-bg-2">
            {DAY.map((b, i) => (
              <span key={i} className={`${b.c} h-full border-r border-surface last:border-r-0`} style={{ width: `${b.w * p}%` }} />
            ))}
          </div>
          <div className="mt-2 flex justify-between font-mono text-[10px] text-muted">
            <span>9 am</span>
            <span>1 pm</span>
            <span>6 pm</span>
          </div>
        </PanelCard>
        <PanelCard>
          <div className="flex items-center justify-between">
            <p className="text-[13px] text-muted">Screenshots</p>
            <span className="text-[12px] text-muted">Blurred · kept 30 days</span>
          </div>
          <div className="mt-3 grid grid-cols-4 gap-2">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="pixel-grid aspect-[16/10] rounded-[4px] border border-line bg-brand-soft opacity-80 blur-[1px]" style={{ opacity: p > i * 0.2 ? 0.85 : 0, transition: "opacity .4s" }} />
            ))}
          </div>
        </PanelCard>
      </Panel>
    </div>
  );
}

/* Feeds: the activity log, filtered views, access requests, teams and employees. */
export const ActivityPanel = () => (
  <FeedPanel
    context="Activity · all controls"
    label="Events today"
    base={318}
    aside="Every control, one feed"
    rows={[
      { title: "bet365.com", sub: "Web Gateway · Gambling · Rohan", state: "blocked" },
      { title: "Q3-salaries.xlsx → ChatGPT", sub: "DLP · Salary data · Priya", state: "flagged" },
      { title: "AnyDesk", sub: "Application Control · Arjun", state: "blocked" },
      { title: "invoice_0932.zip", sub: "Malware Scanning · Risk 94 · Meera", state: "blocked" },
      { title: "NordVPN", sub: "VPN Control · Rohan", state: "blocked" },
    ]}
  />
);

export const ActivityDlpPanel = () => (
  <FeedPanel
    context="Activity · DLP"
    label="Findings this week"
    base={81}
    aside="Recorded, never blocked"
    rows={[
      { title: "Q3-salaries.xlsx → ChatGPT", sub: "Salary data · Priya", state: "flagged" },
      { title: "deploy.env → Teams", sub: "API key · Rohan", state: "flagged" },
      { title: "IMG_2041.jpg → WhatsApp Web", sub: "Aadhaar via OCR · Arjun", state: "flagged" },
      { title: "contract-acme.pdf → Gmail", sub: "Contract · Meera", state: "flagged" },
      { title: "customers.csv → OneDrive", sub: "Card numbers · Priya", state: "flagged" },
    ]}
  />
);

export const ActivityDownloadsPanel = () => (
  <FeedPanel
    context="Activity · Malware Scanning"
    label="Malicious files blocked"
    base={18}
    aside="Stopped before reaching disk"
    rows={[
      { title: "invoice_0932.zip", sub: "Trojan downloader · Meera", right: "94" },
      { title: "crack-setup.exe", sub: "Bundled malware · Rohan", right: "91" },
      { title: "Q4-report.xlsm", sub: "Macro dropper · Arjun", right: "82" },
      { title: "free-pdf-tool.dmg", sub: "Adware · Priya", right: "77" },
      { title: "scan_0412.html", sub: "Credential phishing · Meera", right: "88" },
    ]}
  />
);

export const ActivityPosturePanel = () => (
  <FeedPanel
    context="Activity · Device Posture"
    label="Posture alerts this week"
    base={5}
    aside="With the fix for each OS"
    rows={[
      { title: "Firewall turned off", sub: "ThinkPad · Rohan · Windows 11", state: "flagged" },
      { title: "OS updates pending", sub: "HP EliteBook · Arjun · Windows 10", state: "flagged" },
      { title: "Disk encryption off", sub: "MacBook · Priya · macOS 15", state: "flagged" },
      { title: "Firewall turned off", sub: "Dell XPS · Meera · Ubuntu", state: "flagged" },
    ]}
  />
);

export const AccessRequestsPanel = () => (
  <FeedPanel
    context="Access requests"
    label="Waiting for review"
    base={0}
    aside="Each with the employee's reason"
    rows={[
      { title: "figma.com", sub: "Meera · “Design review with a client”", state: "allowed" },
      { title: "reddit.com", sub: "Rohan · “Debugging thread”", state: "allowed" },
      { title: "1337x.to", sub: "Arjun · “Need a movie for a pitch”", state: "blocked" },
      { title: "canva.com", sub: "Priya · “Social posts for launch”", state: "allowed" },
    ]}
  />
);

export const TeamsPanel = () => (
  <FeedPanel
    context="Teams"
    label="Teams"
    base={2}
    aside="Use teams to scope policy"
    rows={[
      { title: "Engineering", sub: "Approved AI tools only", right: "14 people" },
      { title: "Finance", sub: "Bank portal allowed", right: "6 people" },
      { title: "Sales", sub: "Company-wide policy", right: "11 people" },
      { title: "Support", sub: "Company-wide policy", right: "9 people" },
    ]}
  />
);

export const EmployeesPanel = () => (
  <FeedPanel
    context="Employees · import from CSV"
    label="Employees"
    base={36}
    aside="Add by hand or import a CSV"
    rows={[
      { title: "Priya Shah", sub: "Finance · Controller", right: "Active" },
      { title: "Rohan Mehta", sub: "Engineering · Backend", right: "Active" },
      { title: "Arjun Rao", sub: "Sales · Account exec", right: "Invited" },
      { title: "Meera Iyer", sub: "Support · Team lead", right: "Active" },
    ]}
  />
);


export const InventoryPanel = () => (
  <FeedPanel
    context="Applications · inventory"
    label="Apps found on 40 devices"
    base={208}
    aside="macOS, Windows and Linux"
    rows={[
      { title: "AnyDesk 8.1", sub: "ThinkPad · Rohan · installed 3 Oct", right: "High risk" },
      { title: "uTorrent 3.6", sub: "HP EliteBook · Arjun · installed 9 Oct", right: "High risk" },
      { title: "Dropbox 205", sub: "MacBook · Priya · installed 12 Sep", right: "Medium" },
      { title: "Figma 124", sub: "Dell XPS · Meera · installed 1 Aug", right: "Low" },
    ]}
  />
);

export const AppAttemptsPanel = () => (
  <FeedPanel
    context="Activity · Application Control"
    label="Blocked launches today"
    base={17}
    aside="Tied to the person and device"
    rows={[
      { title: "AnyDesk", sub: "App block · ThinkPad · Rohan · 14:22", state: "blocked" },
      { title: "uTorrent", sub: "App block · HP EliteBook · Arjun · 15:03", state: "blocked" },
      { title: "Dropbox", sub: "Network block · MacBook · Priya · 15:41", state: "blocked" },
      { title: "AnyDesk", sub: "App block · ThinkPad · Rohan · 16:08", state: "blocked" },
    ]}
  />
);

export const VpnAttemptsPanel = () => (
  <FeedPanel
    context="Activity · VPN Control"
    label="Bypass attempts today"
    base={6}
    aside="Blocked by default, no setup"
    rows={[
      { title: "NordVPN", sub: "VPN app · ThinkPad · Rohan", state: "blocked" },
      { title: "Proxy extension", sub: "Chrome extension · Arjun", state: "blocked" },
      { title: "protonvpn-setup.exe", sub: "VPN installer · Meera", state: "blocked" },
      { title: "hidemy.name", sub: "Proxy site · Priya", state: "blocked" },
    ]}
  />
);

export const MaliciousSitesPanel = () => (
  <FeedPanel
    context="Activity · Web Gateway"
    label="Malicious sites blocked"
    base={37}
    aside="Phishing and malware domains"
    rows={[
      { title: "micros0ft-login.com", sub: "Phishing · Meera", state: "blocked" },
      { title: "free-crack-tools.net", sub: "Malware · Rohan", state: "blocked" },
      { title: "docusign-review.co", sub: "Phishing · Priya", state: "blocked" },
      { title: "pdf-convert-now.io", sub: "Malware · Arjun", state: "blocked" },
    ]}
  />
);

/* Periodic screenshots for one monitored device, blurred by policy. */
export function ScreenshotGridPanel() {
  const { ref, t } = useTimeline(60, 59);
  const times = ["10:12", "10:22", "10:32", "10:42", "10:52", "11:02"];
  return (
    <div ref={ref} className="w-full">
      <Panel context="Screenshots · Priya · today">
        <PanelCard>
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[13px] text-muted">Captured today</p>
              <Big className="mt-2"><Tick value={42 + times.filter((_, i) => t >= 6 + i * 7).length} /></Big>
            </div>
            <p className="max-w-[18ch] text-right text-[12.5px] text-muted">Every 10 minutes, blurred</p>
          </div>
          <div className="mt-5 grid grid-cols-3 gap-2 border-t border-line pt-5">
            {times.map((tm, i) => (
              <div key={tm} className="transition-opacity duration-500" style={{ opacity: t >= 6 + i * 7 ? 1 : 0.15 }}>
                <span className="pixel-grid block aspect-[16/10] rounded-[4px] border border-line bg-brand-soft blur-[1.5px]" />
                <span className="mt-1 block font-mono text-[10px] text-muted">{tm}</span>
              </div>
            ))}
          </div>
        </PanelCard>
      </Panel>
    </div>
  );
}

/* Monitoring settings: interval, idle threshold, blur and retention. */
export function MonitoringSettingsPanel() {
  const { ref, t } = useTimeline(50, 49);
  return (
    <div ref={ref} className="w-full">
      <Panel context="Settings · Monitoring">
        <PanelCard>
          <p className="text-[13px] text-muted">Screenshot policy</p>
          <div className="mt-2 border-t border-line pt-1">
            <Row label="Interval" value="Every 10 minutes" />
            <Row label="Idle threshold" value="5 minutes" />
            <Row label="Keep for" value="30 days" />
          </div>
        </PanelCard>
        <PanelCard>
          <ul>
            {[
              { n: "Blur screenshots", s: "Text is unreadable at a glance", on: t >= 10 },
              { n: "Only admins with permission can delete", s: "Sessions and screenshots", on: true },
            ].map((r) => (
              <li key={r.n} className="flex items-center gap-4 border-b border-line py-3 last:border-b-0">
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] text-fg">{r.n}</span>
                  <span className="text-[12px] text-muted">{r.s}</span>
                </span>
                <Toggle on={r.on} />
              </li>
            ))}
          </ul>
        </PanelCard>
      </Panel>
    </div>
  );
}

/* Malware scanning: a download streams through the scanner and gets a verdict. */
const FILES = [
  { f: "invoice_0932.zip", from: "mail-attachments.net", risk: 94, verdict: "Trojan downloader" },
  { f: "crack-setup.exe", from: "free-crack-tools.net", risk: 91, verdict: "Bundled malware" },
  { f: "brochure.pdf", from: "drive.google.com", risk: 4, verdict: "Clean" },
];

export function MalwareScanPanel() {
  const STEP = 50;
  const { ref, t } = useTimeline(FILES.length * STEP, 45);
  const i = Math.floor(t / STEP);
  const local = t % STEP;
  const x = FILES[i];
  const scan = Math.min(100, local * 5);
  const done = scan >= 100;
  const bad = x.risk >= 50;
  const R = 34;
  const C = 2 * Math.PI * R;
  return (
    <div ref={ref} className="w-full">
      <Panel context="Malware Scanning · in flight">
        <PanelCard>
          <AnimatePresence mode="wait">
            <motion.div key={x.f} {...POP} className="flex items-center gap-5">
              <svg viewBox="0 0 80 80" className="size-20 shrink-0 -rotate-90" aria-hidden>
                <circle cx="40" cy="40" r={R} fill="none" stroke="var(--bg-2)" strokeWidth="7" />
                <circle cx="40" cy="40" r={R} fill="none" stroke={done ? (bad ? "var(--danger)" : "#1f7a3d") : "var(--brand)"} strokeWidth="7" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - (done ? x.risk : scan) / 100)} style={{ transition: "stroke-dashoffset .3s ease, stroke .3s" }} />
              </svg>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-muted">{done ? "Risk score" : "Scanning while it downloads"}</p>
                <p className="mt-1 font-display text-[2.2rem] leading-none tracking-[-0.03em] text-fg tabular-nums">{done ? <Tick value={x.risk} /> : `${scan}%`}</p>
              </div>
              {done && <StatePill state={bad ? "blocked" : "allowed"} />}
            </motion.div>
          </AnimatePresence>
          <div className="mt-5 border-t border-line pt-2">
            <Row label="File" value={<span className="font-mono text-[12.5px]">{x.f}</span>} />
            <Row label="From" value={x.from} />
            <Row label="Verdict" value={done ? x.verdict : "…"} />
          </div>
        </PanelCard>
      </Panel>
    </div>
  );
}

/* Device posture: one score ring and the four checks behind it. */
const CHECKS4 = [
  { n: "Disk encryption", ok: true },
  { n: "Firewall", ok: false },
  { n: "OS up to date", ok: true },
  { n: "Antivirus present", ok: true },
];

export function PostureRingPanel() {
  const { ref, p } = useProgress(1600);
  const R = 46;
  const C = 2 * Math.PI * R;
  const score = 71;
  return (
    <div ref={ref} className="w-full">
      <Panel context="Device Posture · ThinkPad · Rohan">
        <PanelCard>
          <div className="flex items-center gap-6">
            <div className="relative size-28 shrink-0">
              <svg viewBox="0 0 110 110" className="size-full -rotate-90" aria-hidden>
                <circle cx="55" cy="55" r={R} fill="none" stroke="var(--bg-2)" strokeWidth="9" />
                <circle cx="55" cy="55" r={R} fill="none" stroke="var(--brand)" strokeWidth="9" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - (score / 100) * p)} />
              </svg>
              <span className="absolute inset-0 grid place-items-center font-display text-[1.9rem] tracking-[-0.03em] text-fg tabular-nums">{fmt(score * p)}</span>
            </div>
            <ul className="grid flex-1 gap-2.5">
              {CHECKS4.map((c, i) => (
                <li key={c.n} className="flex items-center justify-between gap-3 text-[13.5px]" style={{ opacity: p > i * 0.2 ? 1 : 0.2, transition: "opacity .4s" }}>
                  <span className="text-fg">{c.n}</span>
                  <span className={`ui-pill rounded-[4px] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] ${c.ok ? "bg-[#e8f5ec] text-[#1f7a3d]" : "bg-[#fdecea] text-danger"}`}>{c.ok ? "On" : "Off"}</span>
                </li>
              ))}
            </ul>
          </div>
        </PanelCard>
        <PanelCard>
          <div className="flex items-center justify-between gap-3 text-[13px]">
            <span className="text-muted">Fix for Windows 11</span>
            <span className="text-fg">Turn on Windows Defender Firewall</span>
          </div>
        </PanelCard>
      </Panel>
    </div>
  );
}

/* Setup: a feature's steps tick off one by one until the policy is live. */
export function SetupPanel({ name, steps }: { name: string; steps: string[] }) {
  const STEP = 16;
  const end = 6 + steps.length * STEP;
  const { ref, t } = useTimeline(end + 40, end + 39);
  const done = steps.filter((_, i) => t >= 6 + (i + 1) * STEP).length;
  const running = t >= 6 && done < steps.length ? done : -1;
  const live = done === steps.length;
  return (
    <div ref={ref} className="w-full">
      <Panel context={`Setup · ${name}`}>
        <PanelCard>
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[13px] text-muted">Setup progress</p>
              <Big className="mt-2">
                <Tick value={done} />
                <span className="text-muted"> / {steps.length}</span>
              </Big>
            </div>
            <p className="text-right text-[12.5px] text-muted">{live ? "All steps done" : running >= 0 ? `Step ${running + 1} in progress` : "Ready to start"}</p>
          </div>
          <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-bg-2">
            <div className="h-full rounded-full bg-brand transition-[width] duration-500 ease-out" style={{ width: `${(done / steps.length) * 100}%` }} />
          </div>
          <ul className="mt-5 border-t border-line">
            {steps.map((s, i) => {
              const state = i < done ? "done" : i === running ? "running" : "todo";
              return (
                <li key={s} className={`flex items-center gap-3.5 border-b border-line py-3 last:border-b-0 ${state === "running" ? "bg-brand-soft" : ""}`}>
                  <span
                    className={`grid size-6 shrink-0 place-items-center rounded-full font-mono text-[10.5px] transition-colors duration-300 ${
                      state === "done" ? "bg-[#1f7a3d] text-white" : state === "running" ? "bg-brand text-on-brand" : "border border-line-strong text-muted"
                    }`}
                  >
                    {state === "done" ? <CheckCircle size={14} weight="bold" /> : state === "running" ? <CircleNotch size={13} className="animate-spin" /> : i + 1}
                  </span>
                  <span className={`text-[14px] transition-colors duration-300 ${state === "todo" ? "text-muted" : "text-fg"}`}>{s}</span>
                </li>
              );
            })}
          </ul>
        </PanelCard>
        <PanelCard>
          <div className="flex min-h-[24px] items-center justify-between gap-3 text-[13.5px]">
            <span className="text-muted">Status</span>
            <AnimatePresence mode="wait">
              {live ? (
                <motion.span key="live" {...POP} className="flex items-center gap-1.5 rounded-[4px] bg-[#e8f5ec] px-2 py-1 font-mono text-[10.5px] uppercase tracking-[0.06em] text-[#1f7a3d]">
                  <ShieldCheck size={13} weight="fill" /> Policy live on every device
                </motion.span>
              ) : (
                <motion.span key="wait" {...POP} className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-muted">Not live yet</motion.span>
              )}
            </AnimatePresence>
          </div>
        </PanelCard>
      </Panel>
    </div>
  );
}
