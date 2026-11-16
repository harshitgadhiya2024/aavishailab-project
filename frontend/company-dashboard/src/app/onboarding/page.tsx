"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, ExternalLink, Laptop, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { activityApi, onboardingApi } from "@/lib/api";
import { AUTH_ARROW, AUTH_BUTTON, AUTH_HINT, AUTH_LABEL, AUTH_LINK, AuthHeading, AuthShell } from "@/components/brand/AuthShell";

/*
 * First-run wizard for companies that signed up on their own:
 * a couple of questions → a starter web policy → install on your own laptop
 * and watch it work → choose a plan to roll out to the team → done.
 * The trial covers one device until the team step, then up to 25.
 */

const WEBSITE_URL = process.env.NEXT_PUBLIC_WEBSITE_URL || "https://aavishield.com";

function portalUrl() {
  if (process.env.NEXT_PUBLIC_PORTAL_URL) return process.env.NEXT_PUBLIC_PORTAL_URL;
  if (typeof window !== "undefined" && window.location.hostname === "localhost") return "http://localhost:1003";
  return "https://employee.aavishield.com";
}

const STEPS = ["About you", "Protection", "Your laptop", "Your team", "Done"] as const;

const TEAM_SIZES = ["1–10", "11–50", "51–250", "250+"];
const HEARD_FROM = ["Google search", "LinkedIn", "Instagram", "X (Twitter)", "A friend or colleague", "AI assistant", "Other"];

// What people want to stop, and the web categories each one blocks.
const GOALS: { id: string; label: string; categories: string[] }[] = [
  { id: "ai", label: "Data leaking into AI tools", categories: ["ai_tools"] },
  { id: "risky", label: "Risky and distracting sites", categories: ["social_media", "gambling", "adult_content", "torrent", "dating"] },
  { id: "vpn", label: "VPNs and proxies", categories: ["vpn_proxy"] },
  { id: "uploads", label: "Files sent to personal email and cloud", categories: ["webmail_personal_email", "cloud_storage"] },
  { id: "time", label: "Streaming and gaming at work", categories: ["streaming", "gaming"] },
];

const CATEGORY_LABEL: Record<string, string> = {
  ai_tools: "AI tools", social_media: "Social media", gambling: "Gambling", adult_content: "Adult content",
  torrent: "Torrents", dating: "Dating", vpn_proxy: "VPNs and proxies", webmail_personal_email: "Personal email",
  cloud_storage: "Personal cloud storage", streaming: "Streaming", gaming: "Gaming", shopping: "Shopping",
  job_search: "Job search",
};

const chip = (on: boolean) =>
  `rounded-[6px] border px-3 py-2 text-left text-[13px] transition-colors ${
    on ? "border-[#ff7000] bg-[#fff1e5] text-[#0b0b0d]" : "border-[rgb(11_11_13/0.12)] bg-white text-[#3f3f46] hover:border-[rgb(11_11_13/0.3)]"
  }`;

const GHOST_BUTTON =
  "flex h-12 w-full items-center justify-center rounded-[6px] border border-[rgb(11_11_13/0.14)] font-mono text-[12px] uppercase tracking-[0.06em] text-[#3f3f46] transition-colors hover:bg-[#fafafa]";

type Onboarding = {
  self_serve: boolean;
  onboarded: boolean;
  org_name: string;
  plan_interest: string;
  trial_ends_at: string | null;
  trial_device_limit: number;
  team_trial: boolean;
  answers: { team_size?: string; goals?: string[]; heard_from?: string; seats?: number };
  starter_categories: string[];
  progress: { policies: number; devices: number; online_devices: number };
};

type Plan = { key: string; name: string; price_inr: number; price_usd_cents: number; features: string[]; popular: boolean };

