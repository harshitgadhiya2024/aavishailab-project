"use client";

import { useEffect, useState } from "react";
import { Ban, Check, Download, KeyRound, Laptop, Loader2, Mail, MousePointer2, ShieldCheck, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * Illustrations for the dashboard's setup steps, in the website's landing
 * language (aavishield.com): an orange pixel-grid stage with "+" corners, a
 * teammate's cursor tag, and a small console card with a mono title bar that
 * plays a short loop showing what the step does. Colours come from the
 * console's theme tokens, so it works in light and dark.
 */

export type SceneKey = "employees" | "device" | "policy";

const TAGS: Record<SceneKey, string> = {
  employees: "Add your team",
  device: "Install on a laptop",
  policy: "Pick what to block",
};

export function SetupScene({ step }: { step: SceneKey }) {
  return (
    <PixelPanel>
      <AgentTag>{TAGS[step]}</AgentTag>
      <div key={step} className="ob-fade w-full max-w-[330px]">
        {step === "employees" && <EmployeesScene />}
        {step === "device" && <DeviceScene />}
        {step === "policy" && <PolicyScene />}
      </div>
    </PixelPanel>
  );
}

/** A looping 100 ms tick counter; reduced motion shows the last frame. */
function useTimeline(period: number) {
  const [t, setT] = useState(0);
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(mq.matches);
    if (mq.matches) return;
    const id = setInterval(() => setT(v => (v + 1) % period), 100);
    return () => clearInterval(id);
  }, [period]);
  return reduce ? period - 1 : t;
}

function PixelPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative grid h-full min-h-[300px] place-items-center overflow-hidden rounded-[4px] border border-brand-500/15 bg-brand-tint px-8 pb-8 pt-12 [background-image:linear-gradient(rgb(255_112_0/0.09)_1px,transparent_1px),linear-gradient(90deg,rgb(255_112_0/0.09)_1px,transparent_1px)] [background-size:12px_12px]">
      {["left-2 top-2", "right-2 top-2", "bottom-2 left-2", "bottom-2 right-2"].map(pos => (
        <span key={pos} aria-hidden className={`absolute ${pos} text-[14px] leading-none text-foreground/45`}>+</span>
      ))}
      {children}
    </div>
  );
}

function AgentTag({ children }: { children: React.ReactNode }) {
  return (
    <span aria-hidden className="ob-tag pointer-events-none absolute right-6 top-2 z-20 flex items-start gap-0.5">
      <MousePointer2 className="h-[18px] w-[18px] -scale-x-100 fill-brand-500 text-brand-500" />
      <span className="mt-3 whitespace-nowrap bg-brand-500 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-white">{children}</span>
    </span>
  );
}

