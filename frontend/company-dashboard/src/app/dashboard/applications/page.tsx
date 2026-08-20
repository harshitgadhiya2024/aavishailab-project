"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { appControlApi } from "@/lib/api";
import {
  Search, Loader2, AppWindow, Globe, Cpu, X, Plus, Trash2,
  ShieldAlert, CheckCircle2, Info, Ban,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Pagination } from "@/components/ui/Pagination";

const CATEGORY_LABELS: Record<string, string> = {
  ai_tools: "AI tools",
  file_sharing: "File sharing",
  messaging: "Messaging",
  remote_access: "Remote access",
  anonymizer: "Anonymizer",
  p2p: "Peer-to-peer",
  vpn: "VPN",
  other: "Other",
};

function riskBadge(level: number) {
  if (level >= 85) return { label: "Critical", className: "bg-red-500/10 text-danger" };
  if (level >= 65) return { label: "High", className: "bg-orange-500/10 text-warning" };
  if (level >= 40) return { label: "Medium", className: "bg-yellow-500/10 text-warning" };
  return { label: "Low", className: "bg-green-500/10 text-success" };
}

export default function ApplicationsPage() {
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [onlyControlled, setOnlyControlled] = useState(false);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [detail, setDetail] = useState<any>(null);
  const [showCustom, setShowCustom] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["app-catalog"],
    queryFn: () => appControlApi.catalog(),
  });
  const { data: eventsData } = useQuery({
    queryKey: ["app-control-events"],
    queryFn: () => appControlApi.events(),
    refetchInterval: 30_000,
  });

  const apps: any[] = data?.data?.applications ?? [];
  const categories: string[] = data?.data?.categories ?? [];
  const events: any[] = eventsData?.data?.events ?? [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["app-catalog"] });
    qc.invalidateQueries({ queryKey: ["app-control-events"] });
  };

  const controlMut = useMutation({
    mutationFn: (vars: { application_id: string; block_network?: boolean; block_process?: boolean; action?: string }) =>
      appControlApi.createRule(vars),
    onSuccess: () => { invalidate(); toast.success("Application control updated"); },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Could not update control"),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, any> }) =>
      appControlApi.updateRule(id, patch),
    onSuccess: () => { invalidate(); toast.success("Application control updated"); },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Could not update control"),
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => appControlApi.deleteRule(id),
    onSuccess: () => { invalidate(); toast.success("Application is no longer controlled"); },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Could not remove control"),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return apps.filter(a => {
      if (category && a.category !== category) return false;
      if (onlyControlled && !a.rule?.enabled) return false;
      if (!q) return true;
      return (
        a.name?.toLowerCase().includes(q) ||
        a.vendor?.toLowerCase().includes(q) ||
        (a.domains ?? []).some((d: string) => d.includes(q))
      );
    });
  }, [apps, search, category, onlyControlled]);

  const paged = filtered.slice((page - 1) * limit, page * limit);
  const controlledCount = apps.filter(a => a.rule?.enabled).length;
  const processCount = apps.filter(a => a.rule?.enabled && a.rule?.block_process).length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Application Control</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Block software, not just websites — cut an app off from every backend it uses, and
            optionally stop it from running at all.
          </p>
        </div>
        <button
          onClick={() => setShowCustom(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground hover:bg-brand-600"
        >
          <Plus className="w-4 h-4" /> Add application
        </button>
      </div>

      {/* How it works — the two halves are not obvious, and picking the wrong
          one is the difference between "app is useless" and "app is killed". */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex gap-3">
          <Info className="w-4 h-4 text-brand-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-muted-foreground space-y-1.5">
            <p>
              <span className="text-body font-medium">Network block</span> pushes every domain the
              app's backend uses to each device — so an already-installed copy can't sign in, sync
              or send anything. This is what makes blocking effective; blocking just the marketing
              site leaves the desktop client working.
            </p>
            <p>
              <span className="text-body font-medium">Process block</span> additionally terminates
              the app whenever it is found running, and records who launched it. It stops the app
              from being usable, but a renamed binary can evade the name match — true
              prevent-on-launch needs OS-level control (macOS Endpoint Security, Windows WDAC).
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard icon={AppWindow} label="Applications in catalog" value={apps.length} />
        <StatCard icon={Globe} label="Controlled" value={controlledCount} />
        <StatCard icon={Cpu} label="With process blocking" value={processCount} />
      </div>

      <div className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center gap-3 p-4 border-b border-border">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search applications or domains..."
              className="w-full rounded-lg border border-border bg-background pl-9 pr-3 py-2 text-sm outline-none focus:border-brand-500"
            />
          </div>
          <select
            value={category}
            onChange={e => { setCategory(e.target.value); setPage(1); }}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand-500"
          >
            <option value="">All categories</option>
            {categories.map(c => (
              <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={onlyControlled}
              onChange={e => { setOnlyControlled(e.target.checked); setPage(1); }}
              className="w-3.5 h-3.5 rounded border-border accent-brand-500"
            />
            Controlled only
          </label>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            No applications match this filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-subtle">
                  <th className="px-4 py-3 font-medium">Application</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Risk</th>
                  <th className="px-4 py-3 font-medium">Domains</th>
                  <th className="px-4 py-3 font-medium">Network block</th>
                  <th className="px-4 py-3 font-medium">Process block</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paged.map(app => {
                  const rule = app.rule;
                  const risk = riskBadge(app.risk_level ?? 50);
                  const canProcess = (app.process_names?.length ?? 0) > 0
                    || (app.bundle_ids?.length ?? 0) > 0
                    || (app.path_patterns?.length ?? 0) > 0;
                  return (
                    <tr key={app.id} className="border-b border-border/60 last:border-0 hover:bg-elevated/40">
                      <td className="px-4 py-3">
                        <div className="font-medium text-body">{app.name}</div>
                        <div className="text-xs text-subtle">{app.vendor || "—"}</div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {CATEGORY_LABELS[app.category] ?? app.category}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", risk.className)}>
                          {risk.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => setDetail(app)}
                          className="text-brand-500 hover:text-brand-400 text-xs"
                        >
                          {app.domains?.length ?? 0} domain{(app.domains?.length ?? 0) === 1 ? "" : "s"}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <Toggle
                          on={!!rule?.enabled && !!rule?.block_network}
                          onChange={next => {
                            if (rule) {
                              updateMut.mutate({ id: rule.id, patch: { block_network: next, enabled: next || rule.block_process } });
                            } else if (next) {
                              controlMut.mutate({ application_id: app.id, block_network: true });
                            }
                          }}
                        />
                      </td>
                      <td className="px-4 py-3">
                        {canProcess ? (
                          <Toggle
                            on={!!rule?.enabled && !!rule?.block_process}
                            onChange={next => {
                              if (rule) {
                                updateMut.mutate({ id: rule.id, patch: { block_process: next, enabled: next || rule.block_network } });
                              } else if (next) {
                                controlMut.mutate({ application_id: app.id, block_network: true, block_process: true });
                              }
                            }}
                          />
                        ) : (
                          <span className="text-xs text-subtle" title="No process signature — this app is web-only">
                            web only
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {rule ? (
                          <button
                            onClick={() => removeMut.mutate(rule.id)}
                            className="text-xs text-muted-foreground hover:text-danger"
                          >
                            Remove
                          </button>
                        ) : (
                          <span className="text-xs text-subtle">Not controlled</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {filtered.length > 0 && (
          <div className="border-t border-border p-3">
            <Pagination
              page={page}
              totalPages={Math.max(1, Math.ceil(filtered.length / limit))}
              limit={limit}
              total={filtered.length}
              onPageChange={setPage}
              onLimitChange={l => { setLimit(l); setPage(1); }}
            />
          </div>
        )}
      </div>

      {/* Recent process-control activity */}
      <div className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">Recent application activity</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Applications stopped or observed on employee devices.
          </p>
        </div>
        {events.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Nothing yet — events appear here when a controlled application is launched.
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {events.slice(0, 10).map(ev => (
              <div key={ev.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                {ev.action === "blocked"
                  ? <Ban className="w-4 h-4 text-danger flex-shrink-0" />
                  : <ShieldAlert className="w-4 h-4 text-warning flex-shrink-0" />}
                <div className="min-w-0 flex-1">
                  <div className="text-body truncate">
                    {ev.target || "Unknown application"}
                    <span className="text-subtle"> · {ev.metadata?.process_name}</span>
                  </div>
                  <div className="text-xs text-subtle truncate">
                    {ev.employee?.name || ev.employee?.email || "Unknown user"}
                    {ev.metadata?.terminated === false && " — could not terminate (insufficient privileges)"}
                  </div>
                </div>
                <div className="text-xs text-subtle whitespace-nowrap">
                  {new Date(ev.timestamp).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {detail && <DetailModal app={detail} onClose={() => setDetail(null)} />}
      {showCustom && (
        <CustomAppModal
          onClose={() => setShowCustom(false)}
          onCreated={() => { setShowCustom(false); invalidate(); }}
        />
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-brand-500/10 p-2">
          <Icon className="w-4 h-4 text-brand-500" />
        </div>
        <div>
          <div className="text-xl font-semibold text-foreground">{value}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
      </div>
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cn(
        "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
        on ? "bg-brand-500" : "bg-elevated border border-border-strong"
      )}
    >
      <span
        className={cn(
          "inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform",
          on ? "translate-x-[18px]" : "translate-x-[3px]"
        )}
      />
    </button>
  );
}

function DetailModal({ app, onClose }: { app: any; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="text-lg font-semibold text-foreground">{app.name}</h3>
            <p className="text-sm text-muted-foreground">{app.description}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <Section title={`Backend domains (${app.domains?.length ?? 0})`}
          hint="All of these are blocked together — that is what stops an installed client, not just the website.">
          <div className="flex flex-wrap gap-1.5">
            {(app.domains ?? []).map((d: string) => (
              <span key={d} className="rounded-md bg-elevated px-2 py-1 text-xs text-body font-mono">{d}</span>
            ))}
          </div>
        </Section>

        {(app.process_names?.length ?? 0) > 0 && (
          <Section title="Process names" hint="Matched against the executable name, case-insensitively.">
            <div className="flex flex-wrap gap-1.5">
              {app.process_names.map((p: string) => (
                <span key={p} className="rounded-md bg-elevated px-2 py-1 text-xs text-body font-mono">{p}</span>
              ))}
            </div>
          </Section>
        )}

        {(app.bundle_ids?.length ?? 0) > 0 && (
          <Section title="macOS bundle identifiers" hint="Survives renaming the .app.">
            <div className="flex flex-wrap gap-1.5">
              {app.bundle_ids.map((b: string) => (
                <span key={b} className="rounded-md bg-elevated px-2 py-1 text-xs text-body font-mono">{b}</span>
              ))}
            </div>
          </Section>
        )}

        {(app.path_patterns?.length ?? 0) > 0 && (
          <Section title="Install path patterns" hint="Matched against the executable's own path — never its arguments.">
            <div className="flex flex-wrap gap-1.5">
              {app.path_patterns.map((p: string) => (
                <span key={p} className="rounded-md bg-elevated px-2 py-1 text-xs text-body font-mono">{p}</span>
              ))}
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h4 className="text-sm font-medium text-body mb-1">{title}</h4>
      {hint && <p className="text-xs text-subtle mb-2">{hint}</p>}
      {children}
    </div>
  );
}

function CustomAppModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [vendor, setVendor] = useState("");
  const [category, setCategory] = useState("other");
  const [domains, setDomains] = useState("");
  const [processes, setProcesses] = useState("");
  const [bundles, setBundles] = useState("");

  const split = (v: string) =>
    v.split(/[\n,]/).map(s => s.trim()).filter(Boolean);

  const mut = useMutation({
    mutationFn: () =>
      appControlApi.createApplication({
        name,
        vendor,
        category,
        domains: split(domains),
        process_names: split(processes),
        bundle_ids: split(bundles),
      }),
    onSuccess: () => { toast.success("Application added to your catalog"); onCreated(); },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Could not add the application"),
  });

  const inputClass =
    "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand-500";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-1">
          <h3 className="text-lg font-semibold text-foreground">Add an application</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-sm text-muted-foreground mb-5">
          For software the built-in catalog doesn't cover. Give the domains its backend uses, and
          the process names if you also want it stopped from running.
        </p>

        <div className="space-y-4">
          <Field label="Name">
            <input value={name} onChange={e => setName(e.target.value)} className={inputClass} placeholder="Acme Transfer" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Vendor">
              <input value={vendor} onChange={e => setVendor(e.target.value)} className={inputClass} placeholder="Acme Inc." />
            </Field>
            <Field label="Category">
              <select value={category} onChange={e => setCategory(e.target.value)} className={inputClass}>
                {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Backend domains" hint="One per line. Subdomains are covered automatically.">
            <textarea value={domains} onChange={e => setDomains(e.target.value)} rows={4}
              className={`${inputClass} font-mono`} placeholder={"acme.com\napi.acme.com"} />
          </Field>
          <Field label="Process names" hint="Optional. The executable's own name, e.g. acme.exe">
            <textarea value={processes} onChange={e => setProcesses(e.target.value)} rows={2}
              className={`${inputClass} font-mono`} placeholder={"acme.exe\nAcme"} />
          </Field>
          <Field label="macOS bundle identifiers" hint="Optional, e.g. com.acme.transfer">
            <textarea value={bundles} onChange={e => setBundles(e.target.value)} rows={2}
              className={`${inputClass} font-mono`} placeholder="com.acme.transfer" />
          </Field>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-border px-3.5 py-2 text-sm text-body hover:bg-elevated">
            Cancel
          </button>
          <button
            onClick={() => mut.mutate()}
            disabled={!name.trim() || (!domains.trim() && !processes.trim()) || mut.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground hover:bg-brand-600 disabled:opacity-60"
          >
            {mut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Add application
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-muted-foreground mb-1">{label}</label>
      {hint && <p className="text-xs text-subtle mb-1.5">{hint}</p>}
      {children}
    </div>
  );
}
