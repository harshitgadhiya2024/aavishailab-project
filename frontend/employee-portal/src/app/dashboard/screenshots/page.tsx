"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, AppWindow, Camera, CameraOff, ChevronLeft, ChevronRight, Clock, EyeOff,
  Keyboard, Loader2, MessageSquareText, MousePointer2, MoveVertical, Pencil, RefreshCw, ShieldCheck, X,
} from "lucide-react";
import { toast } from "sonner";
import { portalApi } from "@/lib/api";
import { cn } from "@/lib/utils";

// The employee's own screenshots, the same day view their company sees, so
// monitoring is transparent. The only thing they can do to a screenshot is
// explain it: there is no delete here, and no delete route on the portal API.

const MIN_REASON = 3;
const MAX_REASON = 500;

const STATE_COLORS: Record<string, string> = {
  active: "#16a34a",
  meeting: "#7c3aed",
  idle: "#ef4444",
  deducted: "#991b1b",
  "on-break": "#9ca3af",
  manual: "#f59e0b",
};

// YYYY-MM-DD for "today" in the given zone — not toISOString(), which is UTC
// and would show yesterday to anyone east of Greenwich before 05:30.
function todayIn(tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function shiftDay(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function hhmm(iso: string, tz: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz });
}
function secondsToHm(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function longDate(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
}

export default function MyScreenshotsPage() {
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  const today = useMemo(() => todayIn(tz), [tz]);
  const [date, setDate] = useState(today);
  const [zoomId, setZoomId] = useState<string | null>(null);

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["portal-screenshots", date, tz],
    queryFn: () => portalApi.screenshots({ date, tz, day_reset: 0 }).then((r) => r.data),
    staleTime: 30_000,
  });

  const sessions: any[] = data?.sessions ?? [];
  const orphans: any[] = data?.orphans ?? [];
  const timeline: any[] = data?.timeline ?? [];
  const totals = data?.totals ?? {};
  const monitoring = data?.monitoring;
  const canAddReason = data?.permissions?.add_reason === true;

  // Every screenshot of the day in order, so the viewer can step through them.
  const allShots = useMemo(
    () => [...sessions.flatMap((s) => s.screenshots ?? []), ...orphans]
      .sort((a, b) => new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime()),
    [sessions, orphans],
  );
  const zoomIndex = zoomId ? allShots.findIndex((s) => s.id === zoomId) : -1;
  const zoom = zoomIndex >= 0 ? allShots[zoomIndex] : null;

  const isToday = date >= today;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="page-eyebrow">My protection</p>
          <h1 className="mt-2 text-[2rem] font-normal leading-[1.1] tracking-[-0.035em] text-foreground">My Screenshots</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The screenshots your company sees for your work day. You can add a reason to any of them.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setDate(shiftDay(date, -1))}
            aria-label="Previous day"
            className="rounded-lg border border-border bg-card p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <input
            type="date"
            value={date}
            max={today}
            onChange={(e) => e.target.value && setDate(e.target.value > today ? today : e.target.value)}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-brand-500"
          />
          <button
            onClick={() => setDate(shiftDay(date, 1))}
            disabled={isToday}
            aria-label="Next day"
            className="rounded-lg border border-border bg-card p-2 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          {!isToday && (
            <button onClick={() => setDate(today)} className="rounded-lg px-3 py-2 text-sm font-medium text-brand-500 hover:bg-brand-500/10">
              Today
            </button>
          )}
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            aria-label="Refresh"
            className="rounded-lg border border-border bg-card p-2 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60"
          >
            <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
          </button>
        </div>
      </div>

      <p className="text-sm font-medium text-body">{longDate(date)}</p>

      {error ? (
        <LoadError error={error} />
      ) : isLoading ? (
        <div className="space-y-4" aria-busy="true">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-card" />)}</div>
          <div className="h-48 animate-pulse rounded-xl bg-card" />
        </div>
      ) : (
        <>
          {monitoring && <MonitoringNotice monitoring={monitoring} />}

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Screenshots" value={totals.screenshots ?? 0} />
            <Stat label="Tracked" value={secondsToHm(totals.tracked_seconds ?? 0)} />
            <Stat label="Active" value={secondsToHm(totals.active_seconds ?? 0)} />
            <Stat label="Avg activity" value={`${totals.avg_activity ?? 0}%`} />
          </div>

          <Timeline window={data?.window} timeline={timeline} tz={tz} />

          {allShots.length === 0 ? (
            <div className="rounded-xl border border-border bg-card py-16 text-center">
              <Camera className="mx-auto mb-3 h-8 w-8 text-subtle" />
              <p className="text-sm text-muted-foreground">No screenshots for this day.</p>
            </div>
          ) : (
            <>
              {sessions.filter((s) => (s.screenshots ?? []).length > 0).map((session) => (
                <SessionCard key={session.id} session={session} tz={tz} onOpen={setZoomId} />
              ))}
              {orphans.length > 0 && (
                <SessionCard session={{ id: "other", screenshots: orphans }} tz={tz} onOpen={setZoomId} />
              )}
            </>
          )}
        </>
      )}

      {zoom && (
        <Viewer
          shot={zoom}
          tz={tz}
          canAddReason={canAddReason}
          position={`${zoomIndex + 1} of ${allShots.length}`}
          onPrev={zoomIndex > 0 ? () => setZoomId(allShots[zoomIndex - 1].id) : undefined}
          onNext={zoomIndex < allShots.length - 1 ? () => setZoomId(allShots[zoomIndex + 1].id) : undefined}
          onClose={() => setZoomId(null)}
        />
      )}
    </div>
  );
}

