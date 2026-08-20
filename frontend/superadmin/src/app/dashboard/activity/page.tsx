"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createApiClient } from "@/lib/api";
import { Activity, Search, Filter, Shield, AlertTriangle, Info } from "lucide-react";
import { formatDateTime, cn } from "@/lib/utils";
import { Pagination } from "@/components/ui/Pagination";

const ACTION_COLORS: Record<string, string> = {
  blocked: "bg-red-500/10 text-red-400",
  alerted: "bg-yellow-500/10 text-yellow-400",
  allowed: "bg-green-500/10 text-green-400",
  monitored: "bg-brand-500/10 text-brand-500",
};

const TYPE_ICONS: Record<string, React.ElementType> = {
  web_access: Activity,
  dns_query: Shield,
  policy_violation: AlertTriangle,
  login: Info,
};


const RANGES = [
  { label: "24h", days: 1 },
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
];

export default function GlobalActivityPage() {
  const api = createApiClient();
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("");
  const [days, setDays] = useState(7);
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

  const { data, isLoading } = useQuery({
    queryKey: ["global-activity", page, limit, debouncedSearch, action, days],
    queryFn: () =>
      api.get("/api/v1/activity", {
        params: {
          page,
          limit,
          days,
          search: debouncedSearch || undefined,
          action: action || undefined,
        },
      }),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  // The list lives under `data`, matching every other paginated endpoint.
  const events = data?.data?.data ?? [];
  const total = data?.data?.total ?? 0;
  const totalPages = data?.data?.pages ?? 1;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Global Activity</h2>
        <p className="text-sm text-muted-foreground mt-1">Security events across all organizations</p>
      </div>

      {/* Filters */}
      <div className="bg-card rounded-xl border border-border shadow-sm">
        <div className="p-4 border-b border-border flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search events..."
              className="pl-9 pr-3 py-2 border border-border bg-background rounded-lg text-sm w-full focus:outline-none focus:ring-2 focus:ring-brand-500"
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
          <select
            value={action}
            onChange={e => { setAction(e.target.value); setPage(1); }}
            className="border border-border bg-background rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="">All Actions</option>
            <option value="blocked">Blocked</option>
            <option value="alerted">Alerted</option>
            <option value="allowed">Allowed</option>
            <option value="monitored">Monitored</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground text-xs uppercase tracking-wide">
                <th className="text-left px-5 py-3 font-medium">Event</th>
                <th className="text-left px-5 py-3 font-medium">Type</th>
                <th className="text-left px-5 py-3 font-medium">Action</th>
                <th className="text-left px-5 py-3 font-medium">Risk</th>
                <th className="text-left px-5 py-3 font-medium">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                [...Array(8)].map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {[...Array(5)].map((__, j) => (
                      <td key={j} className="px-5 py-4">
                        <div className="h-4 bg-muted rounded w-3/4" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : events.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-12 text-[#6B6B6B]">
                    <Activity className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No events found
                  </td>
                </tr>
              ) : (
                events.map((ev: any) => {
                  const Icon = TYPE_ICONS[ev.event_type] ?? Activity;
                  return (
                    <tr key={ev.id} className="hover:bg-muted transition-colors">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                          <span className="font-medium text-foreground truncate max-w-[200px]">
                            {ev.resource_url || ev.description || "—"}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-muted-foreground capitalize">{(ev.event_type ?? "").replace(/_/g, " ")}</td>
                      <td className="px-5 py-4">
                        <span className={cn("px-2.5 py-1 rounded-full text-xs font-medium", ACTION_COLORS[ev.action] ?? "bg-muted text-muted-foreground")}>
                          {ev.action}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className={cn("h-full rounded-full", ev.risk_score > 70 ? "bg-red-500" : ev.risk_score > 40 ? "bg-yellow-500" : "bg-green-500")}
                              style={{ width: `${ev.risk_score ?? 0}%` }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground">{ev.risk_score ?? 0}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-[#6B6B6B] text-xs">{formatDateTime(ev.created_at)}</td>
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
