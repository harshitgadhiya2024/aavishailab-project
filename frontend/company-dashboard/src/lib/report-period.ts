/**
 * Report periods. Dates are whole calendar days in the viewer's time zone and
 * are sent to the API as YYYY-MM-DD plus `tz`, so "This month" means the same
 * thing on screen, in the export and in the file name.
 */

export type PeriodId =
  | "today" | "yesterday" | "7d" | "30d" | "this_month" | "last_month" | "3m" | "12m" | "custom";

export type Period = { id: PeriodId; start: string; end: string };

export const PERIOD_LABELS: Record<PeriodId, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  this_month: "This month",
  last_month: "Last month",
  "3m": "Last 3 months",
  "12m": "Last 12 months",
  custom: "Custom range",
};

export const MAX_RANGE_DAYS = 366;

export function viewerTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function periodFor(id: PeriodId, custom?: { start: string; end: string }): Period {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  switch (id) {
    case "today":
      return { id, start: ymd(today), end: ymd(today) };
    case "yesterday": {
      const y = addDays(today, -1);
      return { id, start: ymd(y), end: ymd(y) };
    }
    case "7d":
      return { id, start: ymd(addDays(today, -6)), end: ymd(today) };
    case "30d":
      return { id, start: ymd(addDays(today, -29)), end: ymd(today) };
    case "this_month":
      return { id, start: ymd(new Date(today.getFullYear(), today.getMonth(), 1)), end: ymd(today) };
    case "last_month":
      return {
        id,
        start: ymd(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
        end: ymd(new Date(today.getFullYear(), today.getMonth(), 0)),
      };
    case "3m":
      return { id, start: ymd(addDays(new Date(today.getFullYear(), today.getMonth() - 3, today.getDate()), 1)), end: ymd(today) };
    case "12m":
      return { id, start: ymd(addDays(new Date(today.getFullYear() - 1, today.getMonth(), today.getDate()), 1)), end: ymd(today) };
    case "custom":
      return { id, start: custom?.start ?? ymd(addDays(today, -6)), end: custom?.end ?? ymd(today) };
  }
}

/** Query params for the reports API. */
export function periodParams(p: Period) {
  return { start: p.start, end: p.end, tz: viewerTimeZone() };
}

const fmt = (s: string, withYear: boolean) =>
  parseYmd(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) });

/** "1 Sep – 30 Sep 2026", or a single day when start = end. */
export function periodText(p: Period): string {
  if (p.start === p.end) return fmt(p.start, true);
  const sameYear = p.start.slice(0, 4) === p.end.slice(0, 4);
  return `${fmt(p.start, !sameYear)} to ${fmt(p.end, true)}`;
}

/** Why a custom range is invalid, or null when it's fine. */
export function validateRange(start: string, end: string): string | null {
  if (!start || !end) return "Pick both dates";
  const s = parseYmd(start), e = parseYmd(end);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (s > e) return "Start date is after the end date";
  if (e > today) return "End date is in the future";
  if ((e.getTime() - s.getTime()) / 86400000 + 1 > MAX_RANGE_DAYS) return "Pick a range of one year or less";
  return null;
}