function MonitoringNotice({ monitoring }: { monitoring: any }) {
  if (!monitoring.enabled) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
        <CameraOff className="mt-0.5 h-5 w-5 flex-shrink-0 text-muted-foreground" />
        <p className="text-sm text-body">
          Screenshot monitoring is currently off for your company. Earlier screenshots, if any, are still shown here
          until they expire.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
      <span className="inline-flex items-center gap-2 text-body">
        <ShieldCheck className="h-4 w-4 text-success" /> Screenshot monitoring is on
      </span>
      {monitoring.blurred && (
        <span className="inline-flex items-center gap-1.5"><EyeOff className="h-4 w-4" /> Blurred</span>
      )}
      {monitoring.retention_days > 0 && <span>Kept for {monitoring.retention_days} days</span>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="[font-family:Satoshi,var(--font-inter),sans-serif] text-[1.5rem] font-medium leading-tight tracking-[-0.02em] tabular-nums text-foreground">{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function Timeline({ window: win, timeline, tz }: { window: any; timeline: any[]; tz: string }) {
  if (!win) return null;
  const from = new Date(win.from).getTime();
  const span = new Date(win.to).getTime() - from;
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold text-foreground">Activity</h2>
      <div className="relative h-5 text-[10px] text-subtle">
        {Array.from({ length: 7 }).map((_, i) => (
          <span key={i} className={cn("absolute whitespace-nowrap", i === 0 ? "" : i === 6 ? "-translate-x-full" : "-translate-x-1/2")} style={{ left: `${(i / 6) * 100}%` }}>
            {new Date(from + (span * i) / 6).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz })}
          </span>
        ))}
      </div>
      <div className="relative mt-1 h-6 overflow-hidden rounded-md bg-elevated">
        {timeline.map((seg, i) => {
          const start = new Date(seg.start).getTime();
          const end = new Date(seg.end).getTime();
          return (
            <div
              key={i}
              title={`${hhmm(seg.start, tz)}–${hhmm(seg.end, tz)} · ${seg.state}`}
              className="absolute top-0 h-full"
              style={{
                left: `${((start - from) / span) * 100}%`,
                width: `${Math.max(((end - start) / span) * 100, 0.2)}%`,
                background: STATE_COLORS[seg.state] ?? STATE_COLORS.active,
              }}
            />
          );
        })}
      </div>
      <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: STATE_COLORS.active }} /> Active</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: STATE_COLORS.idle }} /> Idle</span>
      </div>
    </div>
  );
}

