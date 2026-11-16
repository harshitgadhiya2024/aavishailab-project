"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CalendarDays, Compass, X } from "lucide-react";
import { onboardingApi } from "@/lib/api";
import { isDemo } from "@/lib/demo";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { openBookDemo } from "./BookDemo";

/*
 * Console prompts for self-serve companies, each answered once per user:
 *
 *  - Welcome: the very first login after sign-up only. Offers the tour or a
 *    demo; "Skip for now" leaves both invitations for later logins.
 *  - Tour invitation and demo invitation: two separate popups, shown on each
 *    later login (tour first, then demo) until the user takes it or says no
 *    once. A company with a demo already booked isn't asked again.
 *
 * Answers are stored on the user server-side (PUT /me/prompts), so they
 * follow the user to any browser. Within one login the prompts show once,
 * not on every page. "aavishield:start-tour" replays the tour any time.
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

type Prompt = "welcome" | "tour" | "demo";
type PromptState = "seen" | "dismissed" | "done";
type Phase = "welcome" | "tourInvite" | "demoInvite" | "tour";
type Rect = { top: number; left: number; width: number; height: number };
type Onboarding = { self_serve: boolean; demo_booked?: boolean; prompts?: Partial<Record<Prompt, { state: PromptState }>> };

// Which login the prompts were last shown for, so a page reload doesn't
// bring them back within the same sign-in.
const loginKey = (who: string) => `aavishield-prompts-login:${who}`;
// Demo mode has no backend, so answers live in the browser there.
const demoKey = (who: string) => `aavishield-prompts:${who}`;

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

/** Opens the tour from anywhere, e.g. a "Product tour" menu item. */
export function startProductTour() {
  window.dispatchEvent(new Event(START_EVENT));
}

