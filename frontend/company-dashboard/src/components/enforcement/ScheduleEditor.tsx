"use client";

import { useEffect, useMemo, useState } from "react";
import { Clock, Loader2, Plus, Trash2, Info } from "lucide-react";
import { cn } from "@/lib/utils";

export type Window = { day: number; start: string; end: string };

export type ScheduleValue = {
  timezone: string;
  windows: Window[];
  holidays: string[];
  off_hours_mode: "full_pause" | "security_only";
  enabled: boolean;
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** A sensible starting point, not a default that gets silently saved. */
export function defaultSchedule(timezone: string): ScheduleValue {
  return {
    timezone: timezone || "UTC",
    windows: [1, 2, 3, 4, 5].map(day => ({ day, start: "10:00", end: "19:00" })),
    holidays: [],
    off_hours_mode: "full_pause",
    enabled: true,
  };
}

/**
 * Editing surface for working hours. Deliberately shows the consequence of the
 * schedule ("agent is paused right now") rather than only its definition — a
 * grid of times is easy to misread, and the cost of misreading it is either an
 * unmonitored workday or a monitored evening.
 */
export function ScheduleEditor({
  value,
  onChange,
  timezones,
  disabled,
}: {
  value: ScheduleValue;
  onChange: (next: ScheduleValue) => void;
  timezones?: string[];
  disabled?: boolean;
}) {
  const set = (patch: Partial<ScheduleValue>) => onChange({ ...value, ...patch });

  const byDay = useMemo(() => {
    const map = new Map<number, Window[]>();
    for (const w of value.windows) {
      map.set(w.day, [...(map.get(w.day) ?? []), w]);
    }
    return map;
  }, [value.windows]);

  const toggleDay = (day: number) => {
    if (byDay.has(day)) {
      set({ windows: value.windows.filter(w => w.day !== day) });
    } else {
      const template = value.windows[0] ?? { start: "10:00", end: "19:00" };
      set({ windows: [...value.windows, { day, start: template.start, end: template.end }] });
    }
  };

  const updateWindow = (target: Window, patch: Partial<Window>) => {
    set({ windows: value.windows.map(w => (w === target ? { ...w, ...patch } : w)) });
  };

  const addWindow = (day: number) => {
    set({ windows: [...value.windows, { day, start: "09:00", end: "13:00" }] });
  };

  const removeWindow = (target: Window) => {
    set({ windows: value.windows.filter(w => w !== target) });
  };

  const applyToAllDays = () => {
    const source = byDay.get(1) ?? value.windows.slice(0, 1);
    if (source.length === 0) return;
    const next: Window[] = [];
    for (const day of [1, 2, 3, 4, 5]) {
      for (const w of source) next.push({ ...w, day });
    }
    set({ windows: next });
  };

  const inputClass =
    "rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 disabled:opacity-60";

  return (
    <div className={cn("space-y-5", disabled && "opacity-60 pointer-events-none")}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1">Timezone</label>
          <select
            value={value.timezone}
            onChange={e => set({ timezone: e.target.value })}
            className={`${inputClass} w-full`}
          >
            {(timezones && timezones.length > 0 ? timezones : [value.timezone]).map(tz => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
          <p className="text-xs text-subtle mt-1.5">
            Working hours are read in this timezone, not the laptop's — a device set to another
            zone can't shift its own window.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1">Outside working hours</label>
          <select
            value={value.off_hours_mode}
            onChange={e => set({ off_hours_mode: e.target.value as ScheduleValue["off_hours_mode"] })}
            className={`${inputClass} w-full`}
          >
            <option value="full_pause">Pause everything (recommended for personal devices)</option>
            <option value="security_only">Malware protection only — no monitoring</option>
          </select>
          <p className="text-xs text-subtle mt-1.5">
            {value.off_hours_mode === "full_pause"
              ? "The agent removes itself from the network path entirely. No blocking, no logging, no inspection."
              : "Downloads are still scanned and known-malicious sites still blocked, but browsing is neither filtered nor recorded."}
          </p>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-muted-foreground">Working days</label>
          <button
            type="button"
            onClick={applyToAllDays}
            className="text-xs text-brand-500 hover:text-brand-400"
          >
            Copy Monday to weekdays
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5 mb-4">
          {DAYS.map((label, day) => (
            <button
              key={day}
              type="button"
              onClick={() => toggleDay(day)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm border transition-colors",
                byDay.has(day)
                  ? "bg-brand-500 text-on-brand border-brand-500"
                  : "bg-background text-muted-foreground border-border hover:border-border-strong"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          {[0, 1, 2, 3, 4, 5, 6].filter(d => byDay.has(d)).map(day => (
            <div key={day} className="rounded-lg border border-border bg-background/50 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-body">{DAYS[day]}</span>
                <button
                  type="button"
                  onClick={() => addWindow(day)}
                  className="inline-flex items-center gap-1 text-xs text-brand-500 hover:text-brand-400"
                >
                  <Plus className="w-3 h-3" /> Add a second window
                </button>
              </div>
              <div className="space-y-2">
                {(byDay.get(day) ?? []).map((w, i) => {
                  const overnight = w.end <= w.start;
                  return (
                    <div key={i} className="flex flex-wrap items-center gap-2">
                      <input
                        type="time"
                        value={w.start}
                        onChange={e => updateWindow(w, { start: e.target.value })}
                        className={inputClass}
                      />
                      <span className="text-subtle text-sm">to</span>
                      <input
                        type="time"
                        value={w.end}
                        onChange={e => updateWindow(w, { end: e.target.value })}
                        className={inputClass}
                      />
                      {overnight && (
                        <span className="text-xs text-warning">runs past midnight into the next day</span>
                      )}
                      {(byDay.get(day) ?? []).length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeWindow(w)}
                          className="text-subtle hover:text-danger"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {value.windows.length === 0 && (
            <p className="text-sm text-subtle">
              No working days selected — pick at least one, or the schedule can't be saved.
            </p>
          )}
        </div>
      </div>

      <HolidayEditor
        holidays={value.holidays}
        onChange={holidays => set({ holidays })}
      />
    </div>
  );
}

function HolidayEditor({
  holidays,
  onChange,
}: {
  holidays: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const v = draft.trim();
    if (!v || holidays.includes(v)) return;
    onChange([...holidays, v].sort());
    setDraft("");
  };

  return (
    <div>
      <label className="block text-sm font-medium text-muted-foreground mb-1">Holidays</label>
      <p className="text-xs text-subtle mb-2">
        The agent stands down all day on these dates, as if they were a weekend.
      </p>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <input
          type="date"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-brand-500"
        />
        <button
          type="button"
          onClick={add}
          disabled={!draft}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-sm text-body hover:bg-elevated disabled:opacity-50"
        >
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {holidays.map(h => (
          <span key={h} className="inline-flex items-center gap-1.5 rounded-md bg-elevated px-2 py-1 text-xs text-body">
            {h}
            <button type="button" onClick={() => onChange(holidays.filter(x => x !== h))}
              className="text-subtle hover:text-danger">×</button>
          </span>
        ))}
        {holidays.length === 0 && <span className="text-xs text-subtle">None</span>}
      </div>
    </div>
  );
}

/** Live state badge — what the schedule means right now. */
export function EnforcementBadge({ state, className }: { state: any; className?: string }) {
  if (!state) return null;
  const mode = state.mode ?? (state.active ? "full" : "paused");
  const styles: Record<string, string> = {
    full: "bg-green-500/10 text-success",
    security_only: "bg-yellow-500/10 text-warning",
    paused: "bg-elevated text-muted-foreground",
  };
  const labels: Record<string, string> = {
    full: "Monitoring",
    security_only: "Protection only",
    paused: "Paused",
  };
  return (
    <span
      title={state.reason || ""}
      className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
        styles[mode] ?? styles.full, className)}
    >
      <Clock className="w-3 h-3" />
      {labels[mode] ?? "Monitoring"}
    </span>
  );
}

/** The sentence under the badge: when this state ends. */
export function EnforcementReason({ state }: { state: any }) {
  if (!state?.reason) return null;
  return <p className="text-xs text-subtle mt-1">{state.reason}</p>;
}

export function useTimezones(fetcher: () => Promise<any>) {
  const [zones, setZones] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetcher()
      .then(res => {
        if (cancelled) return;
        const list = res?.data?.timezones ?? res?.data ?? [];
        setZones(Array.isArray(list) ? list : []);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [fetcher]);
  return zones;
}

export { DAYS, Info as ScheduleInfoIcon, Loader2 as ScheduleSpinner };
