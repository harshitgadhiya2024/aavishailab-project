"use client";

import { ArrowRight, CaretDown, Check, CheckCircle, CircleNotch, LinkSimple } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

// Same field style as the contact form; the error variant swaps the accent.
const field =
  "h-12 w-full rounded-[4px] border bg-surface px-4 text-[15px] text-fg placeholder:text-muted transition-[border-color,box-shadow] focus:outline-none focus:ring-4";
const fieldOk = "border-line-strong focus:border-brand focus:ring-brand/20";
const fieldBad = "border-danger focus:border-danger focus:ring-danger/15";

export const TEAM_SIZES = ["1–25", "26–100", "101–500", "500+"];
export const ROLES = ["IT or security", "Founder or leadership", "Operations", "Engineering", "Other"];

// Remembered in this browser only, so a returning visitor sees that they're
// already on the list instead of the form. Purely a convenience: the server
// is what keeps one entry per email.
const JOINED_KEY = "aavishield-waitlist-joined";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The remembered first name, or null. Read through useSyncExternalStore so the
// server render (always the form) and the first browser render agree.
const noSubscribe = () => () => {};
function readJoined(): string | null {
  try {
    return localStorage.getItem(JOINED_KEY);
  } catch {
    return null; // storage blocked: show the form
  }
}

type Status = "idle" | "sending" | "done" | "error";
type Errors = Partial<Record<"name" | "email" | "company", string>>;

function validate(get: (k: string) => string): Errors {
  const e: Errors = {};
  if (!get("name")) e.name = "Enter your name.";
  if (!get("email")) e.email = "Enter your work email.";
  else if (!EMAIL.test(get("email"))) e.email = "That email doesn't look right.";
  if (!get("company")) e.company = "Enter your company.";
  return e;
}

/**
 * The waitlist sign-up: name, work email and company, with team size and role
 * optional. Posts to /api/waitlist, which forwards it to admin-api; the entry
 * then shows up in the superadmin panel under Waitlist.
 *
 * Every "#join" link on the page scrolls here and puts the cursor in the
 * first field, so one click goes from any call to action to typing.
 */