function UiCard({ title, meta, children }: { title: string; meta?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="relative w-full rounded-[6px] border border-border bg-card shadow-[0_18px_40px_-24px_rgb(120_50_0/0.35)]">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <span className="truncate font-mono text-[10.5px] uppercase tracking-[0.1em] text-foreground">{title}</span>
        {meta}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function LiveMeta({ label = "Live" }: { label?: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
      <span className="relative flex size-1.5">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand-500 opacity-60 motion-reduce:animate-none" />
        <span className="relative inline-flex size-1.5 rounded-full bg-brand-500" />
      </span>
      {label}
    </span>
  );
}

type PillTone = "blocked" | "allowed" | "brand" | "muted";
const PILL: Record<PillTone, string> = {
  blocked: "bg-red-500/10 text-red-700 dark:text-red-400",
  allowed: "bg-green-500/10 text-green-700 dark:text-green-400",
  brand: "bg-brand-500/10 text-brand-700 dark:text-brand-300",
  muted: "bg-elevated text-muted-foreground",
};

function Pill({ tone, children }: { tone: PillTone; children: React.ReactNode }) {
  return (
    <span className={cn("ob-pop inline-flex shrink-0 items-center gap-1 rounded-[4px] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em]", PILL[tone])}>
      {children}
    </span>
  );
}

/* ── Step 1: a CSV lands, people appear one by one and get their invite ── */

const PEOPLE = [
  { n: "Aisha Qureshi", e: "aisha@company.com", team: "Finance" },
  { n: "Rohan Mehta", e: "rohan@company.com", team: "Sales" },
  { n: "Neha Kapoor", e: "neha@company.com", team: "Engineering" },
];

function EmployeesScene() {
  const t = useTimeline(70); // 7 s loop
  const added = Math.min(3, Math.max(0, Math.floor((t - 8) / 6) + 1));
  return (
    <UiCard
      title="Employees"
      meta={
        <span className={cn("inline-flex shrink-0 items-center gap-1 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors", t >= 4 ? "text-brand-600 dark:text-brand-300" : "text-muted-foreground")}>
          <Upload className="h-3 w-3" />team.csv
        </span>
      }
    >
      <ul className="space-y-1">
        {PEOPLE.map((p, i) => {
          const shown = t >= 8 + i * 6;
          const invited = t >= 14 + i * 6;
          return (
            <li
              key={p.n}
              className={cn(
                "flex items-center gap-2.5 rounded-[4px] px-1.5 py-1.5 transition-all duration-300",
                shown ? "translate-x-0 opacity-100" : "-translate-x-2 opacity-0",
                shown && !invited && "bg-brand-500/[0.06]",
              )}
            >
              <span className={cn("size-2 shrink-0", invited ? "bg-brand-500" : "bg-foreground/25")} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-medium text-foreground">{p.n}</span>
                <span className="block truncate text-[11px] text-subtle">{p.e} · {p.team}</span>
              </span>
              {invited ? <Pill tone="brand"><Mail className="h-2.5 w-2.5" />Invited</Pill> : <Pill tone="muted">New</Pill>}
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex items-center justify-between border-t border-border px-1.5 pt-2 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
        <span>{added} of 3 added</span>
        <span className={cn("text-green-700 transition-opacity dark:text-green-400", t >= 28 ? "opacity-100" : "opacity-0")}>Portal invites sent</span>
      </div>
    </UiCard>
  );
}

/* ── Step 2: download, sign in, and the laptop checks in ────────────────── */

const ENROLL = [
  { label: "Download Aavishield", detail: "aavishield-setup.exe", icon: Download },
  { label: "Sign in to the portal", detail: "Links this laptop to you", icon: KeyRound },
  { label: "Device checks in", detail: "DESKTOP-PRIYA · Windows 11", icon: Laptop },
];
const STEP_START = [6, 26, 40];
const STEP_DONE = [24, 38, 46];

function DeviceScene() {
  const t = useTimeline(80); // 8 s loop
  const progress = Math.max(0, Math.min(1, (t - STEP_START[0]) / (STEP_DONE[0] - STEP_START[0])));
  const online = t >= STEP_DONE[2];
  return (
    <UiCard
      title="Devices"
      meta={online ? <LiveMeta label="1 online" /> : <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">0 online</span>}
    >
      <ol className="space-y-1">
        {ENROLL.map((s, i) => {
          const active = t >= STEP_START[i] && t < STEP_DONE[i];
          const done = t >= STEP_DONE[i];
          const Icon = s.icon;
          return (
            <li key={s.label} className={cn("flex items-center gap-2.5 rounded-[4px] px-1.5 py-1.5 transition-colors duration-300", active && "bg-brand-500/[0.06]")}>
              <span
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-[4px] transition-colors duration-300",
                  done ? "bg-brand-500 text-white" : active ? "bg-brand-500/15 text-brand-600 dark:text-brand-300" : "bg-elevated text-subtle",
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : active ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <Icon className="h-3.5 w-3.5" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn("block truncate text-[12.5px] font-medium", t >= STEP_START[i] ? "text-foreground" : "text-muted-foreground")}>{s.label}</span>
                {i === 0 && active ? (
                  <span className="mt-1 block h-1 overflow-hidden rounded-full bg-elevated">
                    <span className="block h-full rounded-full bg-brand-500 transition-[width] duration-100" style={{ width: `${progress * 100}%` }} />
                  </span>
                ) : (
                  <span className="block truncate font-mono text-[10.5px] text-subtle">{s.detail}</span>
                )}
              </span>
              {i === 2 && online && <Pill tone="allowed">Online</Pill>}
            </li>
          );
        })}
      </ol>
      <div className={cn("mt-2 flex items-center justify-between border-t border-border px-1.5 pt-2 font-mono text-[10px] uppercase tracking-[0.08em] transition-opacity duration-300", online ? "opacity-100" : "opacity-0")}>
        <span className="flex items-center gap-1 text-green-700 dark:text-green-400"><ShieldCheck className="h-3 w-3" />Protected</span>
        <span className="text-muted-foreground">Posture 92/100</span>
      </div>
    </UiCard>
  );
}

/* ── Step 3: categories switch on, then live decisions land ─────────────── */

const CATEGORIES = ["AI tools", "Social media", "Gambling"];
const DECISIONS = [
  { d: "chat.deepseek.com", who: "Arjun · Engineering", blocked: true },
  { d: "docs.google.com", who: "Priya · Finance", blocked: false },
  { d: "instagram.com", who: "Rohan · Sales", blocked: true },
];

function PolicyScene() {
  const t = useTimeline(80); // 8 s loop
  return (
    <UiCard title="Web Gateway · Starter policy" meta={t >= 32 ? <LiveMeta /> : undefined}>
      <div className="grid grid-cols-3 gap-1.5">
        {CATEGORIES.map((c, i) => {
          const on = t >= 6 + i * 6;
          return (
            <div key={c} className={cn("flex flex-col items-start gap-1.5 rounded-[4px] border px-2 py-1.5 transition-colors duration-300", on ? "border-brand-500/40 bg-brand-500/[0.06]" : "border-border")}>
              <span className="text-[11px] font-medium text-foreground">{c}</span>
              <span className={cn("relative h-3.5 w-6 rounded-full transition-colors duration-300", on ? "bg-brand-500" : "bg-border")}>
                <span className={cn("absolute top-0.5 size-2.5 rounded-full bg-white shadow transition-[left] duration-300", on ? "left-[11px]" : "left-0.5")} />
              </span>
            </div>
          );
        })}
      </div>
      <ul className="mt-2 divide-y divide-border">
        {DECISIONS.map((e, i) => {
          const shown = t >= 32 + i * 9;
          return (
            <li key={e.d} className={cn("flex items-center gap-2.5 px-1 py-1.5 transition-all duration-300", shown ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0")}>
              <span className={cn("size-2 shrink-0", e.blocked ? "bg-brand-500" : "bg-foreground/25")} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium text-foreground">{e.d}</span>
                <span className="block truncate text-[10.5px] text-subtle">{e.who}</span>
              </span>
              {e.blocked ? <Pill tone="blocked"><Ban className="h-2.5 w-2.5" />Blocked</Pill> : <Pill tone="allowed"><Check className="h-2.5 w-2.5" />Allowed</Pill>}
            </li>
          );
        })}
      </ul>
    </UiCard>
  );
}
