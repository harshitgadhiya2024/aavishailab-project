"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import {
  Activity as ActivityIcon, AppWindow, Bug, CheckCircle2, Clock, Download, FileWarning, Globe,
  KeyRound, Laptop, Loader2, Lock, Puzzle, Search, ShieldAlert, ShieldCheck, Wifi, WifiOff, X, XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { portalApi } from "@/lib/api";
import { cn, formatDateTime } from "@/lib/utils";
import { Pagination } from "@/components/ui/Pagination";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:6000";

const RANGES = [
  { label: "24h", days: 1 },
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
];
const ACTIONS = [
  { label: "Everything", value: "" },
  { label: "Blocked", value: "blocked" },
  { label: "Alerted", value: "alerted" },
];
// Same tabs, in the same order, as the company dashboard's Activity page; each
// maps 1:1 onto the API's `source` filter.
const SOURCES = [
  { label: "All", value: "" },
  { label: "Web Gateway", value: "web_gateway" },
  { label: "Applications", value: "application" },
  { label: "DLP", value: "dlp" },
  { label: "Downloads", value: "malware" },
  { label: "Device posture", value: "device_posture" },
  { label: "Devices", value: "device" },
];

type Kind = "website" | "application" | "browser_extension" | "download" | "dlp";
type RequestStatus = "pending" | "approved" | "denied" | "revoked";

type Access = { kind: Kind; label: string; status?: RequestStatus; request_id?: string; note?: string };

type ActivityEvent = {
  id: string;
  event_type: string;
  action: string;
  target?: string;
  target_domain?: string;
  target_app?: string;
  operation?: string;
  policy_name?: string;
  category?: string;
  risk_score?: number;
  timestamp?: string;
  process_name?: string;
  employee_id?: string;
  metadata?: Record<string, any>;
  access?: Access;
};

type AccessRequest = {
  id: string;
  kind: Kind;
  label: string;
  resource: string;
  reason?: string;
  status: RequestStatus;
  review_note?: string;
  created_at?: string;
  reviewed_at?: string;
};

// What each kind of request is, in the employee's words: the button, the
// dialog title, and what approving it will actually do.
const KIND: Record<Kind, { noun: string; icon: React.ElementType; button: string; effect: string }> = {
  website: {
    noun: "Website", icon: Globe, button: "Request access",
    effect: "If approved, this site opens for you only, on all your devices, within about a minute.",
  },
  application: {
    noun: "Application", icon: AppWindow, button: "Request access",
    effect: "If approved, this app is no longer stopped for you, and it can reach its servers.",
  },
  browser_extension: {
    noun: "Browser extension", icon: Puzzle, button: "Request approval",
    effect: "If approved, this extension is no longer flagged for you.",
  },
  download: {
    noun: "Download", icon: Download, button: "Request release",
    effect: "If approved, this exact file (matched by its fingerprint) can be downloaded. Any other file is still scanned.",
  },
  dlp: {
    noun: "Data sharing", icon: FileWarning, button: "Explain",
    effect: "Nothing was blocked. Your explanation is recorded with this event so your company can mark it as a legitimate business need.",
  },
};

const STATUS_BADGE: Record<RequestStatus, { label: string; cls: string; icon: React.ElementType }> = {
  pending: { label: "Waiting for review", cls: "bg-yellow-500/10 text-warning", icon: Clock },
  approved: { label: "Access granted", cls: "bg-green-500/10 text-success", icon: CheckCircle2 },
  denied: { label: "Declined", cls: "bg-red-500/10 text-danger", icon: XCircle },
  revoked: { label: "Revoked", cls: "bg-elevated text-muted-foreground", icon: XCircle },
};

const RESULT_BADGE: Record<string, string> = {
  blocked: "bg-red-500/10 text-danger",
  alerted: "bg-yellow-500/10 text-warning",
  logged: "bg-elevated text-muted-foreground",
};

