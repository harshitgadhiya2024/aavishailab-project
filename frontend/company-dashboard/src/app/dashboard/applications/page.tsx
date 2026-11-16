"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, AppWindow, Ban, Loader2, Plus, Search, ShieldAlert, Sparkles, LayoutGrid } from "lucide-react";
import { appControlApi, employeeApi, teamApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { BlockDrawer, AppIcon, type DrawerTarget } from "@/components/appcontrol/BlockDrawer";
import { ByEmployeeView } from "@/components/appcontrol/ByEmployeeView";
import { MetricCard, MetricRow } from "@/components/ui/MetricCard";
import {
  blockStatus, categoryLabel, groupInstalls, isHighRisk, riskBadge,
  type AppGroup, type AppRule, type CatalogApp, type InstalledApp,
} from "@/components/appcontrol/appGroups";

/**
 * Application Control, app-first.
 *
 * One row per application across every device, because the job is "stop this
 * app", not "find this person, then find the app". Blocking happens in one
 * panel that asks who (everyone, teams, people) and how (cut its internet,
 * close it on open), and shows what it will affect. The per-person view is
 * still there under "By employee".
 *
 * Built only on the existing endpoints: the inventory is fetched in full and
 * grouped here; rules come from /applications/rules.
 */

type Filter = "all" | "high" | "blocked" | "new";
const PAGE = 200;

async function fetchAllInstalled(): Promise<InstalledApp[]> {
  const first = await appControlApi.installed({ page: 1, limit: PAGE });
  const rows: InstalledApp[] = first.data?.data ?? [];
  const pages = Math.ceil((first.data?.total ?? rows.length) / PAGE);
  if (pages > 1) {
    const rest = await Promise.all(
      Array.from({ length: Math.min(pages, 50) - 1 }, (_, i) => appControlApi.installed({ page: i + 2, limit: PAGE })),
    );
    for (const r of rest) rows.push(...(r.data?.data ?? []));
  }
  return rows;
}

export default function ApplicationsPage() {
  const [view, setView] = useState<"apps" | "people">("apps");
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [showSystem, setShowSystem] = useState(false);
  const [drawer, setDrawer] = useState<DrawerTarget | null>(null);

  const installed = useQuery({ queryKey: ["app-control", "installed"], queryFn: fetchAllInstalled });
  const rulesQ = useQuery({ queryKey: ["app-control", "rules"], queryFn: async () => ((await appControlApi.listRules()).data?.rules ?? []) as AppRule[] });
  const catalogQ = useQuery({ queryKey: ["app-control", "catalog"], queryFn: async () => ((await appControlApi.catalog()).data?.applications ?? []) as CatalogApp[] });
  const teamsQ = useQuery({ queryKey: ["teams-lite"], queryFn: async () => ((await teamApi.list()).data?.data ?? []) as any[] });
  const empQ = useQuery({ queryKey: ["employees-lite"], queryFn: () => employeeApi.list({ limit: 500 }) });

  const employees: any[] = empQ.data?.data?.data ?? [];
  const teams: any[] = teamsQ.data ?? [];
  const teamNames = useMemo(() => new Map(teams.map(t => [t.id as string, t.name as string])), [teams]);
  const groups = useMemo(() => groupInstalls(installed.data ?? [], rulesQ.data ?? []), [installed.data, rulesQ.data]);
  const visible = useMemo(() => groups.filter(g => showSystem || !g.system), [groups, showSystem]);
  const statusOf = (g: AppGroup) => blockStatus(g, teamNames);

  const stats = useMemo(() => {
    const devices = new Set((installed.data ?? []).filter(r => !r.removed).map(r => r.device_id)).size;
    return {
      apps: visible.length,
      devices,
      high: visible.filter(g => isHighRisk(g.risk)).length,
      highOpen: visible.filter(g => isHighRisk(g.risk) && !statusOf(g).blocked),
      blocked: visible.filter(g => statusOf(g).blocked).length,
      fresh: visible.filter(g => g.isNew).length,
      hidden: groups.length - visible.length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, groups, installed.data, teamNames]);

  const categories = useMemo(() => [...new Set(visible.map(g => g.category))].sort(), [visible]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return visible.filter(g => {
      if (filter === "high" && !isHighRisk(g.risk)) return false;
      if (filter === "blocked" && !statusOf(g).blocked) return false;
      if (filter === "new" && !g.isNew) return false;
      if (category && g.category !== category) return false;
      if (!term) return true;
      const people = [...g.people.values()].join(" ");
      const devices = g.installs.map(i => i.device_name ?? "").join(" ");
      return `${g.name} ${g.vendor} ${categoryLabel(g.category)} ${people} ${devices}`.toLowerCase().includes(term);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, filter, category, search, teamNames]);

  const loading = installed.isLoading || rulesQ.isLoading;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="page-eyebrow">Policy management</p>
          <h1 className="mt-2 text-[2rem] font-normal leading-[1.1] tracking-[-0.035em] text-foreground">Application Control</h1>
          <p className="mt-1 text-sm text-muted-foreground">Every app on your company&apos;s devices, and one place to stop any of them.</p>
        </div>
        <button type="button" onClick={() => setDrawer({ kind: "catalog" })} className="inline-flex h-10 items-center gap-1.5 rounded-md border border-border bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-elevated">
          <Plus className="h-4 w-4" /> Block an app
        </button>
      </div>

      {/* Summary: each number is also a filter; the marker colour says whether it needs attention. */}
      <MetricRow>
        <MetricCard label="Apps in use" value={stats.apps} detail={`on ${stats.devices} device${stats.devices === 1 ? "" : "s"}`} icon={LayoutGrid} onClick={() => setFilter("all")} />
        <MetricCard label="High risk" value={stats.high} detail={stats.high === 0 ? "none found" : stats.highOpen.length ? `${stats.highOpen.length} not blocked` : "all blocked"} icon={ShieldAlert} tone={stats.highOpen.length ? "bad" : "good"} selected={filter === "high"} onClick={() => setFilter(filter === "high" ? "all" : "high")} />
        <MetricCard label="Blocked" value={stats.blocked} detail={stats.blocked ? "apps with a block" : "none yet"} icon={Ban} tone={stats.blocked ? "good" : "neutral"} selected={filter === "blocked"} onClick={() => setFilter(filter === "blocked" ? "all" : "blocked")} />
        <MetricCard label="New apps" value={stats.fresh} detail="first seen this week" icon={Sparkles} tone={stats.fresh ? "brand" : "neutral"} selected={filter === "new"} onClick={() => setFilter(filter === "new" ? "all" : "new")} />
      </MetricRow>

      {stats.highOpen.length > 0 && view === "apps" && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-yellow-500/30 bg-yellow-500/[0.07] px-4 py-3 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
          <p className="min-w-0 flex-1 text-foreground">
            {stats.highOpen.length} high-risk app{stats.highOpen.length === 1 ? " isn't" : "s aren't"} blocked:{" "}
            <span className="text-muted-foreground">{stats.highOpen.slice(0, 3).map(g => g.name).join(", ")}{stats.highOpen.length > 3 ? ` and ${stats.highOpen.length - 3} more` : ""}</span>
          </p>
          <button type="button" onClick={() => (stats.highOpen.length === 1 ? setDrawer({ kind: "group", group: stats.highOpen[0] }) : setFilter("high"))} className="inline-flex h-8 items-center rounded-md border border-border bg-card px-3 text-xs font-medium text-foreground hover:bg-elevated">
            Review and block
          </button>
        </div>
      )}

      {view === "people" ? (
        <ByEmployeeView employees={employees} viewSwitch={<ViewSwitch view={view} onChange={setView} />} />
      ) : (
        <div className="rounded-xl border border-border bg-card shadow-sm">
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
            <ViewSwitch view={view} onChange={setView} />
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search app, vendor, person or device" className="h-8 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-[13px] text-foreground placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
              <div role="radiogroup" aria-label="Filter apps" className="inline-flex h-8 items-center rounded-lg border border-border bg-elevated p-0.5">
                {([["all", "All", stats.apps], ["high", "High risk", stats.high], ["blocked", "Blocked", stats.blocked], ["new", "New", stats.fresh]] as [Filter, string, number][]).map(([f, label, n]) => (
                  <button key={f} role="radio" aria-checked={filter === f} type="button" onClick={() => setFilter(f)}
                    className={cn("inline-flex h-full items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors", filter === f ? "bg-card font-medium text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground")}>
                    {f === "high" && <span className={cn("h-1.5 w-1.5 rounded-full", n ? "bg-danger" : "bg-faint")} />}
                    {label}
                    <span className={cn("font-mono text-[10.5px] tabular-nums", filter === f ? "text-brand-600" : "text-faint")}>{n}</span>
                  </button>
                ))}
              </div>
              <span className="mx-1 hidden h-5 w-px bg-border sm:block" />
              <select value={category} onChange={e => setCategory(e.target.value)} className="h-8 rounded-lg border border-border bg-background px-2 text-xs text-foreground">
                <option value="">All categories</option>
                {categories.map(c => <option key={c} value={c}>{categoryLabel(c)}</option>)}
              </select>
              <label className="flex h-8 items-center gap-1.5 whitespace-nowrap px-1 text-xs text-muted-foreground" title="Operating-system and driver software, like Photos or graphics drivers">
                <input type="checkbox" checked={showSystem} onChange={e => setShowSystem(e.target.checked)} />
                System apps{stats.hidden > 0 && !showSystem ? ` (${stats.hidden})` : ""}
              </label>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-elevated text-xs uppercase text-subtle">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Application</th>
                  <th className="px-4 py-3 text-left font-medium">Risk</th>
                  <th className="px-4 py-3 text-left font-medium">Installed on</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading ? (
                  <tr><td colSpan={5} className="py-14 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-subtle" /></td></tr>
                ) : groups.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-14 text-center text-subtle">
                      <AppWindow className="mx-auto mb-2 h-8 w-8 opacity-30" />
                      <p>No applications reported yet</p>
                      <p className="mt-1 text-xs">Devices send their software list shortly after the agent starts, then every hour. You can still block apps in advance with Block an app.</p>
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={5} className="py-12 text-center text-sm text-muted-foreground">No apps match. Try another filter or clear the search.</td></tr>
                ) : rows.map(g => {
                  const r = riskBadge(g.risk);
                  const st = statusOf(g);
                  const people = [...g.people.values()];
                  return (
                    <tr key={g.key} onClick={() => setDrawer({ kind: "group", group: g })} className="cursor-pointer hover:bg-elevated/60">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <AppIcon name={g.name} />
                          <div className="min-w-0">
                            <p className="flex items-center gap-2 font-medium text-foreground">
                              <span className="truncate">{g.name}</span>
                              {g.isNew && <span className="rounded bg-brand-500/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-brand-700 dark:text-brand-300">New</span>}
                              {g.system && <span className="rounded bg-elevated px-1.5 py-0.5 text-[10px] text-subtle">System</span>}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">{categoryLabel(g.category)}{g.vendor ? ` · ${g.vendor}` : ""}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3"><span className={cn("rounded px-2 py-0.5 text-xs font-medium", r.className)}>{r.label}</span></td>
                      <td className="px-4 py-3">
                        <p className="text-foreground">{people.length} {people.length === 1 ? "person" : "people"} · {g.devices} device{g.devices === 1 ? "" : "s"}</p>
                        <p className="max-w-[260px] truncate text-xs text-subtle">{people.slice(0, 3).join(", ")}{people.length > 3 ? ` +${people.length - 3}` : ""}</p>
                      </td>
                      <td className="px-4 py-3">
                        {st.blocked ? (
                          <>
                            <p className="flex items-center gap-1.5 whitespace-nowrap font-medium text-danger"><Ban className="h-3.5 w-3.5" />Blocked</p>
                            <p className="whitespace-nowrap text-xs text-muted-foreground">{st.who}</p>
                            {st.how && <p className="whitespace-nowrap text-[11px] text-subtle">{st.how}</p>}
                          </>
                        ) : (
                          <p className="text-muted-foreground">Allowed</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button type="button" onClick={e => { e.stopPropagation(); setDrawer({ kind: "group", group: g }); }} className={cn("inline-flex h-8 items-center gap-1 rounded-md px-3 text-xs font-medium transition-colors", st.blocked ? "border border-border text-foreground hover:bg-elevated" : "border border-red-500/40 text-danger hover:bg-red-500/10")}>
                          {st.blocked ? "Edit" : <><Ban className="h-3.5 w-3.5" />Block</>}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!loading && rows.length > 0 && (
            <p className="border-t border-border px-4 py-2.5 text-xs text-subtle">
              {rows.length} of {visible.length} apps{!showSystem && stats.hidden > 0 ? ` · ${stats.hidden} system apps hidden` : ""} · click an app to see who has it
            </p>
          )}
        </div>
      )}

      {drawer && (
        <BlockDrawer
          target={drawer.kind === "group" ? { kind: "group", group: groups.find(g => g.key === drawer.group.key) ?? drawer.group } : drawer}
          catalog={catalogQ.data ?? []}
          teams={teams}
          employees={employees}
          onClose={() => setDrawer(null)}
        />
      )}
    </div>
  );
}

/** "By app | By employee", at the start of the table's toolbar. */
function ViewSwitch({ view, onChange }: { view: "apps" | "people"; onChange: (v: "apps" | "people") => void }) {
  return (
    <div role="tablist" className="inline-flex h-8 shrink-0 items-center rounded-lg border border-border bg-elevated p-0.5">
      {([["apps", "By app"], ["people", "By employee"]] as const).map(([v, label]) => (
        <button key={v} role="tab" aria-selected={view === v} type="button" onClick={() => onChange(v)}
          className={cn("h-full rounded-md px-3 text-xs transition-colors", view === v ? "bg-card font-medium text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground")}>
          {label}
        </button>
      ))}
    </div>
  );
}
