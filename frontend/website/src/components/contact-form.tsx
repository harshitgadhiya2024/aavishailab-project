"use client";

import { CheckCircle, CircleNotch } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";

type Status = "idle" | "sending" | "sent" | "error";
type Errors = Partial<Record<"name" | "email" | "company" | "devices", string>>;

const field =
  "h-12 w-full rounded-xl border border-line-strong bg-surface px-4 text-[15px] text-fg placeholder:text-muted transition-[border-color,box-shadow] focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/20";

function validate(data: FormData): Errors {
  const e: Errors = {};
  if (!String(data.get("name") || "").trim()) e.name = "Please tell us your name.";
  const email = String(data.get("email") || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = "Enter a valid work email.";
  if (!String(data.get("company") || "").trim()) e.company = "Which company are you with?";
  if (!String(data.get("devices") || "")) e.devices = "Pick a rough device count.";
  return e;
}

export function ContactForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [errors, setErrors] = useState<Errors>({});

  async function onSubmit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const data = new FormData(ev.currentTarget);
    const found = validate(data);
    setErrors(found);
    if (Object.keys(found).length) return;
    setStatus("sending");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(data)),
      });
      setStatus(res.ok ? "sent" : "error");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="relative overflow-hidden rounded-[20px] border border-line bg-surface p-6 shadow-[var(--shadow)] md:p-10">
      <AnimatePresence mode="wait" initial={false}>
        {status === "sent" ? (
          <motion.div
            key="sent"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 24 }}
            className="grid min-h-[440px] place-items-center text-center"
          >
            <div>
              <motion.span
                initial={{ scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 300, damping: 16, delay: 0.1 }}
                className="mx-auto grid size-16 place-items-center rounded-full bg-brand text-on-brand"
              >
                <CheckCircle size={30} weight="fill" />
              </motion.span>
              <h2 className="mt-6 text-2xl font-semibold tracking-tight text-fg">Request received</h2>
              <p className="mx-auto mt-2 max-w-[36ch] text-muted">We will reply within one business day to schedule your demo.</p>
            </div>
          </motion.div>
        ) : (
          <motion.form key="form" noValidate onSubmit={onSubmit} exit={{ opacity: 0, y: -8 }} className="grid gap-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field id="name" label="Full name" error={errors.name}>
                <input id="name" name="name" autoComplete="name" className={field} aria-invalid={!!errors.name} aria-describedby="name-err" />
              </Field>
              <Field id="email" label="Work email" error={errors.email}>
                <input id="email" name="email" type="email" autoComplete="email" className={field} aria-invalid={!!errors.email} aria-describedby="email-err" />
              </Field>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field id="company" label="Company" error={errors.company}>
                <input id="company" name="company" autoComplete="organization" className={field} aria-invalid={!!errors.company} aria-describedby="company-err" />
              </Field>
              <Field id="devices" label="Number of devices" error={errors.devices}>
                <select id="devices" name="devices" defaultValue="" className={`${field} appearance-none`} aria-invalid={!!errors.devices} aria-describedby="devices-err">
                  <option value="" disabled>Select a range</option>
                  <option>1 to 50</option>
                  <option>51 to 250</option>
                  <option>251 to 1,000</option>
                  <option>More than 1,000</option>
                </select>
              </Field>
            </div>
            <Field id="message" label="What would you like to see?" hint="Optional. For example: AI tool governance, or DLP for Outlook.">
              <textarea id="message" name="message" rows={4} className={`${field} h-auto resize-none py-3`} aria-describedby="message-hint" />
            </Field>

            {status === "error" && (
              <p role="alert" className="rounded-xl border border-danger/40 px-4 py-3 text-sm text-danger">
                Something went wrong sending your request. Please try again.
              </p>
            )}

            <button
              type="submit"
              disabled={status === "sending"}
              className="mt-2 inline-flex h-12 items-center justify-center gap-2 rounded-full bg-brand px-7 text-[15px] font-medium text-on-brand hover:bg-brand-dark transition-[transform,opacity] duration-200 active:scale-[0.98] disabled:opacity-70"
            >
              {status === "sending" && <CircleNotch size={16} weight="bold" className="animate-spin" />}
              {status === "sending" ? "Sending" : "Book a demo"}
            </button>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}

function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-sm font-medium text-fg">{label}</label>
      {children}
      {hint && <p id={`${id}-hint`} className="text-[13px] text-muted">{hint}</p>}
      <AnimatePresence>
        {error && (
          <motion.p id={`${id}-err`} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-[13px] text-danger">
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
