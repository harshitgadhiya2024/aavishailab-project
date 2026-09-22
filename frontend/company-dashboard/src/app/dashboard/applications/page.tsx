"use client";

import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { appControlApi, employeeApi } from "@/lib/api";
import { Search, Loader2, AppWindow, Info, Laptop } from "lucide-react";
import { cn, formatDateTime } from "@/lib/utils";
import { toast } from "sonner";
import { Pagination } from "@/components/ui/Pagination";

/**
 * Application Control, employee-first.
 *
 * The list is the software inventory — what each person actually has
 * installed, reported by their device — not a catalog of apps the platform
 * happens to know about. That distinction is the whole point: the apps a
 * company most needs to see are the ones nobody anticipated.
 *
 * The two switches are the two halves of enforcement, and they are genuinely
 * different decisions:
 *   Network block — the app's backends join the device's block list, so an
 *                   installed copy can't reach its servers. Safe default.
 *   App block     — matching processes are terminated on sight, and the
 *                   person is told why. Deliberate, and opt-in.
 */

const CATEGORY_LABELS: Record<string, string> = {
  ai_tools: "AI tools",
  file_sharing: "File sharing",
  messaging: "Messaging",
  remote_access: "Remote access",
  anonymizer: "Anonymizer",
  p2p: "Peer-to-peer",
  vpn: "VPN",
  development: "Development",
  browser: "Browser",
  other: "Other",
};

type InstalledApp = {
  id: string;
  name: string;
  version?: string;
  vendor?: string;
  install_path?: string;
  source?: string;
  category?: string;
  risk_level?: number;
  installed_at?: string | null;
  first_seen_at?: string;
  removed?: boolean;
  employee_name?: string;
  device_name?: string;
  block_network: boolean;
  block_process: boolean;
};

function riskBadge(level: number) {
  if (level >= 85) return { label: "Critical", className: "bg-red-500/10 text-danger" };
  if (level >= 65) return { label: "High", className: "bg-orange-500/10 text-warning" };
  if (level >= 40) return { label: "Medium", className: "bg-yellow-500/10 text-warning" };
  return { label: "Low", className: "bg-green-500/10 text-success" };
}

/**
 * Most platforms record no install date. Saying "first seen" when that is all
 * we know is honest; printing a fabricated install time would not be.
 */
function installedLabel(app: InstalledApp) {
  if (app.installed_at) return { text: formatDateTime(app.installed_at), exact: true };
  if (app.first_seen_at) return { text: formatDateTime(app.first_seen_at), exact: false };
  return { text: "—", exact: true };
}

function Switch({ checked, onChange, disabled, label }: {
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
        checked ? "bg-brand-500" : "bg-elevated border border-border"
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform mt-0.5",
          checked ? "translate-x-4" : "translate-x-0.5"
        )}
      />
    </button>
  );
}

export default function ApplicationsPage() {
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

  const { data: empData } = useQuery({
    queryKey: ["employees-lite"],
    queryFn: () => employeeApi.list({ limit: 500 }),
  });

  const apps: InstalledApp[] = data?.data?.data ?? [];
  const total: number = data?.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const categories: string[] = data?.data?.categories ?? [];
  const employees: any[] = empData?.data?.data ?? [];

  const controlMut = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, any> }) =>
      appControlApi.setControl(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["installed-apps"] });
      toast.success("Application control updated");
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Could not update the control"),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Application Control</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every application your employees have installed — and the switches to cut any of it off.
        </p>
      </div>

      {/* The two switches are not interchangeable, and picking the wrong one
          is the difference between "the app is useless" and "the app is
          killed". Saying so once here beats a tooltip nobody opens. */}
      <div className="rounded-xl border border-border bg-card p-4 flex items-start gap-3">
        <div className="rounded-lg bg-brand-500/10 p-2"><Info className="w-4 h-4 text-brand-500" /></div>
        <div className="text-sm">
          <p className="font-medium text-foreground">Two ways to block, and they do different things</p>
          <p className="text-muted-foreground mt-0.5">
            <strong className="text-foreground">Network block</strong> cuts the app off from its own
            servers, so an installed copy stops being useful.{" "}
            <strong className="text-foreground">App block</strong> terminates it whenever it runs and
            shows the employee a notice explaining why. A switch applies to that one employee.
          </p>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border shadow-sm">
        <div className="p-4 border-b border-border flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search application, vendor, path..."
              className="pl-9 pr-3 py-2 bg-background border border-border rounded-lg text-sm w-full text-foreground placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <select
            value={employeeId}
            onChange={e => { setEmployeeId(e.target.value); setPage(1); }}
            className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground"
          >
            <option value="">All employees</option>
            {employees.map((e: any) => (
              <option key={e.id} value={e.id}>
                {[e.first_name, e.last_name].filter(Boolean).join(" ") || e.email}
              </option>
            ))}
          </select>
          <select
            value={category}
            onChange={e => { setCategory(e.target.value); setPage(1); }}
            className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground"
          >
            <option value="">All categories</option>
            {categories.map(c => (
              <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-muted-foreground whitespace-nowrap">
            <input
              type="checkbox"
              checked={includeRemoved}
              onChange={e => { setIncludeRemoved(e.target.checked); setPage(1); }}
            />
            Show uninstalled
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-elevated text-xs uppercase text-subtle">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Employee</th>
                <th className="text-left px-4 py-3 font-medium">Application</th>
                <th className="text-left px-4 py-3 font-medium">Category</th>
                <th className="text-left px-4 py-3 font-medium">Risk</th>
                <th className="text-center px-4 py-3 font-medium">Network block</th>
                <th className="text-center px-4 py-3 font-medium">App block</th>
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
                    <p className="text-xs mt-1">
                      Devices send their software inventory shortly after the agent starts, then hourly.
                    </p>
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
                      {app.device_name && (
                        <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                          <Laptop className="w-3 h-3" /> {app.device_name}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">
                        {app.name}
                        {app.removed && (
                          <span className="ml-2 text-[11px] font-normal text-subtle">(uninstalled)</span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {[app.version, app.vendor].filter(Boolean).join(" · ") || app.install_path || app.source}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {CATEGORY_LABELS[app.category ?? ""] ?? app.category ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("px-2 py-0.5 rounded text-xs font-medium", risk.className)}>
                        {risk.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Switch
                        label={`Network block ${app.name}`}
                        checked={app.block_network}
                        disabled={pending || app.removed}
                        onChange={v => controlMut.mutate({ id: app.id, patch: { block_network: v } })}
                      />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Switch
                        label={`App block ${app.name}`}
                        checked={app.block_process}
                        disabled={pending || app.removed}
                        onChange={v => controlMut.mutate({ id: app.id, patch: { block_process: v } })}
                      />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {installed.text}
                      {!installed.exact && installed.text !== "—" && (
                        <span className="block text-[11px] text-subtle">first seen</span>
                      )}
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