function SessionCard({ session, tz, onOpen }: { session: any; tz: string; onOpen: (id: string) => void }) {
  const shots: any[] = session.screenshots ?? [];
  const noted = shots.filter((s) => s.employee_note).length;
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-border px-5 py-3 text-sm">
        {session.started_at ? (
          <span>
            <span className="text-subtle">Session:</span>{" "}
            <b className="text-body">{hhmm(session.started_at, tz)} → {session.ended_at ? hhmm(session.ended_at, tz) : "now"}</b>
          </span>
        ) : (
          <b className="text-body">Other screenshots</b>
        )}
        {session.avg_activity != null && (
          <span className="inline-flex items-center gap-1.5 text-brand-500">
            <Clock className="h-3.5 w-3.5" /> {Math.round(session.avg_activity)}% avg activity
          </span>
        )}
        {session.hostname && <span className="text-muted-foreground"><span className="text-subtle">Device:</span> {session.hostname}</span>}
        <span className="text-muted-foreground">{shots.length} screenshot{shots.length === 1 ? "" : "s"}{noted > 0 ? ` · ${noted} with a reason` : ""}</span>
      </div>
      <div className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
        {shots.map((shot) => <Thumbnail key={shot.id} shot={shot} tz={tz} onClick={() => onOpen(shot.id)} />)}
      </div>
    </div>
  );
}

function Shot({ shot, className, alt }: { shot: any; className: string; alt: string }) {
  const [broken, setBroken] = useState(false);
  if (!shot.image_url || broken) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-subtle">
        <CameraOff className="h-5 w-5" />
        <span className="text-[11px]">Image unavailable</span>
      </div>
    );
  }
  // Signed, short-lived URL — loads directly with no auth header.
  return <img src={shot.image_url} alt={alt} loading="lazy" onError={() => setBroken(true)} className={className} />;
}

