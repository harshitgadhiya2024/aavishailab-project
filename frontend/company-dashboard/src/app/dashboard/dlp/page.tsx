"use client";

import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { activityApi } from "@/lib/api";
import { FileWarning, ShieldCheck, Loader2, Search, AppWindow, Globe, FileUp, Type } from "lucide-react";
import { formatDateTime, cn } from "@/lib/utils";
import { Pagination } from "@/components/ui/Pagination";

/**
 * Data Loss Prevention — a log, and only a log.
 *
 * DLP runs for every company with no configuration: SSL inspection is on, the
 * built-in detector set is on, and nothing here can be switched off or tuned,
 * which is why this page has no policy builder and no settings. It also never
 * blocks: an employee sending something sensitive is recorded and allowed
 * through, and this table is where the company sees what went out.
 */

type DLPEvent = {
  id: string;
  action: string;
  target?: string;
  target_domain?: string;
  policy_name?: string;
  risk_score?: number;
  timestamp?: string;
  created_at?: string;
  metadata?: {
    detectors?: string[];
    matches?: string[];
    score?: number;
    band?: string;
    request_source?: string;
    destination?: string;
    content_kind?: string;
  };
  employee?: { first_name?: string; last_name?: string; email?: string } | null;
};

function employeeName(e: DLPEvent["employee"]) {
  if (!e) return "—";
  const name = [e.first_name, e.last_name].filter(Boolean).join(" ").trim();
  return name || e.email || "—";
}

/**
 * "app" or "browser". Older rows predate the field being captured, so they
 * fall back to "—" rather than guessing — a wrong label here would be worse
 * than an honest blank.
 */
function requestSource(ev: DLPEvent) {
  const src = ev.metadata?.request_source;
  if (src === "app") return { label: "App", icon: AppWindow };
  if (src === "browser") return { label: "Browser", icon: Globe };
  return null;
}

function contentKind(ev: DLPEvent) {
  const kind = ev.metadata?.content_kind;
  if (kind === "file-upload") return { label: "File upload", icon: FileUp };
  if (kind === "text") return { label: "Text", icon: Type };
  return null;
}

/** What was found, in words — the detector names are the reason. */
function reasonText(ev: DLPEvent) {
  const detectors = ev.metadata?.detectors ?? [];
  if (detectors.length > 0) return detectors.join(", ");
  return ev.policy_name || "Sensitive content detected";
}

function riskStyle(score: number) {
  if (score >= 80) return "bg-red-500/10 text-danger";
  if (score >= 50) return "bg-yellow-500/10 text-warning";
  return "bg-emerald-500/10 text-success";
}

export default function DLPPage() {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [search, setSearch] = useState("");
  const [days, setDays] = useState(30);

  const { data, isLoading } = useQuery({
    queryKey: ["dlp-logs", page, limit, search, days],
    queryFn: () =>
      activityApi.list({
        source: "dlp",
        page,
        limit,
        days,
        search: search || undefined,
      }),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });

  const events: DLPEvent[] = data?.data?.data ?? [];
  const total: number = data?.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Data Loss Prevention</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Everything sensitive that left the company — from a browser tab or a desktop app.
        </p>
      </div>

      {/* There is nothing to configure here on purpose, and saying so is
          better than leaving an admin hunting for the settings. */}
      <div className="rounded-xl border border-border bg-card p-4 flex items-start gap-3">
        <div className="rounded-lg bg-emerald-500/10 p-2">
          <ShieldCheck className="w-4 h-4 text-success" />
        </div>
        <div className="text-sm">
          <p className="font-medium text-foreground">DLP is on for your whole company</p>
          <p className="text-muted-foreground mt-0.5">
            SSL inspection and the full detector set — access tokens, API keys, source code,
            payment and identity numbers, and AI classification of documents and images — run on
            every upload with no setup. Nothing is ever blocked: uploads go through and are
            recorded here.
          </p>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border shadow-sm">
        <div className="p-4 border-b border-border flex flex-wrap gap-3 items-center">
          <h2 className="font-semibold text-foreground mr-auto">Incidents</h2>
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search destination, file..."
              className="pl-9 pr-3 py-2 bg-background border border-border rounded-lg text-sm w-full text-foreground placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <select
            value={days}
            onChange={e => { setDays(Number(e.target.value)); setPage(1); }}
            className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={365}>Last year</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-elevated text-xs uppercase text-subtle">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Employee</th>
                <th className="text-left px-4 py-3 font-medium">Request</th>
                <th className="text-left px-4 py-3 font-medium">Destination</th>
                <th className="text-left px-4 py-3 font-medium">Category</th>
                <th className="text-left px-4 py-3 font-medium">Reason</th>
                <th className="text-left px-4 py-3 font-medium">Risk</th>
                <th className="text-left px-4 py-3 font-medium">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr><td colSpan={7} className="text-center py-12"><Loader2 className="w-5 h-5 animate-spin mx-auto text-subtle" /></td></tr>
              ) : events.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-subtle">
                    <FileWarning className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No sensitive data has left the company in this period
                  </td>
                </tr>
              ) : events.map(ev => {
                const src = requestSource(ev);
                const kind = contentKind(ev);
                const score = Math.round(ev.risk_score ?? ev.metadata?.score ?? 0);
                return (
                  <tr key={ev.id} className="hover:bg-elevated/60 align-top">
                    <td className="px-4 py-3 text-foreground whitespace-nowrap">{employeeName(ev.employee)}</td>
                    <td className="px-4 py-3">
                      {src ? (
                        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                          <src.icon className="w-3.5 h-3.5" /> {src.label}
                        </span>
                      ) : <span className="text-subtle">—</span>}
                    </td>
                    <td className="px-4 py-3 text-foreground">
                      {ev.metadata?.destination || ev.target_domain || "—"}
                      {ev.target && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[220px]" title={ev.target}>
                          {ev.target}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {kind ? (
                        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                          <kind.icon className="w-3.5 h-3.5" /> {kind.label}
                        </span>
                      ) : <span className="text-subtle">—</span>}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground max-w-[260px]">
                      <span className="block truncate" title={reasonText(ev)}>{reasonText(ev)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("px-2 py-0.5 rounded text-xs font-medium tabular-nums", riskStyle(score))}>
                        {score}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {formatDateTime(ev.timestamp || ev.created_at || "")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          limit={limit}
          onPageChange={setPage}
          onLimitChange={l => { setLimit(l); setPage(1); }}
        />
      </div>
    </div>
  );
}