/** The row's subject as a person would name it, with an icon for its kind. */
function describe(ev: ActivityEvent): { icon: React.ElementType; primary: string; secondary?: string } {
  const cat = (ev.category ?? "").toLowerCase();
  const meta = ev.metadata ?? {};
  if (cat === "malware" || cat === "malware_detection") {
    return { icon: Bug, primary: ev.target || "Downloaded file", secondary: ev.target_domain };
  }
  if (cat === "dlp") {
    const dest = meta.service || meta.destination || meta.app_name || ev.target_app || ev.target_domain || "Unknown destination";
    return { icon: FileWarning, primary: `${ev.operation || "Data sent"} to ${dest}`, secondary: ev.target || meta.site };
  }
  if (cat === "device_posture") {
    return { icon: Laptop, primary: "Device security check", secondary: ev.policy_name };
  }
  if (meta.kind === "browser_extension") {
    return { icon: Puzzle, primary: ev.target || "Browser extension", secondary: [meta.browser, Array.isArray(meta.profiles) ? `${meta.profiles.length} profiles` : meta.profile].filter(Boolean).join(" · ") };
  }
  if (ev.event_type === "process_start" || ev.event_type === "app_launch" || ev.event_type === "app_install") {
    return { icon: AppWindow, primary: ev.target || ev.process_name || "Application", secondary: ev.operation };
  }
  if (["device_connect", "device_disconnect", "device_uninstall"].includes(ev.event_type)) {
    return { icon: Laptop, primary: ev.target || "Device", secondary: ev.operation };
  }
  const domain = ev.target_domain || ev.target;
  return {
    icon: Globe,
    primary: ev.target_app || domain || "—",
    secondary: ev.target_app && ev.target_app !== domain ? domain : undefined,
  };
}

/** Why it happened, in plain words. */
function reasonOf(ev: ActivityEvent): string {
  if (ev.category === "dlp") {
    const matches: string[] = Array.isArray(ev.metadata?.matches) ? ev.metadata!.matches : [];
    return matches[0] || ev.policy_name || "Sensitive data detected";
  }
  return (ev.policy_name || "Company policy").replace(/^Policy:\s*/, "");
}