function Thumbnail({ shot, tz, onClick }: { shot: any; tz: string; onClick: () => void }) {
  const pct = shot.activity_percent ?? 0;
  const bar = pct >= 50 ? "bg-green-500" : pct >= 20 ? "bg-yellow-500" : "bg-red-500";
  return (
    <button onClick={onClick} className="group text-left">
      <div className="relative aspect-video overflow-hidden rounded-lg border border-border bg-elevated">
        <Shot shot={shot} alt={`Screen at ${hhmm(shot.captured_at, tz)}`} className="h-full w-full object-cover transition-opacity group-hover:opacity-90" />
        {shot.employee_note && (
          <span title={shot.employee_note} className="absolute right-1.5 top-1.5 rounded-md bg-brand-500 p-1 text-white shadow">
            <MessageSquareText className="h-3 w-3" />
          </span>
        )}
      </div>
      <div className="mt-1.5 text-xs font-medium text-body">
        {hhmm(shot.interval_start, tz)} – {hhmm(shot.interval_end, tz)}
      </div>
      <div className="mt-1 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-elevated">
          <div className={cn("h-full rounded-full", bar)} style={{ width: `${pct}%` }} />
        </div>
        <span className="w-8 text-right text-[11px] tabular-nums text-muted-foreground">{pct}%</span>
      </div>
      {shot.employee_note && <p className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">“{shot.employee_note}”</p>}
    </button>
  );
}

function Viewer({
  shot, tz, canAddReason, position, onPrev, onNext, onClose,
}: {
  shot: any; tz: string; canAddReason: boolean; position: string;
  onPrev?: () => void; onNext?: () => void; onClose: () => void;
}) {
  const [editing, setEditing] = useState(false);

  useEffect(() => setEditing(false), [shot.id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Arrow keys belong to the text box while the employee is typing.
      if ((e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") onPrev?.();
      if (e.key === "ArrowRight") onNext?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onPrev, onNext]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 sm:p-4" onClick={onClose} role="dialog" aria-modal="true">
      <div className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-card" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div className="text-sm">
            <b className="text-body">{hhmm(shot.interval_start, tz)} – {hhmm(shot.interval_end, tz)}</b>
            <span className="ml-2 text-subtle">{position}</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={onPrev} disabled={!onPrev} aria-label="Previous screenshot" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button onClick={onNext} disabled={!onNext} aria-label="Next screenshot" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30">
              <ChevronRight className="h-5 w-5" />
            </button>
            <button onClick={onClose} aria-label="Close" className="ml-2 rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex min-h-[200px] flex-1 items-center justify-center overflow-auto bg-black/40">
          <Shot shot={shot} alt="Screenshot" className="max-h-[60vh] max-w-full" />
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border px-5 py-3 text-sm">
          <span className="inline-flex items-center gap-2">
            <Clock className="h-4 w-4 text-brand-500" /> Activity <b className="text-body">{shot.activity_percent ?? 0}%</b>
          </span>
          <span className="inline-flex items-center gap-2 text-muted-foreground"><Keyboard className="h-4 w-4" /> {shot.keyboard_count ?? 0} keys</span>
          <span className="inline-flex items-center gap-2 text-muted-foreground"><MousePointer2 className="h-4 w-4" /> {shot.mouse_count ?? 0} clicks/moves</span>
          <span className="inline-flex items-center gap-2 text-muted-foreground"><MoveVertical className="h-4 w-4" /> {shot.scroll_count ?? 0} scrolls</span>
        </div>

        {shot.open_apps?.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 border-t border-border px-5 py-3">
            <span className="mr-1 text-xs font-medium text-muted-foreground">Open:</span>
            {shot.open_apps.map((name: string) => (
              <span key={name} className="inline-flex max-w-[140px] items-center gap-1 rounded bg-elevated px-1.5 py-0.5 text-[11px] text-muted-foreground">
                <AppWindow className="h-3 w-3 flex-shrink-0" /><span className="truncate">{name}</span>
              </span>
            ))}
          </div>
        )}

        <div className="border-t border-border px-5 py-4">
          {editing ? (
            <ReasonEditor shot={shot} onDone={() => setEditing(false)} />
          ) : shot.employee_note ? (
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">
                  Your reason{shot.employee_note_at ? ` · ${new Date(shot.employee_note_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: tz })}` : ""}
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-body">{shot.employee_note}</p>
              </div>
              {canAddReason && (
                <button onClick={() => setEditing(true)} className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-brand-500 hover:bg-brand-500/10">
                  <Pencil className="h-4 w-4" /> Edit reason
                </button>
              )}
            </div>
          ) : canAddReason ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">Something here that needs explaining? Your company will see your reason next to this screenshot.</p>
              <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 font-mono text-[12px] font-medium uppercase tracking-[0.06em] text-primary-foreground hover:bg-brand-600">
                <MessageSquareText className="h-4 w-4" /> Add reason
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ReasonEditor({ shot, onDone }: { shot: any; onDone: () => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState<string>(shot.employee_note ?? "");
  const len = text.trim().length;
  const valid = len >= MIN_REASON && len <= MAX_REASON;

  const save = useMutation({
    mutationFn: () => portalApi.setScreenshotReason(shot.id, text.trim()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-screenshots"] });
      toast.success("Reason saved");
      onDone();
    },
    onError: (e: any) => {
      toast.error(e?.response?.status === 503
        ? "Your company's data store can't be reached right now. Please try again shortly."
        : e?.response?.data?.error ?? "Could not save the reason");
    },
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); if (valid && !save.isPending) save.mutate(); }} className="space-y-2">
      <label htmlFor="reason" className="text-xs font-medium text-muted-foreground">Reason for this screenshot</label>
      <textarea
        id="reason"
        autoFocus
        rows={3}
        maxLength={MAX_REASON}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="e.g. Personal call during lunch break, researching a supplier for the Q4 order…"
        className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-brand-500"
      />
      <div className="flex items-center justify-between gap-3">
        <span className={cn("text-xs tabular-nums", len > 0 && len < MIN_REASON ? "text-danger" : "text-subtle")}>
          {len > 0 && len < MIN_REASON ? `At least ${MIN_REASON} characters · ` : ""}{text.length}/{MAX_REASON}
        </span>
        <div className="flex gap-2">
          <button type="button" onClick={onDone} className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted">Cancel</button>
          <button
            type="submit"
            disabled={!valid || save.isPending || text.trim() === (shot.employee_note ?? "")}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 font-mono text-[12px] font-medium uppercase tracking-[0.06em] text-primary-foreground hover:bg-brand-600 disabled:opacity-50"
          >
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save reason
          </button>
        </div>
      </div>
    </form>
  );
}

function LoadError({ error }: { error: unknown }) {
  const res = (error as any)?.response;
  const msg = res?.status === 503
    ? "Your company's screenshot data can't be reached right now. Please try again in a few minutes."
    : res?.data?.error || "We couldn't load your screenshots. Please try again.";
  return (
    <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/5 p-5">
      <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-danger" />
      <p className="text-sm text-body">{msg}</p>
    </div>
  );
}