export function WaitlistForm({ id = "join" }: { id?: string }) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [firstName, setFirstName] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  // Already joined from this browser: show the confirmation straight away.
  const remembered = useSyncExternalStore(noSubscribe, readJoined, () => null);
  const done = status === "done" || remembered !== null;
  const shownName = firstName || remembered || "";

  // "#join" links scroll to the form and focus the first field.
  useEffect(() => {
    const focusForm = () => {
      boxRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(() => nameRef.current?.focus({ preventScroll: true }), 450);
    };
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest?.(`a[href="#${id}"]`);
      if (!a) return;
      e.preventDefault();
      history.replaceState(null, "", `#${id}`);
      focusForm();
    };
    document.addEventListener("click", onClick);
    if (window.location.hash === `#${id}`) focusForm();
    return () => document.removeEventListener("click", onClick);
  }, [id]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const get = (k: string) => String(data.get(k) ?? "").trim();
    const found = validate(get);
    setErrors(found);
    if (Object.keys(found).length) {
      setError("");
      setStatus("error");
      // Put the cursor in the first field that needs fixing.
      const first = (["name", "email", "company"] as const).find((k) => found[k]);
      e.currentTarget.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus();
      return;
    }
    setStatus("sending");
    setError("");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: get("name"),
          email: get("email"),
          company: get("company"),
          team_size: get("team_size"),
          role: get("role"),
          website: get("website"),
          // Page plus campaign parameters, so the team can see where sign-ups come from.
          source: window.location.pathname + window.location.search,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Could not add you to the list. Please try again.");
      }
      const first = get("name").split(" ")[0];
      setFirstName(first);
      setStatus("done");
      try {
        localStorage.setItem(JOINED_KEY, first);
      } catch {
        /* storage blocked: fine, the confirmation still shows now */
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add you to the list. Please try again.");
      setStatus("error");
    }
  }

  const clear = (k: keyof Errors) => () => errors[k] && setErrors((prev) => ({ ...prev, [k]: undefined }));

  return (
    <div id={id} ref={boxRef} className="relative scroll-mt-24 rounded-[6px] border border-line-strong bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-fg">
          {done ? "You're on the list" : "Join the waitlist"}
        </span>
        <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
          <span className="size-1.5 bg-brand" /> {done ? "Early access" : "Takes 30 seconds"}
        </span>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {done ? (
          <Joined key="done" firstName={shownName} />
        ) : (
          <motion.form key="form" noValidate onSubmit={onSubmit} exit={{ opacity: 0, y: -8 }} className="grid gap-4 p-5 md:p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="wl-name" label="Full name" error={errors.name}>
                <input
                  ref={nameRef}
                  id="wl-name"
                  name="name"
                  autoComplete="name"
                  onInput={clear("name")}
                  aria-invalid={!!errors.name}
                  aria-describedby={errors.name ? "wl-name-err" : undefined}
                  className={`${field} ${errors.name ? fieldBad : fieldOk}`}
                  placeholder="Ananya Iyer"
                />
              </Field>
              <Field id="wl-email" label="Work email" error={errors.email}>
                <input
                  id="wl-email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  onInput={clear("email")}
                  aria-invalid={!!errors.email}
                  aria-describedby={errors.email ? "wl-email-err" : undefined}
                  className={`${field} ${errors.email ? fieldBad : fieldOk}`}
                  placeholder="you@company.com"
                />
              </Field>
            </div>
            <Field id="wl-company" label="Company" error={errors.company}>
              <input
                id="wl-company"
                name="company"
                autoComplete="organization"
                onInput={clear("company")}
                aria-invalid={!!errors.company}
                aria-describedby={errors.company ? "wl-company-err" : undefined}
                className={`${field} ${errors.company ? fieldBad : fieldOk}`}
                placeholder="Acme Inc."
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="wl-size" label="Team size" hint="Optional">
                <Select id="wl-size" name="team_size" placeholder="Select" options={TEAM_SIZES.map((s) => ({ value: s, label: `${s} people` }))} />
              </Field>
              <Field id="wl-role" label="Your role" hint="Optional">
                <Select id="wl-role" name="role" placeholder="Select" options={ROLES.map((r) => ({ value: r, label: r }))} />
              </Field>
            </div>

            {/* Honeypot: hidden from people, filled in by bots. */}
            <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
              <label htmlFor="wl-website">Website</label>
              <input id="wl-website" name="website" tabIndex={-1} autoComplete="off" />
            </div>

            {error && (
              <p role="alert" className="rounded-[4px] border border-danger/40 px-4 py-3 text-sm text-danger">{error}</p>
            )}

            <button
              type="submit"
              disabled={status === "sending"}
              className="group/gb mt-1 inline-flex h-12 items-center justify-center gap-2.5 rounded-[6px] bg-brand px-6 font-mono text-[12px] font-medium uppercase tracking-[0.06em] text-on-brand transition-[background-color,transform,opacity] duration-200 hover:bg-brand-dark active:scale-[0.98] disabled:opacity-70"
            >
              {status === "sending" ? <CircleNotch size={16} weight="bold" className="animate-spin" /> : null}
              {status === "sending" ? "Joining…" : "Join the waitlist"}
              {status !== "sending" && <ArrowRight size={14} weight="bold" className="transition-transform duration-300 group-hover/gb:translate-x-0.5" />}
            </button>
            <p className="text-[12.5px] leading-relaxed text-muted">
              Free, no commitment. We&apos;ll only email you about early access. Read our{" "}
              <Link href="/privacy-policy" className="text-brand-ink underline underline-offset-2">privacy policy</Link>.
            </p>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}

/** The confirmation: what happens next, and a link to pass to a colleague. */
function Joined({ firstName }: { firstName: string }) {
  const [copied, setCopied] = useState(false);
  const steps = [
    "A confirmation is on its way to your inbox.",
    "We open spots to teams in small groups.",
    "When it's your turn, you get an invitation to set up.",
  ];

  const copy = async () => {
    // Tagged so the team can see which sign-ups came from a colleague's link.
    const url = `${window.location.origin}/waitlist?utm_source=referral`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2400);
    } catch {
      window.prompt("Copy this link", url);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="p-6 md:p-7">
      <span className="grid size-12 place-items-center rounded-[6px] bg-brand text-on-brand">
        <CheckCircle size={26} weight="fill" />
      </span>
      <h3 className="mt-5 text-[1.6rem] font-normal tracking-[-0.03em] text-fg">
        You&apos;re on the list{firstName ? `, ${firstName}` : ""}.
      </h3>
      <ol className="mt-5 grid gap-3">
        {steps.map((s, i) => (
          <li key={s} className="flex items-start gap-3 text-[15px] leading-relaxed text-fg-2">
            <span className="mt-0.5 font-mono text-[11px] text-brand-ink">{String(i + 1).padStart(2, "0")}</span>
            {s}
          </li>
        ))}
      </ol>
      <div className="mt-7 rounded-[6px] border border-line bg-bg p-4">
        <p className="text-sm font-medium text-fg">Know a team that needs this?</p>
        <p className="mt-1 text-[13px] text-muted">Share the waitlist with a colleague.</p>
        <button
          type="button"
          onClick={copy}
          className="mt-3 inline-flex h-10 items-center gap-2 rounded-[6px] border border-fg/70 bg-surface px-4 font-mono text-[11.5px] font-medium uppercase tracking-[0.06em] text-fg transition-colors hover:bg-bg-2"
        >
          {copied ? <Check size={14} weight="bold" /> : <LinkSimple size={14} weight="bold" />}
          {copied ? "Link copied" : "Copy link for a colleague"}
        </button>
      </div>
    </motion.div>
  );
}

/** A native select styled like the other fields: a caret, and placeholder-grey text until something is picked. */
function Select({ id, name, placeholder, options }: { id: string; name: string; placeholder: string; options: { value: string; label: string }[] }) {
  const [value, setValue] = useState("");
  return (
    <div className="relative">
      <select
        id={id}
        name={name}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={`${field} ${fieldOk} appearance-none pr-10 ${value ? "" : "text-muted"}`}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => <option key={o.value} value={o.value} className="text-fg">{o.label}</option>)}
      </select>
      <CaretDown size={14} weight="bold" aria-hidden className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-muted" />
    </div>
  );
}

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="flex items-center justify-between text-sm font-medium text-fg">
        {label}
        {hint && <span className="font-mono text-[10px] font-normal uppercase tracking-[0.08em] text-muted">{hint}</span>}
      </label>
      {children}
      {error && <p id={`${id}-err`} className="text-[13px] text-danger">{error}</p>}
    </div>
  );
}
