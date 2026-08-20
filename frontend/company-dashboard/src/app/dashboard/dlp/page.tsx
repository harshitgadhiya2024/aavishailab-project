"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { activityApi, policyApi, dlpApi } from "@/lib/api";
import { FileWarning, ShieldAlert, ShieldCheck, Bell, Users, ArrowRight, FileText, FlaskConical, Loader2, Search } from "lucide-react";
import { formatDateTime, cn } from "@/lib/utils";
import { Pagination } from "@/components/ui/Pagination";

type ActivityEvent = {
  id: string;
  action: string;
  target?: string;
  target_domain?: string;
  /** Platform name resolved from target_domain by the shadow-IT catalog. */
  target_app?: string;
  /** What the user was doing — "Email sent", "Message sent", "File upload". */
  operation?: string;
  policy_name?: string;
  risk_score?: number;
  metadata?: { detectors?: string[]; matches?: string[]; score?: number; band?: string };
  timestamp?: string;
  created_at?: string;
  employee?: { first_name?: string; last_name?: string; email?: string } | null;
};

type TestResult = {
  matched: boolean;
  score: number;
  band: string;
  action: string;
  policy_name?: string;
  detectors?: string[];
  matches?: string[];
  reason?: string;
  policies_evaluated?: number;
};

// A score's band → colour, shared by the incident table and the test panel so
// "80 = red/block" reads identically everywhere.
function bandStyle(band?: string) {
  switch (band) {
    case "block":
      return "bg-red-500/10 text-danger border-red-500/20";
    case "alert":
      return "bg-yellow-500/10 text-warning border-yellow-500/20";
    default:
      return "bg-emerald-500/10 text-success border-emerald-500/20";
  }
}

function actionStyle(action: string) {
  if (action === "blocked" || action === "block") return "bg-red-500/10 text-danger";
  if (action === "alerted" || action === "alert") return "bg-yellow-500/10 text-warning";
  return "bg-elevated text-body";
}