export default function OnboardingPage() {
  const { data: session } = useSession();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);

  const { data: ob, isLoading } = useQuery({
    queryKey: ["onboarding"],
    queryFn: async () => (await onboardingApi.get()).data as Onboarding,
    // Poll while waiting for the first device to connect.
    refetchInterval: step === 2 ? 5000 : false,
  });

  // Step 1 answers.
  const [teamSize, setTeamSize] = useState("");
  const [goals, setGoals] = useState<string[]>([]);
  const [heardFrom, setHeardFrom] = useState("");
  // Step 2 categories.
  const [categories, setCategories] = useState<string[]>([]);

  useEffect(() => {
    if (!ob) return;
    // Pick up where the admin left off on a reload.
    setTeamSize(s => s || ob.answers.team_size || "");
    setGoals(g => (g.length ? g : ob.answers.goals || []));
    setHeardFrom(h => h || ob.answers.heard_from || "");
    if (ob.starter_categories.length) setCategories(c => (c.length ? c : ob.starter_categories));
  }, [ob]);

  const fail = (err: any, fallback: string) => toast.error(err?.response?.data?.error || fallback);

  async function saveAnswers() {
    setBusy(true);
    try {
      await onboardingApi.saveAnswers({ team_size: teamSize, goals, heard_from: heardFrom });
      if (!categories.length) {
        const fromGoals = GOALS.filter(g => goals.includes(g.id)).flatMap(g => g.categories);
        setCategories(Array.from(new Set(fromGoals.length ? fromGoals : ["ai_tools", "gambling", "adult_content", "vpn_proxy"])));
      }
      setStep(1);
    } catch (err) {
      fail(err, "Could not save your answers.");
    } finally {
      setBusy(false);
    }
  }

  async function savePolicy() {
    setBusy(true);
    try {
      await onboardingApi.starterPolicy(categories);
      await qc.invalidateQueries({ queryKey: ["onboarding"] });
      setStep(2);
    } catch (err) {
      fail(err, "Could not turn on protection.");
    } finally {
      setBusy(false);
    }
  }

  if (isLoading || !ob) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#fafafa]">
        <Loader2 className="h-5 w-5 animate-spin text-[#ff7000]" />
      </div>
    );
  }

  const panel = [
    { headline: "Welcome to Aavishield.", lead: "Two quick questions, then we'll set up protection that fits your company." },
    { headline: "Protection, on in one click.", lead: "Blocked sites are logged with a reason anyone can read. Data loss prevention watches every upload and never blocks work." },
    { headline: "See it work on your own laptop.", lead: "Install the agent on your laptop and watch your first events arrive in the console within minutes." },
    { headline: "Roll it out to your team.", lead: "Choose a plan and team size. The trial is free for 14 days, and nothing is charged automatically." },
    { headline: "You're set up.", lead: "Your console is ready. Here's what to do next." },
  ][step];

  return (
    <AuthShell
      headline={panel.headline}
      lead={panel.lead}
      wide={step === 3}
      topRight={<Link href="/dashboard" className={`font-medium ${AUTH_LINK}`}>Skip setup</Link>}
    >
      <Progress step={step} />

      {step === 0 && (
        <>
          <AuthHeading eyebrow="Step 1 · About you" title={`Hi${session?.user?.name ? ` ${session.user.name.split(" ")[0]}` : ""}, a couple of questions`}>
            This shapes your starter policy. You can change everything later.
          </AuthHeading>
          <div className="mt-6 space-y-5">
            <div>
              <p className={AUTH_LABEL}>How many people work at {ob.org_name}?</p>
              <div className="grid grid-cols-4 gap-2">
                {TEAM_SIZES.map(s => (
                  <button key={s} type="button" onClick={() => setTeamSize(s)} className={`${chip(teamSize === s)} text-center`}>{s}</button>
                ))}
              </div>
            </div>
            <div>
              <p className={AUTH_LABEL}>What do you want to stop?</p>
              <div className="grid gap-2">
                {GOALS.map(g => {
                  const on = goals.includes(g.id);
                  return (
                    <button key={g.id} type="button" onClick={() => setGoals(on ? goals.filter(x => x !== g.id) : [...goals, g.id])} className={`${chip(on)} flex items-center justify-between`}>
                      {g.label}
                      {on && <Check className="h-4 w-4 text-[#ff7000]" />}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <p className={AUTH_LABEL}>How did you hear about us?</p>
              <div className="flex flex-wrap gap-2">
                {HEARD_FROM.map(h => (
                  <button key={h} type="button" onClick={() => setHeardFrom(h)} className={chip(heardFrom === h)}>{h}</button>
                ))}
              </div>
            </div>
            <button type="button" onClick={saveAnswers} disabled={busy || !teamSize} className={AUTH_BUTTON}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Continue
              {!busy && <ArrowRight className={AUTH_ARROW} />}
            </button>
          </div>
        </>
      )}

      {step === 1 && (
        <>
          <AuthHeading eyebrow="Step 2 · Protection" title="Your starter policy">
            We picked these from your answers. Tick or untick anything.
          </AuthHeading>
          <div className="mt-6 space-y-5">
            <div>
              <p className={AUTH_LABEL}>Block these websites for everyone</p>
              <div className="grid grid-cols-2 gap-2">
                {Object.keys(CATEGORY_LABEL).map(cat => {
                  const on = categories.includes(cat);
                  return (
                    <button key={cat} type="button" onClick={() => setCategories(on ? categories.filter(c => c !== cat) : [...categories, cat])} className={`${chip(on)} flex items-center justify-between`}>
                      {CATEGORY_LABEL[cat]}
                      {on && <Check className="h-4 w-4 text-[#ff7000]" />}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex gap-3 rounded-[6px] border border-[rgb(11_11_13/0.1)] bg-[#fafafa] p-4 text-[13px] text-[#3f3f46]">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#ff7000]" />
              <p>
                <span className="font-medium text-[#0b0b0d]">Data loss prevention is on automatically.</span>{" "}
                It reads uploads, messages and email for card numbers, Aadhaar, PAN, API keys and more, and never blocks work.
                Screenshots stay off during the free trial.
              </p>
            </div>
            <button type="button" onClick={savePolicy} disabled={busy} className={AUTH_BUTTON}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Turn on protection
              {!busy && <ArrowRight className={AUTH_ARROW} />}
            </button>
            <button type="button" onClick={() => setStep(0)} className={`w-full text-center text-[13px] ${AUTH_LINK}`}>← Back</button>
          </div>
        </>
      )}

      {step === 2 && <InstallStep ob={ob} email={session?.user?.email || ""} onNext={() => setStep(3)} onBack={() => setStep(1)} />}

      {step === 3 && <TeamStep ob={ob} onNext={() => setStep(4)} onSkip={() => setStep(4)} />}

      {step === 4 && <DoneStep ob={ob} />}
    </AuthShell>
  );
}

function Progress({ step }: { step: number }) {
  return (
    <div className="mb-8">
      <div className="flex gap-1.5">
        {STEPS.map((s, i) => (
          <div key={s} className={`h-1 flex-1 rounded-full ${i <= step ? "bg-[#ff7000]" : "bg-[rgb(11_11_13/0.08)]"}`} />
        ))}
      </div>
      <p className="mt-2 font-mono text-[10.5px] uppercase tracking-[0.1em] text-[#71717a]">
        {step + 1} of {STEPS.length} · {STEPS[step]}
      </p>
    </div>
  );
}

function InstallStep({ ob, email, onNext, onBack }: { ob: Onboarding; email: string; onNext: () => void; onBack: () => void }) {
  const connected = ob.progress.devices > 0;
  // Once a device is in, watch for its first event.
  const { data: events } = useQuery({
    queryKey: ["onboarding-first-events"],
    queryFn: async () => Number((await activityApi.list({ limit: 1 })).data?.total ?? 0),
    enabled: connected,
    refetchInterval: connected ? 5000 : false,
  });
  const firstEvent = (events ?? 0) > 0;
  const portal = portalUrl();

  return (
    <>
      <AuthHeading eyebrow="Step 3 · Your laptop" title="Install on your own laptop first">
        The trial starts with one device, so you can see exactly what your team will get.
      </AuthHeading>
      <ol className="mt-6 space-y-3 text-[13.5px] text-[#3f3f46]">
        <Item n={1} done={connected}>
          Open the{" "}
          <a href={portal} target="_blank" rel="noreferrer" className={`inline-flex items-center gap-1 font-medium underline underline-offset-2 ${AUTH_LINK}`}>
            employee portal <ExternalLink className="h-3.5 w-3.5" />
          </a>{" "}
          and sign in with <span className="font-medium text-[#0b0b0d]">{email || "your work email"}</span> and the password you just chose.
        </Item>
        <Item n={2} done={connected}>Download the installer for your computer and run it. It connects to your organization on its own.</Item>
        <Item n={3} done={firstEvent}>
          Try it: open a site you blocked in step 2, or upload a test file with a sample card number to Gmail or ChatGPT.
        </Item>
      </ol>

      <div className="mt-5 flex items-center gap-3 rounded-[6px] border border-[rgb(11_11_13/0.1)] bg-[#fafafa] p-4 text-[13px]">
        {connected ? <Laptop className="h-4 w-4 text-[#16a34a]" /> : <Loader2 className="h-4 w-4 animate-spin text-[#ff7000]" />}
        <span className="text-[#3f3f46]">
          {!connected && "Waiting for your laptop to connect…"}
          {connected && !firstEvent && "Your laptop is connected. Waiting for its first event…"}
          {connected && firstEvent && (
            <>
              Your first event has arrived.{" "}
              <a href="/dashboard/activity" target="_blank" rel="noreferrer" className={`font-medium underline underline-offset-2 ${AUTH_LINK}`}>See it in Activity</a>
            </>
          )}
        </span>
      </div>

      <div className="mt-6 space-y-3">
        <button type="button" onClick={onNext} className={AUTH_BUTTON}>
          {connected ? "Continue" : "I'll do this later"}
          <ArrowRight className={AUTH_ARROW} />
        </button>
        <button type="button" onClick={onBack} className={`w-full text-center text-[13px] ${AUTH_LINK}`}>← Back</button>
      </div>
    </>
  );
}

function Item({ n, done, children }: { n: number; done: boolean; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className={`grid size-6 shrink-0 place-items-center rounded-full font-mono text-[11px] ${done ? "bg-[#16a34a] text-white" : "border border-[rgb(11_11_13/0.15)] text-[#71717a]"}`}>
        {done ? <Check className="h-3.5 w-3.5" /> : n}
      </span>
      <span className="pt-0.5">{children}</span>
    </li>
  );
}

function TeamStep({ ob, onNext, onSkip }: { ob: Onboarding; onNext: () => void; onSkip: () => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["public-pricing"],
    queryFn: async () => (await onboardingApi.pricing()).data as { plans: Plan[] },
  });
  // Self-serve covers the two smaller plans; Enterprise goes through sales.
  const plans = useMemo(() => (data?.plans ?? []).filter(p => p.key === "starter" || p.key === "professional"), [data]);
  const sizeSeats: Record<string, number> = { "1–10": 10, "11–50": 50, "51–250": 150, "250+": 250 };
  const [choice, setChoice] = useState<"essentials" | "business">(ob.plan_interest === "business" ? "business" : "essentials");
  const [seats, setSeats] = useState<number>(ob.answers.seats || sizeSeats[ob.answers.team_size || ""] || 10);
  const [currency, setCurrency] = useState<"INR" | "USD">("INR");
  const [busy, setBusy] = useState(false);

  const planFor = (c: "essentials" | "business") => plans.find(p => p.key === (c === "essentials" ? "starter" : "professional"));
  const selected = planFor(choice);
  const yearly = selected ? (currency === "INR" ? selected.price_inr * seats : (selected.price_usd_cents * seats) / 100) : 0;
  const money = (n: number) =>
    currency === "INR" ? `₹${Math.round(n).toLocaleString("en-IN")}` : `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

  async function start() {
    setBusy(true);
    try {
      await onboardingApi.teamTrial({ plan: choice, seats });
      await qc.invalidateQueries({ queryKey: ["onboarding"] });
      toast.success("Your team trial has started");
      onNext();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Could not start the team trial.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AuthHeading eyebrow="Step 4 · Your team" title="Choose a plan for your team">
        Your 14-day trial opens up to 25 devices. You pay nothing today, and we&apos;ll remind you before the trial ends.
      </AuthHeading>

      <div className="mt-6 flex items-center justify-between">
        <p className={`${AUTH_LABEL} mb-0`}>Team size: <span className="font-mono">{seats}</span> {seats === 1 ? "person" : "people"}</p>
        <div className="flex rounded-[6px] border border-[rgb(11_11_13/0.12)] p-0.5 font-mono text-[11px]">
          {(["INR", "USD"] as const).map(c => (
            <button key={c} type="button" onClick={() => setCurrency(c)} className={`rounded-[4px] px-2.5 py-1 ${currency === c ? "bg-[#0b0b0d] text-white" : "text-[#5d5d66]"}`}>{c}</button>
          ))}
        </div>
      </div>
      <input type="range" min={1} max={250} value={seats} onChange={e => setSeats(Number(e.target.value))} className="mt-3 w-full accent-[#ff7000]" aria-label="Team size" />

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {(["essentials", "business"] as const).map(c => {
          const p = planFor(c);
          const on = choice === c;
          return (
            <button key={c} type="button" onClick={() => setChoice(c)} className={`rounded-[8px] border p-4 text-left transition-colors ${on ? "border-[#ff7000] bg-[#fff8f2]" : "border-[rgb(11_11_13/0.12)] bg-white hover:border-[rgb(11_11_13/0.3)]"}`}>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-[#c2410c]">{p?.name || (c === "essentials" ? "Essentials" : "Business")}</span>
                {p?.popular && <span className="rounded-[4px] bg-[#0b0b0d] px-1.5 py-0.5 font-mono text-[9.5px] uppercase text-white">Popular</span>}
              </div>
              <p className="mt-2 text-[22px] font-medium text-[#0b0b0d]">
                {p ? money(currency === "INR" ? p.price_inr : p.price_usd_cents / 100) : "—"}
                <span className="text-[12px] font-normal text-[#71717a]"> / device / year</span>
              </p>
              <ul className="mt-3 space-y-1.5 text-[12.5px] text-[#3f3f46]">
                {(p?.features ?? []).slice(0, 4).map(f => (
                  <li key={f} className="flex gap-1.5"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#ff7000]" />{f}</li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>

      <div className="mt-5 rounded-[6px] border border-[rgb(11_11_13/0.1)] bg-[#fafafa] p-4 text-[13px]">
        <div className="flex justify-between text-[#3f3f46]"><span>After the trial, per year</span><span className="font-medium text-[#0b0b0d]">{selected ? money(yearly) : "—"}</span></div>
        <div className="mt-1 flex justify-between text-[#3f3f46]"><span>Due today</span><span className="font-medium text-[#0b0b0d]">{currency === "INR" ? "₹0" : "$0"}</span></div>
        <p className={AUTH_HINT}>Prices before tax. Nothing is charged automatically when the trial ends.</p>
      </div>

      <div className="mt-6 space-y-3">
        <button type="button" onClick={start} disabled={busy || !selected} className={AUTH_BUTTON}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Start team trial · {currency === "INR" ? "₹0" : "$0"} today
          {!busy && <ArrowRight className={AUTH_ARROW} />}
        </button>
        <button type="button" onClick={onSkip} className={GHOST_BUTTON}>Not yet, keep exploring</button>
        <p className="text-center text-[13px] text-[#5d5d66]">
          More than 250 people?{" "}
          <a href={`${WEBSITE_URL}/contact`} target="_blank" rel="noreferrer" className={`font-medium ${AUTH_LINK}`}>Talk to sales</a>
        </p>
      </div>
    </>
  );
}

function DoneStep({ ob }: { ob: Onboarding }) {
  const [busy, setBusy] = useState(false);
  const ends = ob.trial_ends_at ? new Date(ob.trial_ends_at).toLocaleDateString("en-IN", { day: "numeric", month: "long" }) : "";

  async function finish() {
    setBusy(true);
    try {
      await onboardingApi.complete();
    } catch {
      // Finishing is only a marker; go to the dashboard either way.
    }
    window.location.href = "/dashboard";
  }

  const next = [
    { done: ob.progress.policies > 0, text: "Starter web policy is on" },
    { done: ob.progress.devices > 0, text: "Your laptop is protected" },
    { done: ob.team_trial, text: ob.team_trial ? `Team trial open for up to ${ob.trial_device_limit} devices` : "Choose a plan to add your team" },
    { done: false, text: "Invite your team from Employees, so they can install the agent" },
  ];

  return (
    <>
      <AuthHeading eyebrow="Step 5 · Done" title="Your console is ready">
        {ends ? `Your free trial runs until ${ends}.` : "Your free trial has started."}
      </AuthHeading>
      <ul className="mt-6 space-y-3 text-[13.5px]">
        {next.map(n => (
          <li key={n.text} className="flex items-center gap-3 text-[#3f3f46]">
            <span className={`grid size-6 shrink-0 place-items-center rounded-full ${n.done ? "bg-[#16a34a] text-white" : "border border-[rgb(11_11_13/0.15)]"}`}>
              {n.done && <Check className="h-3.5 w-3.5" />}
            </span>
            {n.text}
          </li>
        ))}
      </ul>
      <button type="button" onClick={finish} disabled={busy} className={`mt-8 ${AUTH_BUTTON}`}>
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        Go to your dashboard
        {!busy && <ArrowRight className={AUTH_ARROW} />}
      </button>
    </>
  );
}
