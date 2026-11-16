"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Clock, Laptop, ToggleRight, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { SetupScene } from "./SetupScenes";

/*
 * "Get protected in three steps" on an empty dashboard.
 *
 * A vertical stepper: steps read top to bottom and connect, so the order is
 * obvious. The next unfinished step is open, with its action button; finished
 * steps collapse to a tick; later steps wait, dimmed. Beside it, a short
 * looping animation shows what that step actually does. Anyone can click a
 * different step to preview it. Motion is skipped for reduced-motion users,
 * who see the finished frame of each animation instead.
 */

type Health = { employees: number; devices: number; policies_enabled: number };

type Step = {
  key: "employees" | "device" | "policy";
  done: boolean;
  icon: React.ElementType;
  title: string;
  body: string;
  time: string;
  href: string;
  cta: string;
};

export function SetupSteps({ h }: { h: Health }) {
  const steps: Step[] = [
    { key: "employees", done: (h.employees ?? 0) > 0, icon: UserPlus, title: "Add your employees", body: "Import them from a CSV or add them one by one. Each person gets an invite to the employee portal.", time: "2 min", href: "/dashboard/employees", cta: "Add employees" },
    { key: "device", done: (h.devices ?? 0) > 0, icon: Laptop, title: "Enroll the first device", body: "Install the agent on your own laptop, or send an employee their enrollment link. The device appears here within a minute.", time: "3 min", href: "/dashboard/devices", cta: "Enroll a device" },
    { key: "policy", done: (h.policies_enabled ?? 0) > 0, icon: ToggleRight, title: "Switch on a policy", body: "Pick what to block or watch: websites by category, apps, sensitive data. It applies to every enrolled device.", time: "1 min", href: "/dashboard/swg", cta: "Set up a policy" },
  ];
  const doneCount = steps.filter(s => s.done).length;
  const current = Math.max(0, steps.findIndex(s => !s.done));
  const [open, setOpen] = useState(current);
  useEffect(() => setOpen(current), [current]);
  const shown = steps[open];

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <style>{CSS}</style>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <h3 className="font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-foreground">Get protected in three steps</h3>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{doneCount} of {steps.length} done</span>
          <div className="h-1.5 w-28 overflow-hidden rounded-full bg-elevated" aria-hidden>
            <div className="ob-bar h-full rounded-full bg-brand-500" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {/* Stepper */}
        <ol className="p-5">
          {steps.map((s, i) => {
            const isCurrent = i === current && !s.done;
            // The next step stays open so its button is always one click away.
            const isOpen = i === open || isCurrent;
            const last = i === steps.length - 1;
            return (
              <li key={s.key} className="relative flex gap-4">
                {/* Rail: node + connector to the next step */}
                <div className="flex flex-col items-center">
                  <button
                    type="button"
                    onClick={() => setOpen(i)}
                    aria-label={`Step ${i + 1}: ${s.title}${s.done ? " (done)" : ""}`}
                    className={cn(
                      "relative z-10 grid size-8 shrink-0 place-items-center rounded-full border text-[12px] font-medium transition-colors",
                      s.done ? "border-green-500 bg-green-500 text-white" : isCurrent ? "border-brand-500 bg-brand-500 text-white" : "border-border bg-background text-muted-foreground",
                    )}
                  >
                    {isCurrent && <span aria-hidden className="ob-ping absolute inset-0 rounded-full border-2 border-brand-500" />}
                    {s.done ? <Check className="h-4 w-4" strokeWidth={3} /> : <span className="font-mono">{i + 1}</span>}
                  </button>
                  {!last && (
                    <span className="relative my-1 w-0.5 flex-1 overflow-hidden rounded-full bg-border">
                      {s.done && <span className="ob-line absolute inset-x-0 top-0 h-full bg-green-500" />}
                    </span>
                  )}
                </div>

                {/* Content */}
                <div className={cn("min-w-0 flex-1", last ? "pb-1" : "pb-6")}>
                  <button type="button" onClick={() => setOpen(i)} className="flex w-full flex-wrap items-center gap-x-2.5 gap-y-1 pt-1 text-left">
                    <span className={cn("text-[15px] font-medium", s.done ? "text-muted-foreground" : "text-foreground")}>{s.title}</span>
                    {s.done ? (
                      <span className="rounded-full bg-green-500/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-green-700 dark:text-green-400">Done</span>
                    ) : isCurrent ? (
                      <span className="rounded-full bg-brand-tint px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-brand-700 dark:text-brand-300">Next step</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.08em] text-subtle"><Clock className="h-3 w-3" />{s.time}</span>
                    )}
                  </button>
                  <div className={cn("grid transition-[grid-template-rows,opacity] duration-300", isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
                    <div className="overflow-hidden">
                      <p className="mt-1.5 max-w-[48ch] text-[13px] leading-relaxed text-muted-foreground">{s.body}</p>
                      {!s.done && (
                        <div className="mt-3 flex flex-wrap items-center gap-3">
                          <Link
                            href={s.href}
                            className={cn(
                              "group inline-flex h-9 items-center gap-1.5 rounded-md px-4 text-[13px] font-medium transition-colors",
                              isCurrent ? "bg-brand-500 text-white hover:bg-brand-600" : "border border-border text-foreground hover:bg-elevated",
                            )}
                          >
                            {s.cta} <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                          </Link>
                          <span className="inline-flex items-center gap-1 text-[12px] text-subtle"><Clock className="h-3.5 w-3.5" />About {s.time}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        {/* What the open step does, on the website's orange pixel-grid stage */}
        <div className="hidden border-l border-border p-4 md:block">
          <SetupScene step={shown.key} />
        </div>
      </div>

      <p className="border-t border-border px-5 py-2.5 text-[12px] text-subtle">Figures on this page appear as soon as the first device reports in.</p>
    </section>
  );
}

const CSS = `
.ob-fade { animation: ob-fade .35s ease-out both; }
@keyframes ob-fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.ob-bar { transition: width .8s cubic-bezier(.2,.7,.2,1); }
.ob-line { animation: ob-line .7s ease-out both; transform-origin: top; }
@keyframes ob-line { from { transform: scaleY(0); } to { transform: scaleY(1); } }
.ob-ping { animation: ob-ping 1.8s cubic-bezier(0,0,.2,1) infinite; }
@keyframes ob-ping { 0% { transform: scale(1); opacity: .7; } 80%, 100% { transform: scale(1.6); opacity: 0; } }
.ob-pop { animation: ob-pop .3s cubic-bezier(.2,.8,.2,1) both; }
@keyframes ob-pop { from { opacity: 0; transform: scale(.85); } to { opacity: 1; transform: none; } }
.ob-tag { animation: ob-tag 4s ease-in-out infinite; }
@keyframes ob-tag { 0%, 100% { transform: translate(0, 0); } 50% { transform: translate(3px, -5px); } }
@media (prefers-reduced-motion: reduce) {
  .ob-fade, .ob-line, .ob-ping, .ob-pop, .ob-tag { animation: none !important; }
  .ob-ping { display: none; }
  .ob-bar { transition: none; }
}
`;

