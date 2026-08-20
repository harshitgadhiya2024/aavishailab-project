"use client";

import { Suspense, useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { portalApi } from "@/lib/api";
import { ShieldAlert, Search, Loader2, Wifi, WifiOff, Bug, Lock } from "lucide-react";
import { formatDateTime, cn } from "@/lib/utils";
import { Pagination } from "@/components/ui/Pagination";
import { toast } from "sonner";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:6000";
const RANGES = [
  { label: "24h", days: 1 },
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
];
const ACTIONS = [
  { label: "Blocked", value: "blocked" },
  { label: "Alerted", value: "alerted" },
  { label: "All", value: "" },
];

type ActivityEvent = {
  id: string;
  action: string;
  target?: string;
  target_domain?: string;
  /** Platform name resolved from target_domain by the shadow-IT catalog. */
  target_app?: string;
  policy_id?: string;
  policy_name?: string;
  category?: string;
  risk_score?: number;
  employee_id?: string;
  timestamp?: string;
};

function ActivityContent() {
  const { data: session } = useSession();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [days, setDays] = useState(7);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("blocked");
  const [liveEvents, setLiveEvents] = useState<ActivityEvent[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [reasonFor, setReasonFor] = useState<{ policyId: string; domain: string } | null>(null);
  const [reasonText, setReasonText] = useState("");
  const wsRef = useRef<WebSocket | null>(null);

  const { data: myRequestsData } = useQuery({
    queryKey: ["my-access-requests"],
    queryFn: portalApi.accessRequests,
  });
  const myRequests: any[] = Array.isArray(myRequestsData?.data?.data) ? myRequestsData.data.data : [];
  const requestStatus = (policyId?: string, domain?: string): string | null => {
    if (!policyId || !domain) return null;
    const match = myRequests.find(r => r.policy_id === policyId && r.domain === domain);
    return match?.status ?? null;
  };

  const requestMut = useMutation({
    mutationFn: (vars: { policy_id: string; domain: string; reason?: string }) => portalApi.requestAccess(vars),
    onSuccess: () => {
      toast.success("Access request sent to your admin");
      qc.invalidateQueries({ queryKey: ["my-access-requests"] });
      setReasonFor(null);
      setReasonText("");
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Failed to send request"),
  });

  const { data: statsData } = useQuery({
    queryKey: ["portal-activity-stats", days],
    queryFn: () => portalApi.activityStats({ days }),
    refetchInterval: 30_000,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["portal-activity", page, limit, days, search],
    queryFn: () => portalApi.activity({
      page, limit,
      action: actionFilter || undefined,
      days,
      search: search || undefined,
    }),
    refetchInterval: wsConnected ? undefined : 15_000,
  });

  // Live feed — same org-wide broadcast the company dashboard uses; filtered
  // down here to this employee's own blocked events only.
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
          if (msg.type !== "activity_event") return;
          const ev = msg.payload as ActivityEvent;
          if ((actionFilter && ev.action !== actionFilter) || ev.employee_id !== employeeId) return;
          setLiveEvents(prev => [ev, ...prev].slice(0, 50));
        } catch {}
      };
    };

    connect();
    return () => { cancelled = true; wsRef.current?.close(); };
  }, [(session as any)?.accessToken, (session as any)?.user?.id, actionFilter]);

  const events = data?.data?.data ?? [];
  const total = data?.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const stats = statsData?.data;
  const topBlocked = stats?.top_blocked ?? [];
  const displayEvents: ActivityEvent[] = [...liveEvents, ...events].filter((ev, idx, arr) =>
    arr.findIndex((other) => other.id === ev.id) === idx
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Security Activity</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Websites and uploads blocked or alerted by your company policy
          </p>
        </div>
        <div className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium",
          wsConnected ? "bg-green-500/10 text-success" : "bg-elevated text-muted-foreground")}>
          {wsConnected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
          {wsConnected ? "Live" : "Polling"}
        </div>
      </div>

      {liveEvents.length > 0 && (
        <div className="bg-brand-500/10 border border-brand-500/30 rounded-xl px-4 py-3 flex items-center justify-between">
          <span className="text-sm text-brand-500">{liveEvents.length} new event(s)</span>
          <button onClick={() => setLiveEvents([])} className="text-xs text-brand-500 hover:text-brand-400">Clear</button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-card rounded-xl border border-border shadow-sm p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Blocked ({RANGES.find(r => r.days === days)?.label})</p>
          <p className="text-2xl font-bold text-danger mt-1">{stats?.blocked ?? "—"}</p>
        </div>
        <div className="bg-card rounded-xl border border-border shadow-sm p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Top blocked domain</p>
          <p className="text-sm font-semibold text-foreground mt-1 truncate">
            {topBlocked[0]?.domain || "—"}
          </p>
          {topBlocked[0] && (
            <p className="text-xs text-subtle">{topBlocked[0].count} times</p>
          )}
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border shadow-sm">
        <div className="p-4 border-b border-border flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle" />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search domain or reason..."
              className="pl-9 pr-3 py-2 bg-background border border-border text-foreground rounded-lg text-sm w-full focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div className="flex items-center gap-1 bg-background border border-border rounded-lg p-1">
            {RANGES.map(r => (
              <button
                key={r.days}
                onClick={() => { setDays(r.days); setPage(1); }}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                  days === r.days ? "bg-brand-500 text-white" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 bg-background border border-border rounded-lg p-1">
            {ACTIONS.map(a => (
              <button
                key={a.label}
                onClick={() => { setActionFilter(a.value); setLiveEvents([]); setPage(1); }}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                  actionFilter === a.value ? "bg-brand-500 text-white" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 text-left font-medium">Time</th>
                <th className="px-4 py-3 text-left font-medium">Domain</th>
                <th className="px-4 py-3 text-left font-medium">Reason / Policy</th>
                <th className="px-4 py-3 text-left font-medium">Category</th>
                <th className="px-4 py-3 text-left font-medium">Risk Score</th>
                <th className="px-4 py-3 text-left font-medium">Access</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="text-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin text-brand-500 mx-auto" />
                  </td>
                </tr>
              ) : displayEvents.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-subtle">
                    <ShieldAlert className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No matching activity in this period
                  </td>
                </tr>
              ) : (
                displayEvents.map((ev: any, idx: number) => {
                  const isMalware = ev.category === "malware_detection";
                  const domain = ev.target_domain || ev.target;
                  const status = requestStatus(ev.policy_id, domain);
                  return (
                  <tr key={ev.id} className={cn("hover:bg-elevated", idx < liveEvents.length && "bg-brand-500/5")}>
                    <td className="px-4 py-3 text-xs text-subtle whitespace-nowrap">
                      {formatDateTime(ev.timestamp)}
                    </td>
                    {/* domain stays the key for requestStatus above; this cell
                        only changes what's shown. */}
                    <td className="px-4 py-3 font-medium text-foreground">
                      {domain ? (
                        <div className="flex flex-col gap-0.5">
                          <span>{ev.target_app || domain}</span>
                          {ev.target_app && ev.target_app !== domain && (
                            <span className="font-mono text-[11px] font-normal text-subtle">{domain}</span>
                          )}
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3 text-body max-w-xs truncate">
                      {ev.policy_name || ev.ai_explanation || "Organization policy"}
                    </td>
                    <td className="px-4 py-3">
                      {isMalware ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-danger">
                          <Bug className="w-3 h-3" /> Malware Detection
                        </span>
                      ) : (
                        <span className="text-muted-foreground capitalize">{ev.category?.replace(/_/g, " ") || "—"}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {typeof ev.risk_score === "number" && ev.risk_score > 0 ? (
                        <span className={cn(
                          "font-mono text-xs font-semibold",
                          ev.risk_score > 80 ? "text-danger" : ev.risk_score > 40 ? "text-warning" : "text-muted-foreground"
                        )}>
                          {ev.risk_score}
                        </span>
                      ) : (
                        <span className="text-subtle">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {ev.action !== "blocked" ? (
                        <span className="text-subtle">Alert only</span>
                      ) : !ev.policy_id || !domain ? (
                        <span className="text-subtle">—</span>
                      ) : status === "pending" ? (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-500/10 text-warning">Requested</span>
                      ) : status === "approved" ? (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/10 text-success">Access Granted</span>
                      ) : status === "denied" ? (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-danger">Denied</span>
                      ) : (
                        <button
                          onClick={() => { setReasonFor({ policyId: ev.policy_id, domain }); setReasonText(""); }}
                          className="flex items-center gap-1 px-2.5 py-1 border border-border text-body rounded-lg text-xs font-medium hover:bg-elevated"
                        >
                          <Lock className="w-3 h-3" /> Request Access
                        </button>
                      )}
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <Pagination page={page} totalPages={totalPages} total={total} limit={limit} onPageChange={setPage} onLimitChange={n => { setLimit(n); setPage(1); }} />
      </div>

      {reasonFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-card rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="font-semibold text-foreground mb-1">Request Access</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Ask your admin to allow <span className="font-mono text-body">{reasonFor.domain}</span> for you.
            </p>
            <textarea
              value={reasonText}
              onChange={e => setReasonText(e.target.value)}
              rows={3}
              placeholder="Why do you need access? (optional)"
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500 mb-4"
            />
            <div className="flex gap-3">
              <button onClick={() => setReasonFor(null)} className="flex-1 border border-border text-body py-2 rounded-lg text-sm">Cancel</button>
              <button
                onClick={() => requestMut.mutate({ policy_id: reasonFor.policyId, domain: reasonFor.domain, reason: reasonText.trim() || undefined })}
                disabled={requestMut.isPending}
                className="flex-1 bg-brand-500 text-on-brand py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {requestMut.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Send Request
              </button>
            </div>
          </div>
        </div>
      )}
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
