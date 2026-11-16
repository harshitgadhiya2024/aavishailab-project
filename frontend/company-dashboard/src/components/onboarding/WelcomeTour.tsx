"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarDays, X } from "lucide-react";
import { onboardingApi } from "@/lib/api";
import { isDemo } from "@/lib/demo";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { openBookDemo } from "./BookDemo";

/*
 * First visit to the dashboard after sign-up: a welcome popup that offers a
 * short product tour or a demo with the team, then the tour itself, which
 * spotlights the sidebar items one at a time. Shown once per admin, for
 * self-serve companies only; "aavishield:start-tour" replays it any time.
 */

const START_EVENT = "aavishield:start-tour";

const STEPS: { target: string; title: string; body: string }[] = [
  { target: "/dashboard", title: "Your security overview", body: "Devices online, incidents by control and what needs your attention, all on one screen." },
  { target: "/dashboard/devices", title: "Devices", body: "Every laptop running the agent, its security posture and when it last checked in." },
  { target: "/dashboard/employees", title: "Employees", body: "Add your team here. Each person installs the agent from the employee portal." },
  { target: "/dashboard/swg", title: "Web Gateway", body: "Block websites by category or domain. The starter policy from setup lives here." },
  { target: "/dashboard/dlp", title: "Data Loss Prevention", body: "Sensitive files and text that left the company, with the reason each one was flagged." },
  { target: "/dashboard/activity", title: "Activity", body: "Every blocked and flagged event from every control, in one feed you can filter." },
  { target: "/dashboard/reports", title: "Reports", body: "Weekly summaries and audit-ready exports, ready to share." },
];

type Rect = { top: number; left: number; width: number; height: number };

const seenKey = (who: string) => `aavishield-welcome-seen:${who}`;

function wasSeen(who: string) {
  try {
    return localStorage.getItem(seenKey(who)) === "1";
  } catch {
    return false;
  }
}

function markSeen(who: string) {
  try {
    localStorage.setItem(seenKey(who), "1");
  } catch {}
}

/** Opens the tour from anywhere, e.g. a "Product tour" menu item. */
export function startProductTour() {
  window.dispatchEvent(new Event(START_EVENT));
}

export function WelcomeTour() {
  const { data: session } = useSession();
  const who = session?.user?.email || (isDemo ? "demo" : "");
  const { data: ob } = useQuery({
    queryKey: ["onboarding"],
    queryFn: async () => (await onboardingApi.get()).data as { self_serve: boolean },
    staleTime: 60_000,
  });

  const [phase, setPhase] = useState<"welcome" | "tour" | null>(null);
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);

  // Decide once the admin and the organization are known.
  useEffect(() => {
    if (!who || !ob?.self_serve || wasSeen(who)) return;
    setPhase("welcome");
  }, [who, ob?.self_serve]);

  useEffect(() => {
    const replay = () => { setStep(0); setPhase("tour"); };
    window.addEventListener(START_EVENT, replay);
    return () => window.removeEventListener(START_EVENT, replay);
  }, []);

  const close = useCallback(() => {
    if (who) markSeen(who);
    setPhase(null);
  }, [who]);

  // Follow the highlighted sidebar item through resizes and scrolling.
  useLayoutEffect(() => {
    if (phase !== "tour") return;
    const measure = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${STEPS[step].target}"]`);
      const r = el?.getBoundingClientRect();
      setRect(r && r.width > 0 ? { top: r.top, left: r.left, width: r.width, height: r.height } : null);
    };
    document.querySelector(`[data-tour="${STEPS[step].target}"]`)?.scrollIntoView({ block: "nearest" });
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [phase, step]);

  useEffect(() => {
    if (!phase) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, close]);

  if (!phase) return null;

  if (phase === "welcome") {
    return (
      <div className="fixed inset-0 z-[100] grid place-items-center bg-black/30 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
        <div className="w-full max-w-[440px] overflow-hidden rounded-xl border border-border bg-background shadow-2xl">
          <div className="relative grid h-40 place-items-center border-b border-border bg-[radial-gradient(circle,rgb(255_112_0/0.12)_1px,transparent_1px)] [background-size:16px_16px]">
            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-brand-500/[0.06]" />
            <BrandLogo className="relative text-[30px]" />
            <button type="button" onClick={close} aria-label="Close" className="absolute right-3 top-3 grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="px-7 pb-7 pt-6 text-center">
            <h2 id="welcome-title" className="text-xl font-medium text-foreground">Welcome to Aavishield!</h2>
            <p className="mx-auto mt-2 max-w-[34ch] text-sm leading-relaxed text-muted-foreground">
              Take a one-minute tour of your console, or book a free demo and we&apos;ll walk you through it live.
            </p>
            <div className="mt-6 grid gap-2.5">
              <button type="button" onClick={() => { setStep(0); setPhase("tour"); }} className="group flex h-11 items-center justify-center gap-2 rounded-md bg-brand-500 font-mono text-[12.5px] font-medium uppercase tracking-[0.06em] text-white transition-colors hover:bg-brand-600">
                Take the tour <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </button>
              <button
                type="button"
                onClick={() => { close(); openBookDemo(); }}
                className="flex h-11 items-center justify-center gap-2 rounded-md border border-border font-mono text-[12.5px] uppercase tracking-[0.06em] text-foreground transition-colors hover:bg-elevated"
              >
                <CalendarDays className="h-4 w-4" /> Book a demo
              </button>
              <button type="button" onClick={close} className="mt-1 text-sm text-muted-foreground hover:text-foreground">Skip for now</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const s = STEPS[step];
  const last = step === STEPS.length - 1;
  const PAD = 6;
  // The popover sits to the right of the highlighted item, kept on screen.
  const popTop = rect ? Math.min(Math.max(12, rect.top - 8), window.innerHeight - 220) : undefined;
  const popLeft = rect ? rect.left + rect.width + 20 : undefined;

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label="Product tour">
      {rect ? (
        <div
          aria-hidden
          className="pointer-events-none fixed rounded-lg ring-2 ring-brand-500 transition-all duration-300"
          style={{
            top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2,
            boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.45)",
          }}
        />
      ) : (
        <div aria-hidden className="fixed inset-0 bg-black/45" />
      )}
      <div
        className={`fixed w-[320px] rounded-xl border border-border bg-background p-5 shadow-2xl transition-all duration-300 ${rect ? "" : "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"}`}
        style={rect ? { top: popTop, left: popLeft } : undefined}
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-base font-medium text-foreground">{s.title}</h3>
          <button type="button" onClick={close} aria-label="End tour" className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-elevated hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
        <div className="mt-5 flex items-center justify-between">
          <span className="font-mono text-[11px] text-subtle">{step + 1} of {STEPS.length}</span>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button type="button" onClick={() => setStep(step - 1)} className="h-8 rounded-md px-3 text-sm text-muted-foreground hover:text-foreground">Back</button>
            )}
            {!last && <button type="button" onClick={close} className="h-8 rounded-md px-3 text-sm text-muted-foreground hover:text-foreground">Skip</button>}
            <button
              type="button"
              onClick={() => (last ? close() : setStep(step + 1))}
              className="h-8 rounded-md bg-brand-500 px-4 text-sm font-medium text-white transition-colors hover:bg-brand-600"
            >
              {last ? "Finish" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
