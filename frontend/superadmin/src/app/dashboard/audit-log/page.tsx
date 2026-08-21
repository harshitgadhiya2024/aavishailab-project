"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { auditApi } from "@/lib/api";
import { ClipboardList } from "lucide-react";
import { formatDateTime, cn } from "@/lib/utils";
import { Pagination } from "@/components/ui/Pagination";

const ACTION_COLORS: Record<string, string> = {
  create: "bg-green-500/10 text-green-400",
  update: "bg-brand-500/10 text-brand-500",
  delete: "bg-red-500/10 text-red-400",
  deactivate: "bg-red-500/10 text-red-400",
  rollback: "bg-yellow-500/10 text-yellow-400",
  publish: "bg-brand-500/10 text-brand-500",
  invite: "bg-green-500/10 text-green-400",
};

const RESOURCES = [
  "organization", "agent_package", "app_catalog", "superadmin_team",
  "platform_settings", "policy", "employee", "access_request",
];

export default function AuditLogPage() {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [resource, setResource] = useState("");
  const [action, setAction] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["audit-log", page, limit, resource, action],
    queryFn: () => auditApi.list({ page, limit, resource: resource || undefined, action: action || undefined }),
  });

  const entries = data?.data?.entries ?? [];
  const total = data?.data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Audit Log</h2>
        <p className="text-sm text-muted-foreground mt-1">Every mutating action taken across the platform — who, what, and when</p>
      </div>

      <div className="bg-card rounded-xl border border-border shadow-sm">
        <div className="p-4 border-b border-border flex flex-wrap items-center gap-3">
          <select
            value={resource}
            onChange={e => { setResource(e.target.value); setPage(1); }}
            className="border border-border bg-background rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="">All resources</option>
            {RESOURCES.map(r => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}
          </select>
          <select
            value={action}
            onChange={e => { setAction(e.target.value); setPage(1); }}
            className="border border-border bg-background rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="">All actions</option>
            {["create", "update", "delete", "publish", "rollback", "invite", "deactivate"].map(a => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground text-xs uppercase tracking-wide">
                <th className="text-left px-5 py-3 font-medium">Actor</th>
                <th className="text-left px-5 py-3 font-medium">Action</th>
                <th className="text-left px-5 py-3 font-medium">Resource</th>
                <th className="text-left px-5 py-3 font-medium">Organization</th>
                <th className="text-left px-5 py-3 font-medium">IP</th>
                <th className="text-left px-5 py-3 font-medium">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                [...Array(6)].map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {[...Array(6)].map((__, j) => (
                      <td key={j} className="px-5 py-4"><div className="h-4 bg-muted rounded w-3/4" /></td>
                    ))}
                  </tr>
                ))
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-[#6B6B6B]">
                    <ClipboardList className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No audit events yet
                  </td>
                </tr>
              ) : entries.map((e: any) => (
                <tr key={e.id} className="hover:bg-muted transition-colors">
                  <td className="px-5 py-3">
                    <p className="text-foreground">{e.actor_name || e.actor_email || "Unknown"}</p>
                    {e.actor_email && e.actor_name && <p className="text-xs text-[#6B6B6B]">{e.actor_email}</p>}
                  </td>
                  <td className="px-5 py-3">
                    <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium capitalize", ACTION_COLORS[e.action] ?? "bg-muted text-muted-foreground")}>
                      {e.action}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground capitalize">{e.resource?.replace(/_/g, " ")}</td>
                  <td className="px-5 py-3 text-muted-foreground">{e.org_name || "—"}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground font-mono">{e.ip_address || "—"}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{formatDateTime(e.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Pagination page={page} totalPages={totalPages} total={total} limit={limit} onPageChange={setPage} onLimitChange={n => { setLimit(n); setPage(1); }} />
      </div>
    </div>
  );
}