function TestSamplePanel() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<TestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!text.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await dlpApi.test({ text });
      setResult(res.data as TestResult);
    } catch (e: any) {
      setError(e?.response?.data?.error || "Test failed");
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm p-4">
      <div className="flex items-center gap-2 mb-1">
        <FlaskConical className="w-4 h-4 text-brand-500" />
        <h3 className="font-semibold text-foreground">Test a sample</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Paste text (e.g. a card number, an API key, a document snippet) to see the sensitivity score and the
        decision automatic DLP would make (block ≥80, alert 50–79). Nothing is saved.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder="Paste content to scan…"
        className="w-full bg-sunken border border-border rounded-lg p-3 text-sm text-foreground font-mono focus:outline-none focus:border-brand-500 resize-y"
      />
      <div className="flex items-center gap-3 mt-3">
        <button
          onClick={run}
          disabled={loading || !text.trim()}
          className="flex items-center gap-2 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" />}
          Scan sample
        </button>
        {error && <span className="text-xs text-danger">{error}</span>}
      </div>

      {result && (
        <div className="mt-4 border-t border-border pt-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Score</span>
              <span className="text-2xl font-bold text-foreground tabular-nums">{result.score}</span>
              <span className="text-xs text-subtle">/ 100</span>
            </div>
            <span className={cn("px-3 py-1 rounded-full text-xs font-semibold uppercase border", bandStyle(result.band))}>
              {result.band}
            </span>
            <span className="text-xs text-muted-foreground">
              Decision:{" "}
              <span className="font-medium text-body capitalize">{result.action}</span>
              {result.action === "block"
                ? " — upload would be stopped"
                : result.action === "alert"
                  ? " — allowed but flagged"
                  : result.action === "log"
                    ? " — recorded only"
                    : " — allowed"}
            </span>
          </div>

          {/* Score bar — alert band starts at 50, block band at 80 */}
          <div className="mt-3 relative h-2 bg-sunken rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full",
                result.band === "block" ? "bg-red-500" : result.band === "alert" ? "bg-yellow-500" : "bg-emerald-500"
              )}
              style={{ width: `${Math.min(100, Math.max(2, result.score))}%` }}
            />
          </div>

          {result.matched ? (
            <div className="mt-3 text-xs text-muted-foreground space-y-1">
              {result.policy_name && (
                <p>
                  Matched policy: <span className="text-body">{result.policy_name}</span>
                </p>
              )}
              {(result.matches ?? []).length > 0 && (
                <ul className="list-disc list-inside font-mono">
                  {result.matches!.map((m, i) => (
                    <li key={i} className="text-body">{m}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p className="mt-3 text-xs text-success">No sensitive data detected — this would be allowed.</p>
          )}
        </div>
      )}
    </div>
  );
}


const RANGES = [
  { label: "24h", days: 1 },
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
];

const ACTIONS = [
  { label: "All", value: "" },
  { label: "Blocked", value: "blocked" },
  { label: "Alerted", value: "alerted" },
];

export default function DLPPage() {
  const [search, setSearch] = useState("");
  const [days, setDays] = useState(7);
  const [actionFilter, setActionFilter] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);

  // Debounced so typing doesn't fire a request per keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data: eventsData, isLoading } = useQuery({
    queryKey: ["dlp-incidents", page, limit, debouncedSearch, days, actionFilter],
    queryFn: () =>
      activityApi.list({
        event_type: "policy_violation",
        page,
        limit,
        days,
        search: debouncedSearch || undefined,
        action: actionFilter || undefined,
      }),
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });

  // Summary cards come from the aggregate endpoint rather than the rows on
  // screen: counting the current page would report "20 blocked" no matter how
  // many incidents the selected range actually holds.
  const { data: statsData } = useQuery({
    queryKey: ["dlp-stats", days],
    queryFn: () => activityApi.stats({ days, event_type: "policy_violation" }),
    refetchInterval: 30_000,
  });

  const { data: policiesData } = useQuery({
    queryKey: ["dlp-policies"],
    queryFn: () => policyApi.list({ type: "dlp", limit: 100 }),
  });

  const events: ActivityEvent[] = Array.isArray(eventsData?.data?.data) ? eventsData.data.data : [];
  const policies = Array.isArray(policiesData?.data?.data) ? policiesData.data.data : [];

  const total = eventsData?.data?.total ?? 0;
  const totalPages = eventsData?.data?.pages ?? 1;

  const stats = useMemo(() => {
    const s = statsData?.data?.stats;
    const topDetector = statsData?.data?.top_detectors?.[0]?.detector;

    return {
      enabledPolicies: policies.filter((p: any) => p.enabled).length,
      blocked: s?.blocked_events ?? 0,
      alerted: s?.alerted_events ?? 0,
      uniqueEmployees: s?.unique_users ?? 0,
      topDetector: topDetector ? topDetector.replace(/_/g, " ") : "—",
    };
  }, [statsData, policies]);

  const scoreOf = (e: ActivityEvent) =>
    typeof e.metadata?.score === "number" ? e.metadata.score : typeof e.risk_score === "number" ? e.risk_score : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Data Loss Prevention</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Every upload is automatically scored for sensitive data — no setup required
          </p>
        </div>
        <Link
          href="/dashboard/policies"
          className="flex items-center gap-2 border border-border text-body hover:bg-elevated px-4 py-2 rounded-lg text-sm"
        >
          <FileText className="w-4 h-4" /> Customize (optional) <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "DLP Protection", value: stats.enabledPolicies > 0 ? `Auto + ${stats.enabledPolicies}` : "Automatic", color: "bg-emerald-500/10 text-success", icon: ShieldCheck },
          { label: "Uploads Blocked", value: stats.blocked, color: "bg-red-500/10 text-danger", icon: ShieldAlert },
          { label: "Alerts Raised", value: stats.alerted, color: "bg-yellow-500/10 text-warning", icon: Bell },
          { label: "Employees Involved", value: stats.uniqueEmployees, color: "bg-purple-500/10 text-accent-purple", icon: Users },
        ].map((s) => (
          <div key={s.label} className="bg-card rounded-xl p-4 border border-border shadow-sm flex items-center gap-3">
            <div className={`p-2 rounded-lg ${s.color}`}>
              <s.icon className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-xl font-bold text-foreground">{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 text-sm text-success flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-medium text-success">Automatic DLP is on</p>
          <p className="text-success/90 mt-0.5">
            Every file employees upload is scanned for sensitive data and scored 0–100.{" "}
            <span className="font-medium">Score 70 or above is blocked</span>,{" "}
            <span className="font-medium">50–69 is allowed but flagged</span>, and anything lower is allowed.
            No policy setup needed.
            {stats.enabledPolicies > 0 && (
              <> Your {stats.enabledPolicies} custom {stats.enabledPolicies === 1 ? "policy" : "policies"} override the defaults where they apply.</>
            )}
          </p>
        </div>
      </div>

      <TestSamplePanel />

      {/* Incident table */}
      <div className="bg-card rounded-xl border border-border shadow-sm">
        <div className="p-4 border-b border-border">
          <h3 className="font-semibold text-foreground">Incidents</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {total.toLocaleString()} in the last {days === 1 ? "24 hours" : `${days} days`} — refreshes automatically
          </p>
        </div>

        {/* Filters */}
        <div className="p-4 border-b border-border flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search file, destination, policy..."
              className="pl-9 pr-3 py-2 bg-background border border-border rounded-lg text-sm w-full text-foreground placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div className="flex items-center gap-1 bg-background border border-border rounded-lg p-1">
            {RANGES.map((r) => (
              <button
                key={r.days}
                onClick={() => {
                  setDays(r.days);
                  setPage(1);
                }}
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
            {ACTIONS.map((a) => (
              <button
                key={a.label}
                onClick={() => {
                  setActionFilter(a.value);
                  setPage(1);
                }}
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
                <th className="px-5 py-3 text-left font-medium">Employee</th>
                <th className="px-5 py-3 text-left font-medium">File</th>
                <th className="px-5 py-3 text-left font-medium">Destination</th>
                <th className="px-5 py-3 text-left font-medium">Operation</th>
                <th className="px-5 py-3 text-left font-medium">Policy</th>
                <th className="px-5 py-3 text-left font-medium">Detector</th>
                <th className="px-5 py-3 text-left font-medium">Score</th>
                <th className="px-5 py-3 text-left font-medium">Action</th>
                <th className="px-5 py-3 text-left font-medium">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-elevated">
              {isLoading ? (
                [...Array(6)].map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {[...Array(9)].map((__, j) => (
                      <td key={j} className="px-5 py-4">
                        <div className="h-4 bg-elevated rounded w-3/4" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : events.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-subtle">
                    <FileWarning className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    {debouncedSearch || actionFilter ? (
                      <>
                        No incidents match these filters
                        <button
                          onClick={() => {
                            setSearch("");
                            setActionFilter("");
                            setPage(1);
                          }}
                          className="block mx-auto mt-2 text-xs text-brand-500 hover:text-brand-400"
                        >
                          Clear filters
                        </button>
                      </>
                    ) : (
                      `No DLP incidents in the last ${days === 1 ? "24 hours" : `${days} days`}`
                    )}
                  </td>
                </tr>
              ) : (
                events.map((ev) => {
                  const score = scoreOf(ev);
                  return (
                    <tr key={ev.id} className="hover:bg-elevated">
                      <td className="px-5 py-3 text-body text-xs whitespace-nowrap">
                        {ev.employee
                          ? `${ev.employee.first_name ?? ""} ${ev.employee.last_name ?? ""}`.trim() || ev.employee.email
                          : "—"}
                      </td>
                      <td className="px-5 py-3 text-body font-mono text-xs truncate max-w-[180px]">{ev.target || "—"}</td>
                      {/* Platform name leads; the raw hostname stays visible
                          underneath since it's the forensic detail. */}
                      <td className="px-5 py-3 text-xs">
                        {ev.target_domain ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="text-body">{ev.target_app || ev.target_domain}</span>
                            {ev.target_app && ev.target_app !== ev.target_domain && (
                              <span className="font-mono text-[11px] text-subtle truncate max-w-[220px]">
                                {ev.target_domain}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-body text-xs whitespace-nowrap">{ev.operation || "—"}</td>
                      <td className="px-5 py-3 text-muted-foreground text-xs max-w-xs truncate">{ev.policy_name || "—"}</td>
                      <td className="px-5 py-3 text-xs text-muted-foreground capitalize">
                        {(ev.metadata?.detectors ?? []).map((d) => d.replace(/_/g, " ")).join(", ") || "—"}
                      </td>
                      <td className="px-5 py-3">
                        {score !== null ? (
                          <span
                            className={cn(
                              "px-2 py-0.5 rounded-md text-xs font-semibold tabular-nums border",
                              bandStyle(ev.metadata?.band)
                            )}
                          >
                            {score}
                          </span>
                        ) : (
                          <span className="text-xs text-subtle">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <span className={cn("px-2.5 py-1 rounded-full text-xs font-medium capitalize", actionStyle(ev.action))}>
                          {ev.action}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-xs text-subtle whitespace-nowrap">
                        {formatDateTime(ev.timestamp || ev.created_at || "")}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          limit={limit}
          onPageChange={setPage}
          onLimitChange={n => { setLimit(n); setPage(1); }}
        />
      </div>
    </div>
  );
}
