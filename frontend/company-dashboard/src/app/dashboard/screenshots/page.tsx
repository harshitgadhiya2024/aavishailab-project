"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { monitoringApi } from "@/lib/api";
import {
  Camera, RefreshCw, Loader2, Trash2, X, ChevronDown, Clock,
  Keyboard, MousePointer2, MoveVertical, CalendarDays, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// The activity legend, matching the reference view's colour language but on
// our tokens. Only active/idle are produced by the agent today; the rest are
// reserved for when the employee portal can set manual/break/meeting.
const STATE_COLORS: Record<string, string> = {
  active: "#16a34a",
  meeting: "#7c3aed",
  idle: "#ef4444",
  deducted: "#991b1b",
  "on-break": "#9ca3af",
  manual: "#f59e0b",
};
const LEGEND = [
  ["active", "Active"], ["meeting", "Meeting"], ["idle", "Idle"],
  ["deducted", "Deducted"], ["on-break", "On-break"], ["manual", "Manual"],
] as const;

// Common IANA zones for the picker, plus whatever the browser is in.
const TIMEZONES = [
  "Asia/Kolkata", "UTC", "America/New_York", "America/Los_Angeles",
  "Europe/London", "Europe/Berlin", "Asia/Dubai", "Asia/Singapore", "Australia/Sydney",
];

function hhmm(iso: string, tz: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz });
}
function secondsToHm(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function ScreenshotsPage() {
  const qc = useQueryClient();
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const [employeeId, setEmployeeId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dayReset, setDayReset] = useState(4);
  const [tz, setTz] = useState(browserTz && TIMEZONES.includes(browserTz) ? browserTz : "Asia/Kolkata");
  const [zoom, setZoom] = useState<any | null>(null);

  const { data: empData } = useQuery({
    queryKey: ["monitoring-employees"],
    queryFn: () => monitoringApi.employees(),
  });
  const employees: any[] = empData?.data?.employees ?? [];

  // Default to the first employee once the list loads.
  useEffect(() => {
    if (!employeeId && employees.length > 0) setEmployeeId(employees[0].id);
  }, [employees, employeeId]);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["screenshots", employeeId, date, dayReset, tz],
    queryFn: () => monitoringApi.screenshots({ employee_id: employeeId, date, tz, day_reset: dayReset }),
    enabled: !!employeeId,
  });

  const perms = data?.data?.permissions ?? {};
  const sessions: any[] = data?.data?.sessions ?? [];
  const timeline: any[] = data?.data?.timeline ?? [];
  const totals = data?.data?.totals ?? {};
  const window = data?.data?.window;

  const invalidate = () => qc.invalidateQueries({ queryKey: ["screenshots"] });

  const deleteSession = useMutation({
    mutationFn: (id: string) => monitoringApi.deleteSession(id),
    onSuccess: () => { invalidate(); toast.success("Session deleted"); },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Could not delete the session"),
  });
  const deleteShot = useMutation({
    mutationFn: (id: string) => monitoringApi.deleteScreenshot(id),
    onSuccess: () => { invalidate(); setZoom(null); toast.success("Screenshot deleted"); },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Could not delete the screenshot"),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Screenshots</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Screenshots, activity timeline and work sessions for an employee on a chosen day.
        </p>
      </div>

      {/* Filter bar */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Employee">
            <div className="relative">
              <select
                value={employeeId}
                onChange={e => setEmployeeId(e.target.value)}
                className="appearance-none w-56 rounded-lg border border-border bg-background pl-3 pr-8 py-2 text-sm outline-none focus:border-brand-500"
              >
                {employees.length === 0 && <option value="">No monitored employees yet</option>}
                {employees.map(e => (
                  <option key={e.id} value={e.id}>
                    {`${e.first_name ?? ""} ${e.last_name ?? ""}`.trim() || e.email}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-muted-foreground absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </Field>
          <Field label="Date">
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
          </Field>
          <Field label="Day reset">
            <div className="relative">
              <select
                value={dayReset}
                onChange={e => setDayReset(Number(e.target.value))}
                className="appearance-none w-24 rounded-lg border border-border bg-background pl-3 pr-8 py-2 text-sm outline-none focus:border-brand-500"
              >
                {Array.from({ length: 24 }).map((_, h) => (
                  <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-muted-foreground absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </Field>
          <Field label="Timezone">
            <div className="relative">
              <select
                value={tz}
                onChange={e => setTz(e.target.value)}
                className="appearance-none w-44 rounded-lg border border-border bg-background pl-3 pr-8 py-2 text-sm outline-none focus:border-brand-500"
              >
                {[...new Set([tz, ...TIMEZONES])].map(z => <option key={z} value={z}>{z}</option>)}
              </select>
              <ChevronDown className="w-4 h-4 text-muted-foreground absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </Field>
          <button
            onClick={() => refetch()}
            disabled={!employeeId || isFetching}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-brand-600 disabled:opacity-60"
          >
            <RefreshCw className={cn("w-4 h-4", isFetching && "animate-spin")} />
            Latest screens
          </button>
        </div>
      </div>

      {/* Window + permissions banners */}
      {window && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="inline-flex items-center gap-2 rounded-lg bg-brand-500/10 text-brand-500 px-3 py-1.5 font-medium">
            <CalendarDays className="w-4 h-4" />
            {new Date(window.from).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: tz })}
            {"  to  "}
            {new Date(window.to).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: tz })}
          </span>
          <span className="rounded-lg bg-elevated px-3 py-1.5 text-muted-foreground">
            Your permissions:{" "}
            <b className={perms.delete_session ? "text-success" : "text-danger"}>
              Delete session {perms.delete_session ? "allowed" : "denied"}
            </b>
            {"  ·  "}
            <b className={perms.delete_screenshot ? "text-success" : "text-danger"}>
              Delete screenshot {perms.delete_screenshot ? "allowed" : "denied"}
            </b>
          </span>
        </div>
      )}

      {/* Day totals */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Stat label="Screenshots" value={totals.screenshots ?? 0} />
        <Stat label="Tracked" value={secondsToHm(totals.tracked_seconds ?? 0)} />
        <Stat label="Active" value={secondsToHm(totals.active_seconds ?? 0)} />
        <Stat label="Avg activity" value={`${totals.avg_activity ?? 0}%`} />
      </div>

      {/* Activity timeline */}
      <ActivityTimeline window={window} timeline={timeline} tz={tz} />

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : sessions.length === 0 ? (
        <div className="rounded-xl border border-border bg-card py-16 text-center">
          <Camera className="w-8 h-8 mx-auto mb-3 text-subtle" />
          <p className="text-sm text-muted-foreground">
            No screenshots for this day. They appear here once the agent captures during working hours.
          </p>
        </div>
      ) : (
        sessions.map(session => (
          <SessionCard
            key={session.id}
            session={session}
            tz={tz}
            canDeleteSession={!!perms.delete_session}
            onDeleteSession={() => {
              if (confirm("Delete this session and all its screenshots?")) deleteSession.mutate(session.id);
            }}
            onZoom={setZoom}
          />
        ))
      )}

      {zoom && (
        <ZoomModal
          shot={zoom}
          tz={tz}
          canDelete={!!perms.delete_screenshot}
          onDelete={() => deleteShot.mutate(zoom.id)}
          onClose={() => setZoom(null)}
        />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-xl font-semibold text-foreground">{value}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}

// ─── Activity timeline ────────────────────────────────────────────────────────

function ActivityTimeline({ window, timeline, tz }: { window: any; timeline: any[]; tz: string }) {
  const [mode, setMode] = useState<"timeline" | "table">("timeline");

  const range = useMemo(() => {
    if (!window) return null;
    const from = new Date(window.from).getTime();
    const to = new Date(window.to).getTime();
    return { from, to, span: to - from };
  }, [window]);

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground">Activity</h2>
        <div className="flex items-center gap-4">
          <div className="hidden md:flex items-center gap-3">
            {LEGEND.map(([key, label]) => (
              <span key={key} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: STATE_COLORS[key] }} />
                {label}
              </span>
            ))}
          </div>
          <div className="flex rounded-lg border border-border overflow-hidden text-xs">
            {(["timeline", "table"] as const).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn("px-3 py-1.5 capitalize", mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-elevated")}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>

      {mode === "timeline" ? (
        <div className="p-4">
          {/* hour ticks */}
          <div className="relative h-5 text-[10px] text-subtle">
            {range && Array.from({ length: 25 }).map((_, i) => {
              const t = range.from + (range.span * i) / 24;
              const left = (i / 24) * 100;
              if (i % 2 !== 0) return null;
              return (
                <span key={i} className="absolute -translate-x-1/2" style={{ left: `${left}%` }}>
                  {new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz })}
                </span>
              );
            })}
          </div>
          {/* bar */}
          <div className="relative h-8 rounded-md bg-elevated overflow-hidden mt-1">
            {range && timeline.map((seg, i) => {
              const start = new Date(seg.start).getTime();
              const end = new Date(seg.end).getTime();
              const left = ((start - range.from) / range.span) * 100;
              const width = ((end - start) / range.span) * 100;
              return (
                <div
                  key={i}
                  title={`${hhmm(seg.start, tz)}–${hhmm(seg.end, tz)} · ${seg.state}`}
                  className="absolute top-0 h-full"
                  style={{ left: `${left}%`, width: `${Math.max(width, 0.2)}%`, background: STATE_COLORS[seg.state] ?? STATE_COLORS.active }}
                />
              );
            })}
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-subtle border-b border-border">
                <th className="px-4 py-2 font-medium">From</th>
                <th className="px-4 py-2 font-medium">To</th>
                <th className="px-4 py-2 font-medium">State</th>
                <th className="px-4 py-2 font-medium">Duration</th>
              </tr>
            </thead>
            <tbody>
              {timeline.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">No activity.</td></tr>
              )}
              {timeline.map((seg, i) => (
                <tr key={i} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-2 font-mono">{hhmm(seg.start, tz)}</td>
                  <td className="px-4 py-2 font-mono">{hhmm(seg.end, tz)}</td>
                  <td className="px-4 py-2">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm" style={{ background: STATE_COLORS[seg.state] }} />
                      {seg.state}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {secondsToHm(Math.round((new Date(seg.end).getTime() - new Date(seg.start).getTime()) / 1000))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Session card ─────────────────────────────────────────────────────────────

function SessionCard({
  session, tz, canDeleteSession, onDeleteSession, onZoom,
}: {
  session: any; tz: string; canDeleteSession: boolean;
  onDeleteSession: () => void; onZoom: (shot: any) => void;
}) {
  const start = session.started_at ? hhmm(session.started_at, tz) : "—";
  const end = session.ended_at ? hhmm(session.ended_at, tz) : "live";
  const dateLabel = session.started_at
    ? new Date(session.started_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: tz })
    : "";

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4 border-b border-border">
        <div className="space-y-1 text-sm">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
            <span><span className="text-subtle">Date:</span> <b className="text-body">{dateLabel}</b></span>
            <span><span className="text-subtle">Time:</span> <b className="text-body">{start} → {end}</b></span>
            <span className="inline-flex items-center gap-1.5 text-brand-500">
              <Clock className="w-3.5 h-3.5" /> {Math.round(session.avg_activity ?? 0)}% avg activity
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-muted-foreground">
            <span><span className="text-subtle">Project:</span> {session.project}</span>
            <span><span className="text-subtle">Task:</span> {session.task}</span>
            {session.ip && <span><span className="text-subtle">IP:</span> {session.ip}</span>}
            {session.hostname && <span><span className="text-subtle">Host:</span> {session.hostname}</span>}
          </div>
        </div>
        {canDeleteSession && (
          <button onClick={onDeleteSession} className="inline-flex items-center gap-1.5 text-sm text-danger hover:text-red-400">
            <Trash2 className="w-4 h-4" /> Delete session
          </button>
        )}
      </div>

      <div className="p-5">
        {session.screenshots.length === 0 ? (
          <p className="text-sm text-subtle">No screenshots in this session.</p>
        ) : (
          <>
            <p className="text-xs text-subtle mb-3">Click a screenshot to zoom in.</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-4">
              {session.screenshots.map((shot: any) => (
                <Thumbnail key={shot.id} shot={shot} tz={tz} onClick={() => onZoom(shot)} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Thumbnail({ shot, tz, onClick }: { shot: any; tz: string; onClick: () => void }) {
  const pct = shot.activity_percent ?? 0;
  const barColor = pct >= 50 ? "bg-green-500" : pct >= 20 ? "bg-yellow-500" : "bg-red-500";
  return (
    <button onClick={onClick} className="group text-left">
      <div className="aspect-video rounded-lg overflow-hidden border border-border bg-elevated">
        {/* Signed URL loads directly; no auth header needed. */}
        <img
          src={shot.image_url}
          alt={`Screen at ${hhmm(shot.captured_at, tz)}`}
          loading="lazy"
          className="w-full h-full object-cover group-hover:opacity-90 transition-opacity"
        />
      </div>
      <div className="mt-1.5 text-xs text-body font-medium">
        {hhmm(shot.interval_start, tz)} – {hhmm(shot.interval_end, tz)}
      </div>
      <div className="mt-1 flex items-center gap-2">
        <div className="h-1.5 flex-1 rounded-full bg-elevated overflow-hidden">
          <div className={cn("h-full rounded-full", barColor)} style={{ width: `${pct}%` }} />
        </div>
        <span className="text-[11px] text-muted-foreground tabular-nums w-8 text-right">{pct}%</span>
      </div>
    </button>
  );
}

// ─── Zoom modal ───────────────────────────────────────────────────────────────

function ZoomModal({
  shot, tz, canDelete, onDelete, onClose,
}: {
  shot: any; tz: string; canDelete: boolean; onDelete: () => void; onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-5xl rounded-2xl border border-border bg-card overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="text-sm">
            <b className="text-body">{hhmm(shot.interval_start, tz)} – {hhmm(shot.interval_end, tz)}</b>
            <span className="text-subtle ml-2">
              {new Date(shot.captured_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: tz })}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {canDelete && (
              <button
                onClick={() => { if (confirm("Delete this screenshot?")) onDelete(); }}
                className="inline-flex items-center gap-1.5 text-sm text-danger hover:text-red-400"
              >
                <Trash2 className="w-4 h-4" /> Delete
              </button>
            )}
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
          </div>
        </div>
        <div className="bg-black/40 max-h-[70vh] overflow-auto flex items-center justify-center">
          <img src={shot.image_url} alt="Screenshot" className="max-w-full" />
        </div>
        <div className="flex flex-wrap items-center gap-6 px-5 py-3 border-t border-border text-sm">
          <span className="inline-flex items-center gap-2">
            <Clock className="w-4 h-4 text-brand-500" /> Activity <b className="text-body">{shot.activity_percent}%</b>
          </span>
          <span className="inline-flex items-center gap-2 text-muted-foreground">
            <Keyboard className="w-4 h-4" /> {shot.keyboard_count} keys
          </span>
          <span className="inline-flex items-center gap-2 text-muted-foreground">
            <MousePointer2 className="w-4 h-4" /> {shot.mouse_count} clicks/moves
          </span>
          <span className="inline-flex items-center gap-2 text-muted-foreground">
            <MoveVertical className="w-4 h-4" /> {shot.scroll_count} scrolls
          </span>
        </div>
      </div>
    </div>
  );
}
