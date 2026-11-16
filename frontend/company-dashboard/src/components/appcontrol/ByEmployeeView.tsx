"use client";

import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Loader2, AppWindow, Laptop } from "lucide-react";
import { toast } from "sonner";
import { appControlApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Pagination } from "@/components/ui/Pagination";
import { CATEGORY_LABELS, installedLabel, riskBadge, type InstalledApp } from "./appGroups";

/**
 * The per-person view: what one employee has installed, with the two
 * enforcement switches on each row. Kept from the original page for the
 * "what does this person have?" question; blocking for many people at once
 * happens in the By app view.
 */

export function Switch({ checked, onChange, disabled, label }: {
  checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 flex-shrink-0 rounded-full transition-colors disabled:opacity-50",
        checked ? "bg-brand-500" : "bg-elevated border border-border",
      )}
    >
      <span className={cn("inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform mt-0.5", checked ? "translate-x-4" : "translate-x-0.5")} />
    </button>
  );
}

export function ByEmployeeView({ employees, viewSwitch }: { employees: any[]; viewSwitch?: React.ReactNode }) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [includeRemoved, setIncludeRemoved] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["installed-apps", page, limit, search, category, employeeId, includeRemoved],
    queryFn: () => appControlApi.installed({
      page, limit,
      search: search || undefined,
      category: category || undefined,
      employee_id: employeeId || undefined,
      include_removed: includeRemoved || undefined,
    }),
    placeholderData: keepPreviousData,
  });

  const apps: InstalledApp[] = data?.data?.data ?? [];
  const total: number = data?.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const categories: string[] = data?.data?.categories ?? [];

  const controlMut = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, any> }) => appControlApi.setControl(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["installed-apps"] });
      qc.invalidateQueries({ queryKey: ["app-control"] });
      toast.success("Application control updated");
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Could not update the control"),
  });

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        {viewSwitch}
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search app, vendor or path"
            className="h-8 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-[13px] text-foreground placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <select value={employeeId} onChange={e => { setEmployeeId(e.target.value); setPage(1); }} className="h-8 rounded-lg border border-border bg-background px-2 text-xs text-foreground">
            <option value="">All employees</option>
            {employees.map((e: any) => (
              <option key={e.id} value={e.id}>{[e.first_name, e.last_name].filter(Boolean).join(" ") || e.email}</option>
            ))}
          </select>
          <select value={category} onChange={e => { setCategory(e.target.value); setPage(1); }} className="h-8 rounded-lg border border-border bg-background px-2 text-xs text-foreground">
            <option value="">All categories</option>
            {categories.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>)}
          </select>
          <label className="flex h-8 items-center gap-1.5 whitespace-nowrap px-1 text-xs text-muted-foreground">
            <input type="checkbox" checked={includeRemoved} onChange={e => { setIncludeRemoved(e.target.checked); setPage(1); }} />
            Show uninstalled
          </label>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-elevated text-xs uppercase text-subtle">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Employee</th>
              <th className="text-left px-4 py-3 font-medium">Application</th>
              <th className="text-left px-4 py-3 font-medium">Category</th>
              <th className="text-left px-4 py-3 font-medium">Risk</th>
              <th className="text-center px-4 py-3 font-medium">Cut internet</th>
              <th className="text-center px-4 py-3 font-medium">Close app</th>
              <th className="text-left px-4 py-3 font-medium">Installed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              <tr><td colSpan={7} className="text-center py-12"><Loader2 className="w-5 h-5 animate-spin mx-auto text-subtle" /></td></tr>
            ) : apps.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-12 text-subtle">
                  <AppWindow className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p>No applications reported yet</p>
                  <p className="text-xs mt-1">Devices send their software inventory shortly after the agent starts, then hourly.</p>
                </td>
              </tr>
            ) : apps.map(app => {
              const risk = riskBadge(app.risk_level ?? 0);
              const installed = installedLabel(app);
              const pending = controlMut.isPending && controlMut.variables?.id === app.id;
              return (
                <tr key={app.id} className={cn("hover:bg-elevated/60", app.removed && "opacity-55")}>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <p className="text-foreground">{app.employee_name || "—"}</p>
                    {app.device_name && <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1"><Laptop className="w-3 h-3" /> {app.device_name}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-foreground">
                      {app.name}
                      {app.removed && <span className="ml-2 text-[11px] font-normal text-subtle">(uninstalled)</span>}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">{[app.version, app.vendor].filter(Boolean).join(" · ") || app.install_path || app.source}</p>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{CATEGORY_LABELS[app.category ?? ""] ?? app.category ?? "—"}</td>
                  <td className="px-4 py-3"><span className={cn("px-2 py-0.5 rounded text-xs font-medium", risk.className)}>{risk.label}</span></td>
                  <td className="px-4 py-3 text-center">
                    <Switch label={`Cut off internet for ${app.name}`} checked={app.block_network} disabled={pending || app.removed} onChange={v => controlMut.mutate({ id: app.id, patch: { block_network: v } })} />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Switch label={`Close ${app.name} when it opens`} checked={app.block_process} disabled={pending || app.removed} onChange={v => controlMut.mutate({ id: app.id, patch: { block_process: v } })} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                    {installed.text}
                    {!installed.exact && installed.text !== "—" && <span className="block text-[11px] text-subtle">first seen</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={totalPages} total={total} limit={limit} onPageChange={setPage} onLimitChange={l => { setLimit(l); setPage(1); }} />
    </div>
  );
}
