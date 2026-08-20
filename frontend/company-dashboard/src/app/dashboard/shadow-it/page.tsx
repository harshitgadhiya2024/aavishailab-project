"use client";

import { useMemo, useState } from "react";
import { Pagination } from "@/components/ui/Pagination";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { shadowItApi } from "@/lib/api";
import { Cloud, ShieldCheck, ShieldX, RotateCcw, AlertTriangle, Users, Activity } from "lucide-react";
import { formatDateTime, cn } from "@/lib/utils";
import { toast } from "sonner";

type App = {
  domain: string;
  app_name: string;
  category: string;
  risk_score: number;
  matched: boolean;
  events: number;
  users: number;
  first_seen?: string;
  last_seen?: string;
  status: "sanctioned" | "blocked" | "unreviewed";
};

function riskStyle(score: number) {
  if (score >= 60) return "bg-red-500/10 text-danger border-red-500/20";
  if (score >= 40) return "bg-yellow-500/10 text-warning border-yellow-500/20";
  if (score > 0) return "bg-blue-500/10 text-info border-blue-500/20";
  return "bg-elevated text-subtle border-border";
}

function statusStyle(s: string) {
  if (s === "sanctioned") return "bg-emerald-500/10 text-success";
  if (s === "blocked") return "bg-red-500/10 text-danger";
  return "bg-elevated text-muted-foreground";
}

export default function ShadowITPage() {
  const qc = useQueryClient();
  const [knownOnly, setKnownOnly] = useState(true);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);

  const { data, isLoading } = useQuery({
    queryKey: ["shadow-it", knownOnly],
    queryFn: () => shadowItApi.apps({ known_only: knownOnly }),
    refetchInterval: 60_000,
  });

  const sanction = useMutation({
    mutationFn: (v: { domain: string; action: "sanction" | "unsanction" | "unreviewed" }) =>
      shadowItApi.sanction(v),
    onSuccess: (_res, vars) => {
      const label = vars.action === "sanction" ? "sanctioned" : vars.action === "unsanction" ? "blocked" : "reset";
      toast.success(`${vars.domain} ${label}`);
      qc.invalidateQueries({ queryKey: ["shadow-it"] });
    },
    onError: () => toast.error("Could not update Shadow IT status"),
  });

  const apps: App[] = Array.isArray(data?.data?.apps) ? data.data.apps : [];
  const pagedApps = useMemo(
    () => apps.slice((page - 1) * limit, page * limit),
    [apps, page]
  );

  const stats = useMemo(() => {
    const highRisk = apps.filter((a) => a.risk_score >= 60).length;
    const unreviewed = apps.filter((a) => a.status === "unreviewed").length;
    const users = apps.reduce((m, a) => Math.max(m, a.users), 0);
    return { total: apps.length, highRisk, unreviewed, users };
  }, [apps]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Shadow IT Discovery</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Cloud &amp; SaaS apps your employees actually use — discovered from real traffic, scored by risk
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
          <input type="checkbox" checked={knownOnly} onChange={(e) => setKnownOnly(e.target.checked)} className="accent-brand-500" />
          Known apps only
        </label>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Apps Discovered", value: stats.total, color: "bg-brand-500/10 text-brand-500", icon: Cloud },
          { label: "High Risk", value: stats.highRisk, color: "bg-red-500/10 text-danger", icon: AlertTriangle },
          { label: "Unreviewed", value: stats.unreviewed, color: "bg-yellow-500/10 text-warning", icon: Activity },
          { label: "Peak Users / App", value: stats.users, color: "bg-purple-500/10 text-accent-purple", icon: Users },
        ].map((s) => (
          <div key={s.label} className="bg-card rounded-xl p-4 border border-border flex items-center gap-3">
            <div className={`p-2 rounded-lg ${s.color}`}><s.icon className="w-4 h-4" /></div>
            <div>
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-xl font-bold text-foreground">{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-card rounded-xl border border-border shadow-sm">
        <div className="p-4 border-b border-border">
          <h3 className="font-semibold text-foreground">Discovered Applications</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Sanction to allow, block to stop, or leave for review — decisions push to every device</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3 text-left font-medium">Application</th>
                <th className="px-5 py-3 text-left font-medium">Category</th>
                <th className="px-5 py-3 text-left font-medium">Risk</th>
                <th className="px-5 py-3 text-left font-medium">Users</th>
                <th className="px-5 py-3 text-left font-medium">Requests</th>
                <th className="px-5 py-3 text-left font-medium">Last Seen</th>
                <th className="px-5 py-3 text-left font-medium">Status</th>
                <th className="px-5 py-3 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-elevated">
              {isLoading ? (
                [...Array(6)].map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {[...Array(8)].map((__, j) => <td key={j} className="px-5 py-4"><div className="h-4 bg-elevated rounded w-3/4" /></td>)}
                  </tr>
                ))
              ) : apps.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-subtle">
                    <Cloud className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No apps discovered yet — traffic from enrolled devices will populate this.
                  </td>
                </tr>
              ) : (
                pagedApps.map((a) => (
                  <tr key={a.domain} className="hover:bg-elevated">
                    <td className="px-5 py-3">
                      <div className="text-foreground font-medium">{a.app_name}</div>
                      <div className="text-xs text-subtle font-mono">{a.domain}</div>
                    </td>
                    <td className="px-5 py-3 text-xs text-muted-foreground capitalize">{a.category.replace(/_/g, " ")}</td>
                    <td className="px-5 py-3">
                      <span className={cn("px-2 py-0.5 rounded-md text-xs font-semibold tabular-nums border", riskStyle(a.risk_score))}>
                        {a.risk_score || "—"}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-body tabular-nums">{a.users}</td>
                    <td className="px-5 py-3 text-muted-foreground tabular-nums">{a.events}</td>
                    <td className="px-5 py-3 text-xs text-subtle whitespace-nowrap">{a.last_seen ? formatDateTime(a.last_seen) : "—"}</td>
                    <td className="px-5 py-3">
                      <span className={cn("px-2.5 py-1 rounded-full text-xs font-medium capitalize", statusStyle(a.status))}>{a.status}</span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          title="Sanction (allow)"
                          onClick={() => sanction.mutate({ domain: a.domain, action: "sanction" })}
                          className="p-1.5 rounded-md text-success hover:bg-emerald-500/10"
                        >
                          <ShieldCheck className="w-4 h-4" />
                        </button>
                        <button
                          title="Block"
                          onClick={() => sanction.mutate({ domain: a.domain, action: "unsanction" })}
                          className="p-1.5 rounded-md text-danger hover:bg-red-500/10"
                        >
                          <ShieldX className="w-4 h-4" />
                        </button>
                        {a.status !== "unreviewed" && (
                          <button
                            title="Reset to unreviewed"
                            onClick={() => sanction.mutate({ domain: a.domain, action: "unreviewed" })}
                            className="p-1.5 rounded-md text-muted-foreground hover:bg-muted"
                          >
                            <RotateCcw className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <Pagination
          page={page}
          totalPages={Math.ceil(apps.length / limit)}
          total={apps.length}
          limit={limit}
          onPageChange={setPage}
          onLimitChange={n => { setLimit(n); setPage(1); }}
        />
      </div>
    </div>
  );
}
