"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { activityApi } from "@/lib/api";
import {
  Shield, Search, Wifi, WifiOff, Bug, FileWarning, Mail, MessageSquare,
  Upload, Download, Share2, FileText, Sparkles, Globe, Activity as ActivityIcon
} from "lucide-react";
import { formatDateTime, cn } from "@/lib/utils";
import { Pagination } from "@/components/ui/Pagination";

// Icon per operation label the API sends, so "Email sent" reads at a glance
// instead of being one more line of grey text.
const OPERATION_ICONS: Record<string, React.ElementType> = {
  "Email sent": Mail,
  "Message sent": MessageSquare,
  "File upload": Upload,
  "File shared": Share2,
  "File download": Download,
  "Form submitted": FileText,
  "Data submitted": FileText,
  "Comment posted": MessageSquare,
  "AI prompt sent": Sparkles,
  "Web request": Globe,
  "DNS lookup": Globe,
};

function OperationIcon({ operation }: { operation: string }) {
  const Icon = OPERATION_ICONS[operation] ?? ActivityIcon;
  return <Icon className="w-3.5 h-3.5 text-subtle flex-shrink-0" />;
}

type ActivityEvent = {
  id: string;
  event_type: string;
  action: string;
  target?: string;
  target_domain?: string;
  /** Platform name resolved from target_domain by the shadow-IT catalog. */
  target_app?: string;
  /** What the person was doing — "Email sent", "Message sent", "File upload". */
  operation?: string;
  policy_name?: string;
  category?: string;
  risk_score?: number;
  timestamp?: string;
  created_at?: string;
  employee?: { first_name?: string; last_name?: string; email?: string } | null;
};

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:6000";
const RANGES = [
  { label: "24h", days: 1 },
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
];
// "Everything" is not literally every action: the server hard-excludes
// "allowed" from every response to this endpoint regardless of what filter
// is asked for (see the Go handler's List) — routine, allowed traffic is
// never stored at all any more, so there is nothing for any filter value to
// surface. "" here just means "no action filter", which in practice shows
// blocked, alerted and logged rows (app installs, the daily posture line) —
// everything that isn't routine passthrough traffic.
const ACTIONS = [
  { label: "Everything", value: "" },
  { label: "Blocked", value: "blocked" },
  { label: "Alerted", value: "alerted" },
  { label: "Incidents", value: "blocked,alerted" },
];

// Which part of the product produced the event. Maps 1:1 onto the API's
// `source` parameter (see activitySourceScope in the Go handler), so a tab
// here is a server-side filter, not a client-side slice of one page.
const SOURCES = [
  { label: "All", value: "" },
  { label: "Web Gateway", value: "web_gateway" },
  { label: "DLP", value: "dlp" },
  { label: "Applications", value: "application" },
  { label: "Downloads", value: "malware" },
  { label: "Device posture", value: "device_posture" },
  { label: "Devices", value: "device" },
];

/**
 * Client-side mirror of the API's `source` filter, used only for the live
 * WebSocket feed — a pushed event has to be judged here because it never went
 * through the query that already applied the filter server-side.
 *
 * Kept deliberately small and in the same order as the Go version: if the two
 * ever disagree, the visible symptom is one live row appearing under the wrong
 * tab until the next poll corrects it, not a wrong stored result.
 */
function matchesSource(source: string, ev: ActivityEvent): boolean {
  if (!source) return true;
  const cat = (ev.category ?? "").toLowerCase();
  const type = ev.event_type ?? "";
  switch (source) {
    case "web_gateway":
      return (type === "web_request" || type === "dns_query")
        && !["dlp", "malware", "malware_detection", "device_posture", "application_control"].includes(cat);
    case "dlp":
      return cat === "dlp";
    case "malware":
      return cat === "malware" || cat === "malware_detection";
    case "application":
      return type === "process_start" || type === "app_launch" || type === "app_install"
        || cat === "application_control";
    case "device_posture":
      return cat === "device_posture";
    case "device":
      return ["device_connect", "device_disconnect", "device_uninstall"].includes(type);
    default:
      return true;
  }
}

