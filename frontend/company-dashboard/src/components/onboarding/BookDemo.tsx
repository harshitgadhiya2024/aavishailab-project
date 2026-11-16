"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, CalendarCheck, CalendarDays, CalendarPlus, Check, Clock, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { demoApi, onboardingApi } from "@/lib/api";
import { isDemo } from "@/lib/demo";

/*
 * Book a 30-minute demo with the team from inside the console: pick a day
 * and a slot (shown in the visitor's own time zone), confirm a few details,
 * and get a confirmation with an "Add to calendar" file. Slots follow the
 * team's hours, Monday to Friday 10:00 to 18:00 India time, and slots booked
 * by other companies are greyed out. Opened from anywhere with openBookDemo().
 */

const OPEN_EVENT = "aavishield:book-demo";
const IST_OFFSET_MIN = 330; // India has no daylight saving.
const FIRST_SLOT_MIN = 10 * 60;
const LAST_SLOT_MIN = 17 * 60 + 30;
const DAYS_SHOWN = 10;

const TOPICS = ["Data loss prevention", "Web gateway", "App and VPN control", "Rolling out to my team", "Pricing and billing", "Compliance reports"];
const DEVICE_RANGES = ["10–25", "26–50", "51–250", "250+"];

export function openBookDemo() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

type Booking = { id: string; preferred_at: string; topics?: string[]; calendar_seq?: number; meeting_url?: string } | null;

/** The next business days in India time, as {y, m, d} of the India calendar date. */
function businessDays(now: Date) {
  const ist = new Date(now.getTime() + IST_OFFSET_MIN * 60000);
  const out: { y: number; m: number; d: number }[] = [];
  for (let i = 0; out.length < DAYS_SHOWN && i < 21; i++) {
    const day = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + i));
    const wd = day.getUTCDay();
    if (wd === 0 || wd === 6) continue;
    out.push({ y: day.getUTCFullYear(), m: day.getUTCMonth(), d: day.getUTCDate() });
  }
  return out;
}

/** Every 30-minute slot of an India-time day, as real instants. */
function slotsFor(day: { y: number; m: number; d: number }) {
  const out: Date[] = [];
  for (let min = FIRST_SLOT_MIN; min <= LAST_SLOT_MIN; min += 30) {
    out.push(new Date(Date.UTC(day.y, day.m, day.d, 0, min) - IST_OFFSET_MIN * 60000));
  }
  return out;
}

const fmtDay = (day: { y: number; m: number; d: number }) =>
  new Date(Date.UTC(day.y, day.m, day.d, 6)).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const fmtTime = (t: Date) => t.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const fmtWhen = (t: Date) => t.toLocaleString(undefined, { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" });

const icsStamp = (t: Date) => t.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

function demoDetails(meetingUrl?: string) {
  return "30-minute walkthrough of your Aavishield console with our team." +
    (meetingUrl ? `\n\nJoin: ${meetingUrl}` : "\n\nWe'll email the meeting link before the call.");
}

/** Opens Google Calendar with the demo filled in; the customer clicks Save. */
function openGoogleCalendar(start: Date, meetingUrl?: string) {
  const end = new Date(start.getTime() + 30 * 60000);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: "Aavishield demo",
    dates: `${icsStamp(start)}/${icsStamp(end)}`,
    details: demoDetails(meetingUrl),
  });
  if (meetingUrl) params.set("location", meetingUrl);
  window.open(`https://calendar.google.com/calendar/render?${params.toString()}`, "_blank", "noopener,noreferrer");
}

/**
 * An .ics file for Outlook / Apple Calendar. With the booking's id it has the
 * same UID as the invite we email, so the two don't become two events.
 */
