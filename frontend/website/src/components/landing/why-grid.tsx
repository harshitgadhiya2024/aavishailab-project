"use client";

import {
  AppleLogo,
  ArrowRight,
  CheckCircle,
  CircleNotch,
  Cpu,
  Database,
  FilePdf,
  Laptop,
  LinuxLogo,
  LockSimple,
  WifiHigh,
  WindowsLogo,
} from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { Reveal } from "../motion/reveal";
import { POP, StatePill, useTimeline } from "./visuals";

/*
 * "Why Aavishield": six reasons in the same visual language as the platform
 * rows. Each cell is a small product widget on the orange pixel-grid stage,
 * then a number, a title and one line of explanation. Each widget plays a
 * short loop while on screen (see useTimeline), pinned still for reduced motion.
 */

const widget = "w-full max-w-[300px] rounded-[6px] border border-line-strong/70 bg-surface shadow-[0_18px_40px_-24px_rgb(120_50_0/0.35)]";
const row = "flex items-center justify-between gap-3 border-b border-line px-3 py-2 text-[12.5px] last:border-b-0";

function Reason({ n, title, body, children, i }: { n: string; title: string; body: string; children: React.ReactNode; i: number }) {
  return (
    <Reveal delay={(i % 3) * 0.06} className="flex flex-col bg-bg">
      <div className="pixel-grid grid h-[210px] place-items-center border-b border-line bg-brand-soft px-6">{children}</div>
      <div className="flex-1 px-6 py-6 md:px-8 md:py-7">
        <span className="font-mono text-[11px] text-brand-ink">{n}</span>
        <h3 className="mt-2 text-xl font-normal tracking-[-0.02em] text-fg">{title}</h3>
        <p className="mt-2 max-w-[40ch] text-sm leading-relaxed text-muted">{body}</p>
      </div>
    </Reveal>
  );
}

function Pending() {
  return <CircleNotch size={13} className="animate-spin text-muted" />;
}

/* 01: the OS checks tick in, a pulse runs to the agent, the agent lights up. */
export function PlatformsWidget() {
  const { ref, t } = useTimeline(50, 30);
  const os = [
    { I: AppleLogo, n: "macOS" },
    { I: WindowsLogo, n: "Windows" },
    { I: LinuxLogo, n: "Linux" },
  ];
  const lit = t >= 16 && t < 40;
  return (
    <div ref={ref} className="flex w-full max-w-[300px] items-center gap-3">
      <ul className={`${widget} flex-1`}>
        {os.map(({ I, n }, i) => (
          <li key={n} className={row}>
            <span className="flex items-center gap-2 text-fg">
              <I size={14} weight="fill" /> {n}
            </span>
            {t >= 3 + i * 3 ? (
              <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 20 }}>
                <CheckCircle size={14} weight="fill" className="text-[#1f7a3d]" />
              </motion.span>
            ) : (
              <Pending />
            )}
          </li>
        ))}
      </ul>
      <span className="relative flex w-6 shrink-0 items-center justify-center">
        <ArrowRight size={16} className="text-muted" />
        {t >= 11 && t < 16 && (
          <motion.span className="absolute top-1/2 size-1.5 -translate-y-1/2 bg-brand" initial={{ left: 0 }} animate={{ left: 20 }} transition={{ duration: 0.45, ease: "easeInOut" }} />
        )}
      </span>
      <span className={`relative grid size-14 shrink-0 place-items-center rounded-[6px] bg-brand text-on-brand transition-shadow duration-500 ${lit ? "ring-2 ring-brand/30 ring-offset-2 ring-offset-brand-soft" : ""}`}>
        <motion.span animate={lit ? { scale: [1, 1.15, 1] } : { scale: 1 }} transition={{ duration: 0.5 }}>
          <Cpu size={24} />
        </motion.span>
      </span>
    </div>
  );
}