export default function ActivityPage() {
  const { data: session } = useSession();
  const [search, setSearch] = useState("");
  const [days, setDays] = useState(7);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [actionFilter, setActionFilter] = useState("");
  const [source, setSource] = useState("");
  const [liveEvents, setLiveEvents] = useState<ActivityEvent[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["activity", page, limit, search, days, actionFilter, source],
    queryFn: () => activityApi.list({
      page, limit,
      search: search || undefined,
      action: actionFilter || undefined,
      source: source || undefined,
      days,
    }),
    refetchInterval: wsConnected ? undefined : 15_000,
  });

  // WebSocket live feed — blocked events only
  useEffect(() => {
    const token = (session as any)?.accessToken;
    const orgId = (session as any)?.user?.org_id;
    if (!token || !orgId) return;

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
          // actionFilter can be a comma-separated list ("blocked,alerted"),
          // so the live feed has to match the same way the query does.
          const wanted = actionFilter.split(",").filter(Boolean);
          if (wanted.length > 0 && !wanted.includes(ev.action)) return;
          if (!matchesSource(source, ev)) return;
          setLiveEvents(prev => [ev, ...prev].slice(0, 50));
        } catch {}
      };
    };

    connect();
    return () => { cancelled = true; wsRef.current?.close(); };
  }, [(session as any)?.accessToken, actionFilter, source]);

  const events = Array.isArray(data?.data?.data) ? data.data.data : (data?.data?.events ?? []);
  const total = data?.data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);
  const displayEvents = [...liveEvents, ...events].filter((ev, idx, arr) =>
    arr.findIndex((other) => other.id === ev.id) === idx
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Security Activity</h2>
          <p className="text-sm text-muted-foreground mt-1">Blocked and alerted activity from endpoint agents</p>
        </div>
        <div className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium",
          wsConnected ? "bg-green-500/10 text-success" : "bg-elevated text-muted-foreground")}>
          {wsConnected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
          {wsConnected ? "Live" : "Polling"}
        </div>
      </div>

      {/* Live events banner */}
      {liveEvents.length > 0 && (
        <div className="bg-brand-500/10 border border-brand-500/30 rounded-xl px-4 py-3 flex items-center justify-between">
          <span className="text-sm text-brand-500">
            {liveEvents.length} new event(s)
          </span>
          <button onClick={() => setLiveEvents([])} className="text-xs text-brand-500 hover:text-brand-400">Clear</button>
        </div>
      )}

      <div className="bg-card rounded-xl border border-border shadow-sm">
        {/* Source tabs — one row per part of the product, so "show me only the
            DLP trail" or "only app installs" is one click rather than a
            search. Scrolls horizontally on a narrow screen instead of
            wrapping into a second confusing row of pills. */}
        <div className="border-b border-border overflow-x-auto">
          <div className="flex min-w-max">
            {SOURCES.map(s => (
              <button
                key={s.value}
                onClick={() => { setSource(s.value); setLiveEvents([]); setPage(1); }}
                className={cn(
                  "px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors",
                  source === s.value
                    ? "border-brand-500 text-brand-500"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Filters */}
        <div className="p-4 border-b border-border flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle" />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search domain, reason..."
              className="pl-9 pr-3 py-2 bg-background border border-border rounded-lg text-sm w-full text-foreground placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-brand-500"
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

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3 text-left font-medium">Employee</th>
                <th className="px-5 py-3 text-left font-medium">Domain</th>
                <th className="px-5 py-3 text-left font-medium">Action</th>
                <th className="px-5 py-3 text-left font-medium">Reason / Policy</th>
                <th className="px-5 py-3 text-left font-medium">Category</th>
                <th className="px-5 py-3 text-left font-medium">Risk Score</th>
                <th className="px-5 py-3 text-left font-medium">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-elevated">
              {isLoading ? (
                [...Array(8)].map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {[...Array(7)].map((__, j) => (
                      <td key={j} className="px-5 py-4"><div className="h-4 bg-elevated rounded w-3/4" /></td>
                    ))}
                  </tr>
                ))
              ) : displayEvents.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-subtle">
                    <Shield className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No matching activity in this period
                  </td>
                </tr>
              ) : (
                displayEvents.map((ev: ActivityEvent, idx: number) => {
                  const isMalware = ev.category === "malware_detection";
                  const isDLP = ev.category === "dlp";
                  return (
                  <tr key={ev.id}
                    className={cn("hover:bg-elevated transition-colors", idx < liveEvents.length && "bg-brand-500/5")}>
                    <td className="px-5 py-3 text-body text-xs whitespace-nowrap">
                      {ev.employee ? `${ev.employee.first_name ?? ""} ${ev.employee.last_name ?? ""}`.trim() || ev.employee.email : "—"}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <Shield className="w-3.5 h-3.5 text-danger flex-shrink-0" />
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <span className="text-body truncate max-w-[220px] text-xs">
                            {ev.target_app || ev.target_domain || ev.target || "—"}
                          </span>
                          {ev.target_app && ev.target_domain && ev.target_app !== ev.target_domain && (
                            <span className="font-mono text-[11px] text-subtle truncate max-w-[220px]">
                              {ev.target_domain}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      {ev.operation ? (
                        <span className="inline-flex items-center gap-1.5 text-body text-xs whitespace-nowrap">
                          <OperationIcon operation={ev.operation} />
                          {ev.operation}
                        </span>
                      ) : (
                        <span className="text-subtle text-xs">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground text-xs max-w-xs truncate">{ev.policy_name || "Organization policy"}</td>
                    <td className="px-5 py-3">
                      {isMalware ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-danger">
                          <Bug className="w-3 h-3" /> Malware Detection
                        </span>
                      ) : isDLP ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-500/10 text-warning">
                          <FileWarning className="w-3 h-3" /> Data Loss Prevention
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs capitalize">{ev.category?.replace(/_/g, " ") || "—"}</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
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
                    <td className="px-5 py-3 text-xs text-subtle">{formatDateTime(ev.timestamp || ev.created_at || "")}</td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <Pagination page={page} totalPages={totalPages} total={total} limit={limit} onPageChange={setPage} onLimitChange={n => { setLimit(n); setPage(1); }} />
      </div>
    </div>
  );
}