function downloadIcs(start: Date, booking?: Booking) {
  const end = new Date(start.getTime() + 30 * 60000);
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  const uid = booking?.id ? `${booking.id}@aavishield.com` : `${icsStamp(start)}-demo@aavishield.com`;
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Aavishield//Demo booking//EN", "BEGIN:VEVENT",
    `UID:${uid}`, `SEQUENCE:${booking?.calendar_seq ?? 0}`, `DTSTAMP:${icsStamp(new Date())}`, `DTSTART:${icsStamp(start)}`, `DTEND:${icsStamp(end)}`,
    "SUMMARY:Aavishield demo", `DESCRIPTION:${esc(demoDetails(booking?.meeting_url))}`,
    ...(booking?.meeting_url ? [`LOCATION:${esc(booking.meeting_url)}`] : []),
    "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Aavishield demo in 15 minutes", "TRIGGER:-PT15M", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "aavishield-demo.ics";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function BookDemo() {
  const { data: session } = useSession();
  const qc = useQueryClient();
  const user = (session?.user ?? {}) as { email?: string; first_name?: string; full_name?: string; name?: string; org_name?: string };
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"time" | "details" | "done" | "booked">("time");
  const [dayIdx, setDayIdx] = useState(0);
  const [slot, setSlot] = useState<Date | null>(null);
  const [phone, setPhone] = useState("");
  const [devices, setDevices] = useState("");
  const [topics, setTopics] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const tz = useMemo(() => (typeof window === "undefined" ? "" : Intl.DateTimeFormat().resolvedOptions().timeZone), []);

  const { data } = useQuery({
    queryKey: ["demo-booking"],
    queryFn: async () => (await demoApi.get()).data as { booking: Booking; taken: string[] },
    enabled: open && !isDemo,
  });
  const { data: ob } = useQuery({
    queryKey: ["onboarding"],
    queryFn: async () => (await onboardingApi.get()).data as { answers?: { team_size?: string } },
    enabled: open,
    staleTime: 60_000,
  });

  useEffect(() => {
    const show = () => {
      setNow(new Date());
      setSlot(null);
      setStep("time");
      setOpen(true);
    };
    window.addEventListener(OPEN_EVENT, show);
    return () => window.removeEventListener(OPEN_EVENT, show);
  }, []);

  // A company that already has a demo booked sees it first, with a way to move it.
  useEffect(() => {
    if (open && data?.booking && step === "time" && !slot) setStep("booked");
  }, [open, data?.booking, step, slot]);

  useEffect(() => {
    if (!devices && ob?.answers?.team_size) {
      const s = ob.answers.team_size;
      setDevices(s === "1–10" || s === "11–50" ? "10–25" : s === "51–250" ? "51–250" : "250+");
    }
  }, [ob, devices]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const days = useMemo(() => businessDays(now), [now]);
  const taken = useMemo(() => new Set((data?.taken ?? []).map(t => new Date(t).getTime())), [data]);
  const earliest = now.getTime() + 60 * 60000;
  const daySlots = slotsFor(days[dayIdx]).map(t => ({ t, off: t.getTime() < earliest || taken.has(t.getTime()) }));
  const dayHasSlots = (i: number) => slotsFor(days[i]).some(t => t.getTime() >= earliest && !taken.has(t.getTime()));

  // Start on the first day that still has an open slot.
  useEffect(() => {
    if (!open) return;
    const first = days.findIndex((_, i) => dayHasSlots(i));
    if (first >= 0) setDayIdx(first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, data]);

  async function book() {
    if (!slot) return;
    setBusy(true);
    try {
      if (!isDemo) {
        await demoApi.book({ preferred_at: slot.toISOString(), timezone: tz, phone, devices, topics, message });
        await qc.invalidateQueries({ queryKey: ["demo-booking"] });
      }
      setStep("done");
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Could not book the demo. Please try another time.");
      if (err?.response?.status === 409) {
        await qc.invalidateQueries({ queryKey: ["demo-booking"] });
        setSlot(null);
        setStep("time");
      }
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!window.confirm("Cancel your demo? We'll remove it from your calendar too.")) return;
    setBusy(true);
    try {
      if (!isDemo) {
        await demoApi.cancel();
        await qc.invalidateQueries({ queryKey: ["demo-booking"] });
        await qc.invalidateQueries({ queryKey: ["onboarding"] });
      }
      toast.success("Your demo is cancelled.");
      setSlot(null);
      setStep("time");
      setOpen(false);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Could not cancel the demo.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;
  const booked = data?.booking ? new Date(data.booking.preferred_at) : null;
  const primary = "group inline-flex h-10 items-center justify-center gap-2 rounded-md bg-brand-500 px-5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50";
  const ghost = "inline-flex h-10 items-center justify-center gap-2 rounded-md border border-border px-4 text-sm text-foreground transition-colors hover:bg-elevated";
  const chip = (on: boolean) => `rounded-md border px-3 py-2 text-sm transition-colors ${on ? "border-brand-500 bg-brand-tint text-foreground" : "border-border text-muted-foreground hover:border-brand-500/40 hover:text-foreground"}`;

  return (
    <div className="fixed inset-0 z-[110] grid place-items-center bg-black/35 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="book-demo-title">
      <div className="flex max-h-[92vh] w-full max-w-[620px] flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div>
            <p className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-brand-600 dark:text-brand-300">Book a demo · 30 minutes</p>
            <h2 id="book-demo-title" className="mt-1 text-lg font-medium text-foreground">
              {step === "time" && "Pick a time that suits you"}
              {step === "details" && "A few details"}
              {step === "done" && "You're booked"}
              {step === "booked" && "Your demo is booked"}
            </h2>
          </div>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-elevated hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-5">
          {step === "booked" && booked && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-lg border border-border bg-elevated/50 p-4">
                <CalendarCheck className="mt-0.5 h-5 w-5 text-brand-500" />
                <div>
                  <p className="font-medium text-foreground">{fmtWhen(booked)}</p>
                  <p className="text-sm text-muted-foreground">
                    Your time zone: {tz}. The calendar invite went to {user.email}
                    {data?.booking?.meeting_url ? <>; <a href={data.booking.meeting_url} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline dark:text-brand-300">join link</a>.</> : <>, and the meeting link follows before the call.</>}
                  </p>
                </div>
              </div>
              <CalendarButtons start={booked} booking={data?.booking ?? null} ghost={ghost} />
              <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                <button type="button" onClick={() => setStep("time")} className={ghost}><Clock className="h-4 w-4" />Pick a new time</button>
                <button type="button" disabled={busy} onClick={cancel} className="inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm text-red-600 transition-colors hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400">
                  <X className="h-4 w-4" />Cancel demo
                </button>
              </div>
            </div>
          )}

          {step === "time" && (
            <div className="space-y-5">
              <div>
                <p className="mb-2 text-sm font-medium text-foreground">Day</p>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {days.map((d, i) => {
                    const ok = dayHasSlots(i);
                    return (
                      <button key={`${d.y}-${d.m}-${d.d}`} type="button" disabled={!ok} onClick={() => { setDayIdx(i); setSlot(null); }} className={`${chip(dayIdx === i)} disabled:cursor-not-allowed disabled:opacity-40`}>
                        {fmtDay(d)}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <p className="text-sm font-medium text-foreground">Time</p>
                  <p className="text-xs text-muted-foreground">Shown in your time zone: {tz}</p>
                </div>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {daySlots.map(({ t, off }) => (
                    <button key={t.toISOString()} type="button" disabled={off} onClick={() => setSlot(t)} className={`${chip(slot?.getTime() === t.getTime())} font-mono disabled:cursor-not-allowed disabled:line-through disabled:opacity-40`}>
                      {fmtTime(t)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === "details" && slot && (
            <div className="space-y-5">
              <div className="flex items-center gap-3 rounded-lg border border-border bg-elevated/50 px-4 py-3 text-sm">
                <CalendarDays className="h-4 w-4 text-brand-500" />
                <span className="text-foreground">{fmtWhen(slot)}</span>
                <button type="button" onClick={() => setStep("time")} className="ml-auto text-brand-600 hover:underline dark:text-brand-300">Change</button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Name" value={user.full_name || user.name || ""} />
                <Field label="Work email" value={user.email || ""} />
                <Field label="Company" value={user.org_name || ""} />
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Phone (optional)</span>
                  <input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" placeholder="+91 98765 43210" className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-brand-500" />
                </label>
              </div>
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">How many devices?</p>
                <div className="flex flex-wrap gap-2">
                  {DEVICE_RANGES.map(r => <button key={r} type="button" onClick={() => setDevices(r)} className={chip(devices === r)}>{r}</button>)}
                </div>
              </div>
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">What should we cover?</p>
                <div className="flex flex-wrap gap-2">
                  {TOPICS.map(t => {
                    const on = topics.includes(t);
                    return (
                      <button key={t} type="button" onClick={() => setTopics(prev => (prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]))} className={`${chip(on)} inline-flex items-center gap-1.5`}>
                        {on && <Check className="h-3.5 w-3.5 text-brand-500" />}{t}
                      </button>
                    );
                  })}
                </div>
              </div>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Anything else? (optional)</span>
                <textarea value={message} onChange={e => setMessage(e.target.value)} rows={3} maxLength={2000} placeholder="For example: we use Google Workspace and most of the team is on Windows laptops." className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-brand-500" />
              </label>
            </div>
          )}

          {step === "done" && slot && (
            <div className="py-2 text-center">
              <div className="mx-auto grid size-12 place-items-center rounded-full bg-brand-tint text-brand-500"><CalendarCheck className="h-6 w-6" /></div>
              <p className="mt-4 text-base font-medium text-foreground">{fmtWhen(slot)}</p>
              <p className="mx-auto mt-1 max-w-[42ch] text-sm text-muted-foreground">
                We&apos;ve emailed a calendar invite to {user.email}; Gmail and Outlook add it to your calendar. The meeting link follows before the call.
              </p>
              <div className="mt-5 flex justify-center">
                <CalendarButtons start={slot} booking={data?.booking && new Date(data.booking.preferred_at).getTime() === slot.getTime() ? data.booking : null} ghost={ghost} />
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-4">
          {step === "details" ? (
            <button type="button" onClick={() => setStep("time")} className={ghost}><ArrowLeft className="h-4 w-4" />Back</button>
          ) : <span />}
          {step === "time" && (
            <button type="button" disabled={!slot} onClick={() => setStep("details")} className={primary}>
              Continue <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </button>
          )}
          {step === "details" && (
            <button type="button" disabled={busy} onClick={book} className={primary}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}Confirm booking
            </button>
          )}
          {(step === "done" || step === "booked") && (
            <button type="button" onClick={() => setOpen(false)} className={primary}>Done</button>
          )}
        </div>
      </div>
    </div>
  );
}

function CalendarButtons({ start, booking, ghost }: { start: Date; booking: Booking; ghost: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => openGoogleCalendar(start, booking?.meeting_url)} className={ghost}>
        <CalendarPlus className="h-4 w-4" />Add to Google Calendar
      </button>
      <button type="button" onClick={() => downloadIcs(start, booking)} className="h-10 px-2 text-sm text-muted-foreground hover:text-foreground hover:underline">
        Outlook / Apple (.ics)
      </button>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex h-10 items-center truncate rounded-md border border-border bg-elevated/50 px-3 text-sm text-foreground">{value || "—"}</div>
    </div>
  );
}

/** Header shortcut, shown to companies on a self-serve trial. */
/**
 * "Book a demo" for self-serve companies. Lives in the profile menu
 * (variant "menu"); `onPick` lets the menu close itself first.
 */
export function BookDemoButton({ variant = "button", onPick }: { variant?: "button" | "menu"; onPick?: () => void }) {
  const { data } = useQuery({
    queryKey: ["onboarding"],
    queryFn: async () => (await onboardingApi.get()).data as { self_serve: boolean; demo_booked?: boolean },
    staleTime: 60_000,
  });
  if (!data?.self_serve) return null;
  const open = () => { onPick?.(); openBookDemo(); };
  if (variant === "menu") {
    return (
      <button type="button" onClick={open} className="flex w-full items-center gap-2 px-4 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
        <CalendarDays className="h-4 w-4" />
        {data.demo_booked ? "Your demo" : "Book a demo"}
      </button>
    );
  }
  return (
    <button type="button" onClick={open} className="hidden h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm text-foreground transition-colors hover:bg-elevated md:inline-flex">
      <CalendarDays className="h-4 w-4 text-brand-500" />
      Book a demo
    </button>
  );
}