function ActivityContent() {
  const { data: session } = useSession();
  const qc = useQueryClient();
  const router = useRouter();
  const params = useSearchParams();
  const view = params.get("view") === "requests" ? "requests" : "activity";

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [days, setDays] = useState(7);
  const [search, setSearch] = useState("");
  // Deep links from the dashboard (?source=dlp, ?action=blocked) open the
  // matching tab and filter; anything unrecognised is ignored.
  const [actionFilter, setActionFilter] = useState(() => {
    const a = params.get("action") ?? "";
    return ACTIONS.some((o) => o.value === a) ? a : "";
  });
  const [source, setSource] = useState(() => {
    const s = params.get("source") ?? "";
    return SOURCES.some((o) => o.value === s) ? s : "";
  });
  const [wsConnected, setWsConnected] = useState(false);
  const [requestFor, setRequestFor] = useState<ActivityEvent | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const setView = (v: "activity" | "requests") =>
    router.replace(v === "requests" ? "/dashboard/activity?view=requests" : "/dashboard/activity", { scroll: false });

  const { data: statsData } = useQuery({
    queryKey: ["portal-activity-stats", days],
    queryFn: () => portalApi.activityStats({ days }),
    refetchInterval: 30_000,
  });
  const stats = statsData?.data;

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["portal-activity", page, limit, days, search, actionFilter, source],
    queryFn: () => portalApi.activity({
      page, limit, days,
      action: actionFilter || undefined,
      source: source || undefined,
      search: search || undefined,
    }),
    refetchInterval: wsConnected ? 60_000 : 15_000,
  });
  const events: ActivityEvent[] = Array.isArray(data?.data?.data) ? data.data.data : [];
  const total = data?.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const { data: requestsData, isLoading: requestsLoading } = useQuery({
    queryKey: ["my-access-requests"],
    queryFn: portalApi.accessRequests,
    refetchInterval: 30_000,
  });
  const requests: AccessRequest[] = Array.isArray(requestsData?.data?.data) ? requestsData.data.data : [];
  const pendingCount = requests.filter(r => r.status === "pending").length;

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["portal-activity"] });
    qc.invalidateQueries({ queryKey: ["portal-activity-stats"] });
    qc.invalidateQueries({ queryKey: ["my-access-requests"] });
  };

  const withdraw = useMutation({
    mutationFn: (id: string) => portalApi.withdrawAccessRequest(id),
    onSuccess: () => { toast.success("Request withdrawn"); refreshAll(); },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Could not withdraw the request"),
  });

  // Live: a new event of this employee's refetches the page, so the row
  // arrives with its request state rather than as a bare push.
  useEffect(() => {
    const token = (session as any)?.accessToken;
    const employeeId = (session as any)?.user?.id;
    if (!token || !employeeId) return;
    let cancelled = false;
    const connect = () => {
      if (cancelled) return;
      const ws = new WebSocket(`${WS_URL}/ws?token=${token}`);
      wsRef.current = ws;
      ws.onopen = () => setWsConnected(true);
      ws.onclose = () => {
        setWsConnected(false);
        if (!cancelled) setTimeout(connect, 5000);
      };
      ws.onerror = () => ws.close();
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type !== "activity_event" || msg.payload?.employee_id !== employeeId) return;
          qc.invalidateQueries({ queryKey: ["portal-activity"] });
          qc.invalidateQueries({ queryKey: ["portal-activity-stats"] });
        } catch {}
      };
    };
    connect();
    return () => { cancelled = true; wsRef.current?.close(); };
  }, [(session as any)?.accessToken, (session as any)?.user?.id, qc]);

  const bySource: Record<string, number> = stats?.by_source ?? {};
  // The API's own total: one event can fall under more than one tab.
  const allCount: number = stats?.total ?? Object.values(bySource).reduce((a, b) => a + (b || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="page-eyebrow">My protection</p>
          <h2 className="mt-2 text-[2rem] font-normal leading-[1.1] tracking-[-0.035em] text-foreground">My Activity</h2>
          <p className="text-sm text-muted-foreground mt-1">
            What your company&apos;s security policy blocked or flagged on your devices, and the access you asked for
          </p>
        </div>
        <div className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium",
          wsConnected ? "bg-green-500/10 text-success" : "bg-elevated text-muted-foreground")}>
          {wsConnected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
          {wsConnected ? "Live" : "Polling"}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label={`Blocked (${RANGES.find(r => r.days === days)?.label})`} value={stats?.blocked} tone="text-danger" icon={Lock} />
        <StatCard label={`Alerted (${RANGES.find(r => r.days === days)?.label})`} value={stats?.alerted} tone="text-warning" icon={ShieldAlert} />
        <StatCard label="Requests waiting" value={stats?.requests?.pending ?? 0} tone="text-foreground" icon={Clock}
          onClick={() => setView("requests")} />
        <StatCard label="Access granted" value={stats?.requests?.approved ?? 0} tone="text-success" icon={ShieldCheck}
          onClick={() => setView("requests")} />
      </div>

      <div className="flex items-center gap-1 bg-card border border-border rounded-xl p-1 w-fit">
        {([["activity", "Activity"], ["requests", "My requests"]] as const).map(([v, label]) => (
          <button key={v} onClick={() => setView(v)}
            className={cn("px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2",
              view === v ? "bg-brand-500 text-white" : "text-muted-foreground hover:text-foreground")}>
            {label}
            {v === "requests" && pendingCount > 0 && (
              <span className={cn("min-w-5 h-5 px-1.5 rounded-full text-[11px] grid place-items-center",
                view === v ? "bg-white/20" : "bg-yellow-500/15 text-warning")}>{pendingCount}</span>
            )}
          </button>
        ))}
      </div>

      {view === "requests" ? (
        <RequestsList requests={requests} loading={requestsLoading}
          onWithdraw={(id) => withdraw.mutate(id)} withdrawing={withdraw.isPending} />
      ) : (
        <div className="bg-card rounded-xl border border-border shadow-sm">
          <div className="border-b border-border overflow-x-auto">
            <div className="flex min-w-max">
              {SOURCES.map(s => {
                const n = s.value ? bySource[s.value] : allCount;
                return (
                  <button key={s.value}
                    onClick={() => { setSource(s.value); setPage(1); }}
                    className={cn("px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors flex items-center gap-2",
                      source === s.value ? "border-brand-500 text-brand-500" : "border-transparent text-muted-foreground hover:text-foreground")}>
                    {s.label}
                    {typeof n === "number" && n > 0 && (
                      <span className="text-[11px] px-1.5 rounded-full bg-elevated text-muted-foreground">{n}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="p-4 border-b border-border flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle" />
              <input value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
                placeholder="Search site, app, file or reason..."
                className="pl-9 pr-3 py-2 bg-background border border-border text-foreground rounded-lg text-sm w-full focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
            <Segmented options={RANGES.map(r => ({ label: r.label, value: String(r.days) }))} value={String(days)}
              onChange={v => { setDays(Number(v)); setPage(1); }} />
            <Segmented options={ACTIONS} value={actionFilter} onChange={v => { setActionFilter(v); setPage(1); }} />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 text-left font-medium">When</th>
                  <th className="px-4 py-3 text-left font-medium">What</th>
                  <th className="px-4 py-3 text-left font-medium">Result</th>
                  <th className="px-4 py-3 text-left font-medium">Why</th>
                  <th className="px-4 py-3 text-left font-medium">Access</th>
                </tr>
              </thead>
              <tbody className={cn("divide-y divide-border", isFetching && !isLoading && "opacity-80")}>
                {isLoading ? (
                  [...Array(6)].map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      {[...Array(5)].map((__, j) => (
                        <td key={j} className="px-4 py-4"><div className="h-4 bg-elevated rounded w-3/4" /></td>
                      ))}
                    </tr>
                  ))
                ) : events.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-14 text-subtle">
                      <ShieldCheck className="w-8 h-8 mx-auto mb-2 opacity-40" />
                      Nothing here for this period. Your devices are within policy.
                    </td>
                  </tr>
                ) : events.map(ev => {
                  const d = describe(ev);
                  const repeats = Number(ev.metadata?.repeat_count ?? 1);
                  return (
                    <tr key={ev.id} className="hover:bg-elevated align-top">
                      <td className="px-4 py-3 text-xs text-subtle whitespace-nowrap">{formatDateTime(ev.timestamp ?? "")}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-start gap-2 min-w-0">
                          <d.icon className="w-4 h-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                          <div className="flex flex-col gap-0.5 min-w-0">
                            <span className="font-medium text-foreground truncate max-w-[260px]" title={d.primary}>{d.primary}</span>
                            {d.secondary && <span className="text-[11px] text-subtle truncate max-w-[260px]" title={d.secondary}>{d.secondary}</span>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={cn("px-2 py-0.5 rounded-[4px] text-xs font-medium capitalize", RESULT_BADGE[ev.action] ?? RESULT_BADGE.logged)}>
                          {ev.action}
                        </span>
                        {repeats > 1 && (
                          <span className="ml-1.5 text-[11px] text-subtle" title={`Happened ${repeats} times in a row`}>×{repeats}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-body max-w-xs">
                        <span className="line-clamp-2 text-xs" title={reasonOf(ev)}>{reasonOf(ev)}</span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <AccessCell ev={ev} onRequest={() => setRequestFor(ev)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Pagination page={page} totalPages={totalPages} total={total} limit={limit} onPageChange={setPage} onLimitChange={n => { setLimit(n); setPage(1); }} />
        </div>
      )}

      {requestFor?.access && (
        <RequestDialog ev={requestFor} onClose={() => setRequestFor(null)}
          onSent={() => { setRequestFor(null); refreshAll(); }} />
      )}
    </div>
  );
}

function StatCard({ label, value, tone, icon: Icon, onClick }: {
  label: string; value?: number; tone: string; icon: React.ElementType; onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} className={cn("bg-card rounded-xl border border-border shadow-sm p-4 text-left",
      onClick && "hover:border-brand-500/50 transition-colors")}>
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
        <Icon className="w-4 h-4 text-subtle" />
      </div>
      <p className={cn("text-2xl font-bold mt-1", tone)}>{value ?? "—"}</p>
    </Tag>
  );
}

function Segmented({ options, value, onChange }: { options: { label: string; value: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1 bg-background border border-border rounded-lg p-1">
      {options.map(o => (
        <button key={o.label} onClick={() => onChange(o.value)}
          className={cn("px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
            value === o.value ? "bg-brand-500 text-white" : "text-muted-foreground hover:text-foreground")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** What the employee can do about one row. */
function AccessCell({ ev, onRequest }: { ev: ActivityEvent; onRequest: () => void }) {
  const a = ev.access;
  if (!a) {
    if (ev.category === "device_posture") {
      return <span className="text-xs text-subtle" title={ev.policy_name}>Fix it on your device</span>;
    }
    return <span className="text-subtle">—</span>;
  }
  const kind = KIND[a.kind];
  if (a.status === "pending" || a.status === "approved") {
    const b = STATUS_BADGE[a.status];
    return (
      <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-[4px] text-xs font-medium", b.cls)}>
        <b.icon className="w-3 h-3" /> {a.kind === "dlp" && a.status === "approved" ? "Approved" : b.label}
      </span>
    );
  }
  return (
    <div className="flex items-center gap-2">
      {a.status && (
        <span className={cn("px-2 py-0.5 rounded-[4px] text-xs font-medium", STATUS_BADGE[a.status].cls)} title={a.note || undefined}>
          {STATUS_BADGE[a.status].label}
        </span>
      )}
      <button onClick={onRequest}
        className="inline-flex items-center gap-1 px-2.5 py-1 border border-border text-body rounded-lg text-xs font-medium hover:bg-elevated hover:border-brand-500/50">
        <KeyRound className="w-3 h-3" /> {a.status ? "Ask again" : kind.button}
      </button>
    </div>
  );
}

function RequestDialog({ ev, onClose, onSent }: { ev: ActivityEvent; onClose: () => void; onSent: () => void }) {
  const a = ev.access!;
  const kind = KIND[a.kind];
  const [reason, setReason] = useState("");
  const tooShort = reason.trim().length < 5;

  const send = useMutation({
    mutationFn: () => portalApi.requestAccess({ event_id: ev.id, reason: reason.trim() }),
    onSuccess: () => {
      toast.success(a.kind === "dlp" ? "Explanation sent to your company" : "Request sent. Your company has been notified.");
      onSent();
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Could not send the request"),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="request-title"
        className="bg-card rounded-lg border border-border shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-brand-500/10 grid place-items-center">
              <kind.icon className="w-5 h-5 text-brand-500" />
            </span>
            <div>
              <h3 id="request-title" className="font-semibold text-foreground">
                {a.kind === "dlp" ? "Explain this data transfer" : `${kind.button}: ${kind.noun.toLowerCase()}`}
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">Sent to your company&apos;s admins for review</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-subtle hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>

        <dl className="mt-5 rounded-xl border border-border bg-background p-3 text-sm space-y-2">
          <div className="flex gap-3"><dt className="w-20 shrink-0 text-muted-foreground">{kind.noun}</dt><dd className="font-medium text-foreground [overflow-wrap:anywhere]">{a.label}</dd></div>
          <div className="flex gap-3"><dt className="w-20 shrink-0 text-muted-foreground">Stopped by</dt><dd className="text-body">{reasonOf(ev)}</dd></div>
          <div className="flex gap-3"><dt className="w-20 shrink-0 text-muted-foreground">When</dt><dd className="text-body">{formatDateTime(ev.timestamp ?? "")}</dd></div>
        </dl>

        <label htmlFor="request-reason" className="block text-sm font-medium text-foreground mt-5 mb-1.5">
          {a.kind === "dlp" ? "Why did you send this?" : "Why do you need it?"} <span className="text-danger">*</span>
        </label>
        <textarea id="request-reason" autoFocus value={reason} onChange={e => setReason(e.target.value.slice(0, 1000))} rows={4}
          placeholder={a.kind === "dlp"
            ? "e.g. Sending the signed offer letter to the new joiner, approved by HR"
            : "e.g. I need the payroll portal to download salary slips for the finance team"}
          className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500" />
        <div className="flex justify-between text-[11px] text-subtle mt-1">
          <span>{tooShort ? "A few words at least" : " "}</span>
          <span>{reason.length}/1000</span>
        </div>

        <p className="text-xs text-muted-foreground mt-3 leading-relaxed">{kind.effect}</p>

        <div className="flex gap-3 mt-5">
          <button onClick={onClose} className="flex-1 border border-border text-body py-2 rounded-lg text-sm hover:bg-elevated">Cancel</button>
          <button onClick={() => send.mutate()} disabled={tooShort || send.isPending}
            className="flex-1 bg-brand-500 text-on-brand py-2 rounded-lg font-mono text-[12px] font-medium uppercase tracking-[0.06em] flex items-center justify-center gap-2 disabled:opacity-50">
            {send.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Send request
          </button>
        </div>
      </div>
    </div>
  );
}

function RequestsList({ requests, loading, onWithdraw, withdrawing }: {
  requests: AccessRequest[]; loading: boolean; onWithdraw: (id: string) => void; withdrawing: boolean;
}) {
  if (loading) {
    return <div className="bg-card rounded-xl border border-border p-10 grid place-items-center"><Loader2 className="w-5 h-5 animate-spin text-brand-500" /></div>;
  }
  if (requests.length === 0) {
    return (
      <div className="bg-card rounded-xl border border-border p-12 text-center text-subtle">
        <ActivityIcon className="w-8 h-8 mx-auto mb-2 opacity-40" />
        You haven&apos;t asked for any access yet. Use <span className="text-body font-medium">Request access</span> on a blocked item in your activity.
      </div>
    );
  }
  return (
    <div className="bg-card rounded-xl border border-border divide-y divide-border">
      {requests.map(r => {
        const kind = KIND[r.kind] ?? KIND.website;
        const b = STATUS_BADGE[r.status] ?? STATUS_BADGE.pending;
        return (
          <div key={r.id} className="p-4 flex flex-col sm:flex-row sm:items-start gap-3">
            <span className="w-9 h-9 rounded-lg bg-elevated grid place-items-center shrink-0">
              <kind.icon className="w-4 h-4 text-muted-foreground" />
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-foreground [overflow-wrap:anywhere]">{r.label || r.resource}</span>
                <span className="text-[11px] text-subtle">{kind.noun}</span>
              </div>
              {r.reason && <p className="text-sm text-body mt-1">&ldquo;{r.reason}&rdquo;</p>}
              {r.review_note && (
                <p className="text-sm mt-2 rounded-lg bg-background border border-border px-3 py-2">
                  <span className="text-muted-foreground">Your company: </span><span className="text-body">{r.review_note}</span>
                </p>
              )}
              <p className="text-[11px] text-subtle mt-2">
                Asked {r.created_at ? formatDateTime(r.created_at) : ""}
                {r.reviewed_at && ` · Reviewed ${formatDateTime(r.reviewed_at)}`}
              </p>
            </div>
            <div className="flex sm:flex-col items-center sm:items-end gap-2 shrink-0">
              <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-[4px] text-xs font-medium", b.cls)}>
                <b.icon className="w-3 h-3" /> {b.label}
              </span>
              {r.status === "pending" && (
                <button onClick={() => onWithdraw(r.id)} disabled={withdrawing}
                  className="text-xs text-muted-foreground hover:text-danger disabled:opacity-50">Withdraw</button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function ActivityPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-brand-500" />
      </div>
    }>
      <ActivityContent />
    </Suspense>
  );
}