/* 02: the laptop hops from network to network; each one confirms protection. */
export function NetworksWidget() {
  const { ref, t } = useTimeline(45, 14);
  const nets = ["Office Wi-Fi", "Home broadband", "Airport hotspot"];
  const at = Math.floor(t / 15);
  return (
    <ul ref={ref as React.Ref<HTMLUListElement>} className={widget}>
      {nets.map((net, i) => {
        const here = i === at;
        return (
          <li key={net} className={`${row} transition-colors duration-300 ${here ? "bg-brand-soft" : ""}`}>
            <span className="flex items-center gap-2 text-fg">
              <WifiHigh size={14} className="text-brand" /> {net}
              <AnimatePresence>
                {here && (
                  <motion.span {...POP} className="text-brand-ink">
                    <Laptop size={14} />
                  </motion.span>
                )}
              </AnimatePresence>
            </span>
            <span className={`inline-flex items-center gap-1 rounded-[4px] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] transition-colors duration-300 ${here ? "bg-[#1f7a3d] text-white" : "bg-[#e8f5ec] text-[#1f7a3d]"}`}>
              <span className={`size-1.5 rounded-full ${here ? "animate-pulse bg-white" : "bg-[#1f7a3d]"}`} /> Protected
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/* 03: the bundle's fields fill in, then the signature is verified. */
export function PolicyWidget() {
  const { ref, t } = useTimeline(55, 54);
  const fields: [string, string][] = [
    ["signature", "ed25519"],
    ["checked", "on the device"],
  ];
  return (
    <div ref={ref} className={widget}>
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-fg">policy.bundle</span>
        <span className="font-mono text-[10px] text-muted">{t < 4 ? "received" : "v14"}</span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 px-3 py-2.5 font-mono text-[11px]">
        {fields.flatMap(([k, v], i) => [
          <dt key={`${k}-k`} className="text-muted">{k}</dt>,
          <dd key={`${k}-v`} className="h-[16px] text-fg">{t >= 4 + i * 5 ? v.slice(0, Math.max(0, (t - 4 - i * 5) * 3)) : ""}</dd>,
        ])}
        <dt className="text-muted">status</dt>
        <dd className="h-[16px]">
          <AnimatePresence mode="wait">
            {t >= 24 ? (
              <motion.span key="ok" {...POP} className="flex items-center gap-1 text-[#1f7a3d]">
                <CheckCircle size={12} weight="fill" /> verified
              </motion.span>
            ) : t >= 14 ? (
              <motion.span key="wait" {...POP} className="flex items-center gap-1 text-muted">
                <CircleNotch size={11} className="animate-spin" /> verifying…
              </motion.span>
            ) : null}
          </AnimatePresence>
        </dd>
      </dl>
    </div>
  );
}

/* 04: the upload completes, then the finding is flagged; work is not stopped. */
function DlpWidget() {
  const { ref, t } = useTimeline(55, 54);
  const pct = Math.min(100, Math.max(0, (t - 2) * 7));
  return (
    <div ref={ref} className={`${widget} p-3`}>
      <div className="flex items-center gap-2.5 text-[12.5px]">
        <FilePdf size={18} weight="fill" className="shrink-0 text-danger" />
        <span className="min-w-0 flex-1 truncate text-fg">vendor-contract.pdf</span>
        <span className="font-mono text-[10px] uppercase text-[#1f7a3d]">{pct >= 100 ? "Sent" : `${pct}%`}</span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-bg-2">
        <div className="h-full bg-[#1f7a3d] transition-[width] duration-100" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-2.5 flex h-[20px] items-center justify-between gap-2">
        <span className="truncate text-[11.5px] text-muted">to drive.google.com</span>
        <AnimatePresence>{t >= 22 && <motion.span {...POP}><StatePill state="flagged" /></motion.span>}</AnimatePresence>
      </div>
    </div>
  );
}

/* 05: each VPN is struck out in turn as its Blocked stamp lands. */
export function VpnWidget() {
  const { ref, t } = useTimeline(50, 49);
  const vpns = ["NordVPN.app", "protonvpn-setup.exe", "Hola extension"];
  return (
    <ul ref={ref as React.Ref<HTMLUListElement>} className={widget}>
      {vpns.map((v, i) => {
        const hit = t >= 4 + i * 7;
        return (
          <li key={v} className={row}>
            <span className={`truncate decoration-danger/70 decoration-[1.5px] transition-colors duration-300 ${hit ? "text-muted line-through" : "text-fg"}`}>{v}</span>
            <span className="grid h-[20px] w-[72px] place-items-end">
              <AnimatePresence>
                {hit && (
                  <motion.span initial={{ scale: 1.6, opacity: 0, rotate: -8 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} exit={{ opacity: 0 }} transition={{ type: "spring", stiffness: 420, damping: 22 }}>
                    <StatePill state="blocked" />
                  </motion.span>
                )}
              </AnimatePresence>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/* 06: another company's request heads for your data and stops at the lock. */
export function IsolationWidget() {
  const { ref, t } = useTimeline(40, 39);
  const moving = t >= 6 && t < 14;
  const denied = t >= 14 && t < 26;
  return (
    <div ref={ref} className="flex w-full max-w-[300px] items-stretch">
      <div className={`${widget} flex-1 p-3`}>
        <Database size={18} className="text-brand" />
        <span className="mt-2 block text-[12.5px] text-fg">Your company</span>
        <span className="mt-0.5 flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.06em] text-muted">
          <LockSimple size={10} /> Own data
        </span>
      </div>
      <div className="relative flex w-8 shrink-0 items-center justify-center">
        <span aria-hidden className="absolute inset-y-2 left-1/2 w-px -translate-x-1/2 border-l border-dashed border-line-strong" />
        <motion.span
          animate={denied ? { scale: [1, 1.25, 1], x: [0, -2, 2, 0] } : { scale: 1 }}
          transition={{ duration: 0.45 }}
          className={`relative grid size-6 place-items-center rounded-full border transition-colors duration-300 ${denied ? "border-danger bg-[#fdecea] text-danger" : "border-line-strong bg-surface text-muted"}`}
        >
          <LockSimple size={12} weight={denied ? "fill" : "regular"} />
        </motion.span>
        {moving && (
          <motion.span className="absolute top-1/2 size-1.5 -translate-y-1/2 bg-muted" initial={{ left: 34, opacity: 1 }} animate={{ left: 22 }} transition={{ duration: 0.7, ease: "easeIn" }} />
        )}
      </div>
      <div className={`${widget} flex-1 p-3 opacity-55`}>
        <Database size={18} className="text-muted" />
        <span className="mt-2 block text-[12.5px] text-fg">Another company</span>
        <span className="mt-0.5 flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.06em] text-muted">
          <LockSimple size={10} /> Own data
        </span>
      </div>
    </div>
  );
}

export function WhyGrid() {
  return (
    <div className="grid grid-cols-1 gap-px border-t border-line bg-line md:grid-cols-2 lg:grid-cols-3">
      <Reason i={0} n="01" title="One Agent, Every Platform" body="The same Rust binary and the same signed policy on macOS, Windows and Linux.">
        <PlatformsWidget />
      </Reason>
      <Reason i={1} n="02" title="Works On Any Network" body="Enforcement runs on the laptop, so policy holds wherever it is opened.">
        <NetworksWidget />
      </Reason>
      <Reason i={2} n="03" title="Policy You Can Verify" body="Every policy bundle is signed with Ed25519 and checked on the device before it applies.">
        <PolicyWidget />
      </Reason>
      <Reason i={3} n="04" title="DLP That Never Blocks Work" body="Uploads still go through. Aavishield records the file, the person and where it went.">
        <DlpWidget />
      </Reason>
      <Reason i={4} n="05" title="VPNs Blocked By Default" body="Desktop VPNs, installers and browser extensions are stopped with zero setup.">
        <VpnWidget />
      </Reason>
      <Reason i={5} n="06" title="Your Data, Isolated" body="Each company's data is scoped to that company and never mixed. Keep it in your own database if you prefer.">
        <IsolationWidget />
      </Reason>
    </div>
  );
}
