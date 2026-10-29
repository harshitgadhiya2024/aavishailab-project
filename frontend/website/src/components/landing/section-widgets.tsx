"use client";

import { Cpu, Robot, ScanSmiley, UploadSimple } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { modules as allModules, type ModuleSlug } from "@/lib/content";
import { AgentTag, LiveDot, PixelPanel, POP, StatePill, UiCard, useTimeline, WIDGET_PAD, type EventState } from "./visuals";

/*
 * In-section widgets that replace decorative photos. Each one shows what the
 * section is saying, using that page's own data where it has some. Names and
 * devices are the same fictional demo data used everywhere else.
 */

function Stage({ children, tag, className = "" }: { children: React.ReactNode; tag?: React.ReactNode; className?: string }) {
  return (
    <PixelPanel className={`${WIDGET_PAD} h-full min-h-[420px] ${className}`}>
      {children}
      {tag}
    </PixelPanel>
  );
}

const moduleName = (slug: ModuleSlug) => allModules.find((m) => m.slug === slug)?.name ?? slug;

// Controls that record rather than block.
const WATCH_ONLY: ModuleSlug[] = ["data-loss-prevention", "activity-monitoring", "device-posture"];

/* Solution pages: the page's own threats arrive one by one and get caught. */
export function ThreatQueueWidget({ items, modules }: { items: { title: string }[]; modules: ModuleSlug[] }) {
  const rows = items.slice(0, 4);
  const STEP = 10;
  const { ref, t } = useTimeline(6 + rows.length * STEP + 24, 6 + rows.length * STEP + 23);
  const caught = rows.filter((_, i) => t >= 10 + i * STEP).length;
  return (
    <div ref={ref} className="h-full">
      <Stage tag={<AgentTag className="left-6 top-1">Caught on the device</AgentTag>}>
        <UiCard title="One laptop, one day" meta={<span className="flex items-center gap-1.5 font-mono text-[10px] text-muted"><LiveDot /> live</span>} className="w-full max-w-[400px]">
          <ul className="grid min-h-[236px] content-start gap-2">
            <AnimatePresence initial={false}>
              {rows.map((r, i) => {
                if (t < 6 + i * STEP) return null;
                const slug = modules[i % modules.length];
                const state: EventState = WATCH_ONLY.includes(slug) ? "flagged" : "blocked";
                return (
                  <motion.li key={r.title} {...POP} className="flex items-center gap-3 rounded-[4px] border border-line bg-bg px-3 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-fg">{r.title}</span>
                      <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted">{moduleName(slug)}</span>
                    </span>
                    <AnimatePresence>{t >= 10 + i * STEP && <motion.span {...POP}><StatePill state={state} /></motion.span>}</AnimatePresence>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
          <div className="mt-3 flex items-center justify-between border-t border-line pt-3 font-mono text-[10.5px] uppercase tracking-[0.06em] text-muted">
            <span>Seen by Aavishield</span>
            <span className="text-fg">{caught} / {rows.length}</span>
          </div>
        </UiCard>
      </Stage>
    </div>
  );
}

/* Industry pages: an outgoing upload is scanned and this industry's data types are recognised. */
export function DataScanWidget({ items }: { items: string[] }) {
  const rows = items.slice(0, 6);
  const STEP = 6;
  const end = 8 + rows.length * STEP;
  const { ref, t } = useTimeline(end + 26, end + 25);
  return (
    <div ref={ref} className="h-full">
      <Stage tag={<AgentTag tone="tint" className="left-6 top-1">Recorded, never blocked</AgentTag>}>
        <UiCard
          title="DLP scan"
          meta={<span className="flex items-center gap-1.5 font-mono text-[10px] text-muted"><UploadSimple size={12} /> outgoing upload</span>}
          className="w-full max-w-[380px]"
        >
          <div className="h-1 overflow-hidden rounded-full bg-bg-2">
            <div className="h-full bg-brand transition-[width] duration-100" style={{ width: `${Math.min(100, (t / end) * 100)}%` }} />
          </div>
          <ul className="mt-3 grid gap-1.5">
            {rows.map((d, i) => {
              const hit = t >= 8 + i * STEP;
              return (
                <li key={d} className={`flex h-[30px] items-center justify-between gap-3 rounded-[4px] px-2 text-[13px] transition-colors duration-300 ${hit ? "bg-brand-soft text-fg" : "text-muted"}`}>
                  <span className="truncate">{d}</span>
                  <AnimatePresence>{hit && <motion.span {...POP}><StatePill state="flagged" /></motion.span>}</AnimatePresence>
                </li>
              );
            })}
          </ul>
        </UiCard>
      </Stage>
    </div>
  );
}

/* Solutions index: visibility first, enforcement where it is clearly right. */
const MODES: { slug: ModuleSlug; mode: "Watch" | "Enforce" }[] = [
  { slug: "data-loss-prevention", mode: "Watch" },
  { slug: "activity-monitoring", mode: "Watch" },
  { slug: "device-posture", mode: "Watch" },
  { slug: "web-gateway", mode: "Enforce" },
  { slug: "application-control", mode: "Enforce" },
  { slug: "vpn-control", mode: "Enforce" },
  { slug: "malware-scanning", mode: "Enforce" },
];

export function ModesWidget() {
  const { ref, t } = useTimeline(60, 59);
  return (
    <div ref={ref} className="h-full">
      <Stage tag={<AgentTag className="left-6 top-1">Policy per control</AgentTag>}>
        <UiCard title="How each control acts" className="w-full max-w-[400px]">
          <ul className="grid gap-1">
            {MODES.map(({ slug, mode }, i) => {
              const set = t >= 4 + i * 4;
              const enforce = mode === "Enforce";
              return (
                <li key={slug} className="flex items-center justify-between gap-3 py-1">
                  <span className="text-[13px] text-fg">{moduleName(slug)}</span>
                  <span className="relative grid w-[132px] grid-cols-2 rounded-[4px] border border-line bg-bg p-0.5 font-mono text-[10px] uppercase tracking-[0.06em]">
                    {set && (
                      <motion.span
                        layout
                        transition={{ type: "spring", stiffness: 420, damping: 34 }}
                        className={`absolute inset-y-0.5 w-[calc(50%-2px)] rounded-[3px] ${enforce ? "right-0.5 bg-brand" : "left-0.5 bg-brand-tint"}`}
                      />
                    )}
                    <span className={`relative z-10 py-1 text-center ${set && !enforce ? "text-[#2a1406]" : "text-muted"}`}>Watch</span>
                    <span className={`relative z-10 py-1 text-center ${set && enforce ? "text-on-brand" : "text-muted"}`}>Enforce</span>
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

/*
 * Company: the AI work inside Aavishield, drawn for the black band it sits on.
 * A photo is read with OCR and classified as an ID scan, then the assistant
 * answers a question from live data. One hairline-bordered block, two cells.
 */
const PHOTO = Array.from({ length: 40 }, (_, i) => ((i * 37) % 11) / 11); // fixed pixel shades

export function AiLabWidget() {
  const { ref, t } = useTimeline(90, 89);
  const scan = Math.min(1, Math.max(0, (t - 4) / 16)); // OCR sweep, 0 → 1
  const classified = t >= 22;
  const question = "Which laptops have disk encryption off?";
  const typed = question.slice(0, Math.max(0, Math.floor((t - 34) * 3)));
  const answered = t >= 52;
  return (
    <div ref={ref} className="grid w-full gap-px overflow-hidden rounded-[6px] border border-white/10 bg-white/10 text-ink-fg">
      <div className="bg-ink p-6">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-brand">AI classification</span>
          <span className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-fg/45"><ScanSmiley size={13} /> OCR</span>
        </div>
        <div className="mt-5 flex items-center gap-5">
          {/* The photo as pixels, with the OCR sweep passing over it. */}
          <div className="relative grid shrink-0 grid-cols-8 gap-[3px]">
            {PHOTO.map((v, i) => <span key={i} className="size-[7px]" style={{ background: `rgb(250 250 250 / ${0.08 + v * 0.3})` }} />)}
            {scan > 0 && scan < 1 && <span className="absolute inset-y-0 w-px bg-brand" style={{ left: `${scan * 100}%` }} />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px]">IMG_2041.jpg</p>
            <div className="mt-2 grid gap-1.5">
              {[0.9, 0.65, 0.8].map((w, i) => (
                <span key={i} className="h-[3px] rounded-full bg-ink-fg/15">
                  <span className="block h-full rounded-full bg-ink-fg/60 transition-[width] duration-150" style={{ width: `${Math.min(1, scan * 1.4 - i * 0.2) * w * 100}%` }} />
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-5 flex min-h-[26px] items-center justify-between gap-3 border-t border-white/10 pt-4">
          <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-fg/60">{classified ? "Government ID scan" : "Reading text"}</span>
          <AnimatePresence>
            {classified && (
              <motion.span {...POP} className="inline-flex items-center gap-1.5 rounded-[4px] bg-brand/15 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.06em] text-brand">
                <span className="size-1.5 rounded-full bg-brand" /> Flagged
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="bg-ink p-6">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-brand">Assistant</span>
          <span className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-fg/45"><Robot size={13} /> Live data</span>
        </div>
        <div className="mt-5 min-h-[104px]">
          {!typed && <p className="rounded-[6px] border border-dashed border-white/15 px-3.5 py-2.5 text-[14px] text-ink-fg/35">Ask about your devices…</p>}
          <AnimatePresence>
            {typed && (
              <motion.p {...POP} className="ml-auto w-fit max-w-[90%] rounded-[6px] rounded-br-[2px] bg-white/[0.07] px-3.5 py-2.5 text-[14px]">
                {typed}
                {typed.length < question.length && <span className="ml-px inline-block h-[1em] w-px translate-y-[2px] animate-pulse bg-ink-fg" />}
              </motion.p>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {answered && (
              <motion.p {...POP} className="mt-3 flex max-w-[92%] items-start gap-2.5 border-l-2 border-brand pl-3 text-[14px] leading-relaxed text-ink-fg/85">
                <Cpu size={15} className="mt-0.5 shrink-0 text-brand" /> 2 devices: ThinkPad · Rohan, MacBook · Priya
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