export function WelcomeTour() {
  const { data: session } = useSession();
  const qc = useQueryClient();
  const who = session?.user?.email || (isDemo ? "demo" : "");
  const loginAt = String((session as any)?.loginAt ?? "");
  const { data: ob } = useQuery({
    queryKey: ["onboarding"],
    queryFn: async () => (await onboardingApi.get()).data as Onboarding,
    staleTime: 60_000,
  });

  const [phase, setPhase] = useState<Phase | null>(null);
  const [queue, setQueue] = useState<Phase[]>([]);
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const decided = useRef(false);

  const answer = useCallback((prompt: Prompt, state: PromptState) => {
    if (isDemo) {
      const saved = JSON.parse(readLocal(demoKey(who)) || "{}");
      saved[prompt] = { state };
      writeLocal(demoKey(who), JSON.stringify(saved));
      return;
    }
    onboardingApi.setPrompt(prompt, state)
      .then(() => qc.invalidateQueries({ queryKey: ["onboarding"] }))
      .catch(() => {});
  }, [who, qc]);

  // Decide once per login what to show, when the user and company are known.
  useEffect(() => {
    if (decided.current || !who || !ob) return;
    decided.current = true;
    if (!ob.self_serve) return;
    const login = loginAt || "demo";
    if (readLocal(loginKey(who)) === login) return; // already shown this login
    const answered = isDemo ? JSON.parse(readLocal(demoKey(who)) || "{}") : (ob.prompts ?? {});

    let next: Phase[];
    if (!answered.welcome) {
      next = ["welcome"];
    } else {
      next = [];
      if (!answered.tour) next.push("tourInvite");
      if (!answered.demo && !ob.demo_booked) next.push("demoInvite");
    }
    if (next.length === 0) return;
    writeLocal(loginKey(who), login);
    if (next[0] === "welcome") answer("welcome", "seen");
    setPhase(next[0]);
    setQueue(next.slice(1));
  }, [who, ob, loginAt, answer]);

  useEffect(() => {
    const replay = () => { setStep(0); setPhase("tour"); };
    window.addEventListener(START_EVENT, replay);
    return () => window.removeEventListener(START_EVENT, replay);
  }, []);

  // Close whatever is showing and move on to the next invitation, if any.
  const advance = useCallback(() => {
    setQueue(q => {
      setPhase(q[0] ?? null);
      return q.slice(1);
    });
  }, []);

  const startTour = useCallback(() => { setStep(0); setPhase("tour"); }, []);

  // Escape counts as "no thanks" for the invitation on screen.
  const dismissCurrent = useCallback(() => {
    if (phase === "tourInvite") answer("tour", "dismissed");
    if (phase === "demoInvite") answer("demo", "dismissed");
    advance();
  }, [phase, answer, advance]);

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
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && dismissCurrent();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, dismissCurrent]);

  if (!phase) return null;

  const primaryBtn = "group flex h-11 items-center justify-center gap-2 rounded-md bg-brand-500 font-mono text-[12.5px] font-medium uppercase tracking-[0.06em] text-white transition-colors hover:bg-brand-600";
  const secondaryBtn = "flex h-11 items-center justify-center gap-2 rounded-md border border-border font-mono text-[12.5px] uppercase tracking-[0.06em] text-foreground transition-colors hover:bg-elevated";

  if (phase === "welcome") {
    return (
      <Modal labelledBy="welcome-title" onClose={advance} banner={<BrandLogo className="relative text-[30px]" />}>
        <h2 id="welcome-title" className="text-xl font-medium text-foreground">Welcome to Aavishield!</h2>
        <p className="mx-auto mt-2 max-w-[34ch] text-sm leading-relaxed text-muted-foreground">
          Take a one-minute tour of your console, or book a free demo and we&apos;ll walk you through it live.
        </p>
        <div className="mt-6 grid gap-2.5">
          <button type="button" onClick={() => { answer("tour", "done"); startTour(); }} className={primaryBtn}>
            Take the tour <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </button>
          <button type="button" onClick={() => { answer("demo", "done"); setPhase(null); openBookDemo(); }} className={secondaryBtn}>
            <CalendarDays className="h-4 w-4" /> Book a demo
          </button>
          <button type="button" onClick={advance} className="mt-1 text-sm text-muted-foreground hover:text-foreground">Skip for now</button>
        </div>
      </Modal>
    );
  }

  if (phase === "tourInvite") {
    return (
      <Modal labelledBy="tour-invite-title" onClose={dismissCurrent} banner={<Compass className="relative h-10 w-10 text-brand-500" />}>
        <h2 id="tour-invite-title" className="text-xl font-medium text-foreground">Take a quick tour?</h2>
        <p className="mx-auto mt-2 max-w-[34ch] text-sm leading-relaxed text-muted-foreground">
          One minute to see where devices, policies, data loss alerts and reports live in your console.
        </p>
        <div className="mt-6 grid gap-2.5">
          <button type="button" onClick={() => { answer("tour", "done"); startTour(); }} className={primaryBtn}>
            Start the tour <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </button>
          <button type="button" onClick={dismissCurrent} className="mt-1 text-sm text-muted-foreground hover:text-foreground">No thanks</button>
        </div>
      </Modal>
    );
  }

  if (phase === "demoInvite") {
    return (
      <Modal labelledBy="demo-invite-title" onClose={dismissCurrent} banner={<CalendarDays className="relative h-10 w-10 text-brand-500" />}>
        <h2 id="demo-invite-title" className="text-xl font-medium text-foreground">See Aavishield live</h2>
        <p className="mx-auto mt-2 max-w-[34ch] text-sm leading-relaxed text-muted-foreground">
          Book a free 30-minute demo. We&apos;ll walk through your own console and answer questions about rolling it out.
        </p>
        <div className="mt-6 grid gap-2.5">
          <button type="button" onClick={() => { answer("demo", "done"); setPhase(null); setQueue([]); openBookDemo(); }} className={primaryBtn}>
            Book a demo <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </button>
          <button type="button" onClick={dismissCurrent} className="mt-1 text-sm text-muted-foreground hover:text-foreground">No thanks</button>
        </div>
      </Modal>
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
          <button type="button" onClick={advance} aria-label="End tour" className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-elevated hover:text-foreground">
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
            {!last && <button type="button" onClick={advance} className="h-8 rounded-md px-3 text-sm text-muted-foreground hover:text-foreground">Skip</button>}
            <button
              type="button"
              onClick={() => (last ? advance() : setStep(step + 1))}
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

function Modal({ labelledBy, onClose, banner, children }: { labelledBy: string; onClose: () => void; banner: ReactNode; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/30 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
      <div className="w-full max-w-[440px] overflow-hidden rounded-xl border border-border bg-background shadow-2xl">
        <div className="relative grid h-36 place-items-center border-b border-border bg-[radial-gradient(circle,rgb(255_112_0/0.12)_1px,transparent_1px)] [background-size:16px_16px]">
          <div className="absolute inset-0 bg-gradient-to-b from-transparent to-brand-500/[0.06]" />
          {banner}
          <button type="button" onClick={onClose} aria-label="Close" className="absolute right-3 top-3 grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-7 pb-7 pt-6 text-center">{children}</div>
      </div>
    </div>
  );
}
