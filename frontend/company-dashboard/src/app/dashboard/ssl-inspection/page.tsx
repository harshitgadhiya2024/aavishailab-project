"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { settingsApi } from "@/lib/api";
import {
  ShieldCheck, Search, Plus, Trash2, X, Loader2, Lock, ChevronRight, ChevronLeft,
  Check, Globe, Sparkles, Eye
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Pagination } from "@/components/ui/Pagination";


type DiscoveredDomain = {
  domain: string;
  note?: string;
  tags?: string[];
  recommended?: boolean;
  source?: string;
  seen_count?: number;
  already_bypassed?: boolean;
};

type DiscoveredGroup = {
  group: string;
  description?: string;
  domains: DiscoveredDomain[];
};

const TAG_STYLES: Record<string, string> = {
  pinned: "bg-red-500/10 text-danger",
  auth: "bg-brand-500/10 text-brand-500",
  secrets: "bg-purple-500/10 text-accent-purple",
  observed: "bg-green-500/10 text-success",
};

function TagBadge({ tag }: { tag: string }) {
  return (
    <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium capitalize", TAG_STYLES[tag] ?? "bg-elevated text-subtle")}>
      {tag}
    </span>
  );
}

export default function SSLInspectionPage() {
  const qc = useQueryClient();

  const [enabled, setEnabled] = useState(false);
  const [bypassDomains, setBypassDomains] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);

  // ── Add-domain workflow state ──────────────────────────────────────────────
  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [resultFilter, setResultFilter] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["settings-mitm"],
    queryFn: () => settingsApi.getMITM(),
  });

  const { data: platformsData } = useQuery({
    queryKey: ["mitm-platforms"],
    queryFn: () => settingsApi.mitmPlatforms(),
    enabled: wizardOpen,
  });

  const { data: discoverData, isFetching: discovering } = useQuery({
    queryKey: ["mitm-discover", submittedQuery],
    queryFn: () => settingsApi.discoverBypass(submittedQuery),
    enabled: !!submittedQuery && wizardOpen,
  });

  useEffect(() => {
    if (data?.data) {
      setEnabled(!!data.data.enabled);
      setBypassDomains(Array.isArray(data.data.bypass_domains) ? data.data.bypass_domains : []);
    }
  }, [data]);

  const saveMut = useMutation({
    mutationFn: (payload: { enabled: boolean; bypass_domains: string[] }) => settingsApi.updateMITM(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings-mitm"] }),
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Failed to save"),
  });

  const save = (next: { enabled: boolean; bypass_domains: string[] }, message?: string) => {
    setEnabled(next.enabled);
    setBypassDomains(next.bypass_domains);
    saveMut.mutate(next, { onSuccess: () => message && toast.success(message) });
  };

  const defaultBypass: string[] = Array.isArray(data?.data?.default_bypass_domains)
    ? data.data.default_bypass_domains
    : [];

  const groups: DiscoveredGroup[] = Array.isArray(discoverData?.data?.groups) ? discoverData.data.groups : [];
  const platformName: string = discoverData?.data?.platform || "";
  const platformSuggestions: string[] = Array.isArray(platformsData?.data?.platforms)
    ? platformsData.data.platforms
    : [];

  const filteredGroups = useMemo(() => {
    const f = resultFilter.trim().toLowerCase();
    if (!f) return groups;
    return groups
      .map(g => ({ ...g, domains: g.domains.filter(d => d.domain.includes(f) || (d.note ?? "").toLowerCase().includes(f)) }))
      .filter(g => g.domains.length > 0);
  }, [groups, resultFilter]);

  const selectableDomains = useMemo(
    () => groups.flatMap(g => g.domains).filter(d => !d.already_bypassed),
    [groups]
  );

  const allRows = useMemo(() => {
    const f = search.trim().toLowerCase();
    const custom = bypassDomains.map(d => ({ domain: d, builtin: false }));
    const builtin = defaultBypass.map(d => ({ domain: d, builtin: true }));
    return [...custom, ...builtin].filter(r => !f || r.domain.toLowerCase().includes(f));
  }, [bypassDomains, defaultBypass, search]);

  const totalRows = allRows.length;
  const rows = useMemo(
    () => allRows.slice((page - 1) * limit, page * limit),
    [allRows, page]
  );

  const closeWizard = () => {
    setWizardOpen(false);
    setStep(1);
    setQuery("");
    setSubmittedQuery("");
    setSelected(new Set());
    setResultFilter("");
  };

  const runDiscovery = () => {
    const q = query.trim();
    if (!q) return;
    setSubmittedQuery(q.toLowerCase());
    setSelected(new Set());
    setStep(2);
  };

  const toggleDomain = (domain: string) => {
    setSelected(prev => {
      const n = new Set(prev);
      n.has(domain) ? n.delete(domain) : n.add(domain);
      return n;
    });
  };

  const toggleGroup = (group: DiscoveredGroup) => {
    const selectable = group.domains.filter(d => !d.already_bypassed).map(d => d.domain);
    const allSelected = selectable.every(d => selected.has(d));
    setSelected(prev => {
      const n = new Set(prev);
      selectable.forEach(d => (allSelected ? n.delete(d) : n.add(d)));
      return n;
    });
  };

  const selectRecommended = () => {
    setSelected(new Set(selectableDomains.filter(d => d.recommended).map(d => d.domain)));
  };

  const confirmAdd = () => {
    const additions = [...selected].filter(d => !bypassDomains.includes(d));
    if (additions.length === 0) {
      toast.info("Those domains are already bypassed");
      closeWizard();
      return;
    }
    save(
      { enabled, bypass_domains: [...bypassDomains, ...additions] },
      `${additions.length} domain${additions.length === 1 ? "" : "s"} added to the bypass list`
    );
    closeWizard();
  };

  const removeDomain = (d: string) => {
    save({ enabled, bypass_domains: bypassDomains.filter(x => x !== d) }, "Domain removed from the bypass list");
    setRemoveTarget(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-foreground">SSL Inspection</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Decrypt HTTPS so DLP can see inside uploads — and choose which domains to never intercept
          </p>
        </div>
        <button
          onClick={() => setWizardOpen(true)}
          className="flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-on-brand px-4 py-2 rounded-lg text-sm font-medium"
        >
          <Plus className="w-4 h-4" /> Add Bypass Domains
        </button>
      </div>

      {/* Inspection toggle */}
      <div className="bg-card rounded-xl border border-border shadow-sm p-5">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 bg-brand-500/10 rounded-lg flex items-center justify-center flex-shrink-0">
            <ShieldCheck className="w-5 h-5 text-brand-500" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold text-foreground">HTTPS interception</h3>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Lets Data Loss Prevention inspect HTTPS uploads (e.g. an attachment on gmail.com), not just plain HTTP.
                  Each device&apos;s agent must have this organization&apos;s inspection certificate installed.
                </p>
              </div>
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin text-subtle" />
              ) : (
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  onClick={() => save({ enabled: !enabled, bypass_domains: bypassDomains }, enabled ? "SSL inspection disabled" : "SSL inspection enabled")}
                  disabled={saveMut.isPending}
                  className={cn(
                    "relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-60",
                    enabled ? "bg-brand-500" : "bg-border-strong"
                  )}
                >
                  <span className={cn(
                    "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
                    enabled ? "translate-x-5" : "translate-x-0.5"
                  )} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Bypass list */}
      <div className="bg-card rounded-xl border border-border shadow-sm">
        <div className="p-4 border-b border-border flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle" />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search bypass domains..."
              className="pl-9 pr-3 py-2 bg-background border border-border rounded-lg text-sm w-full text-foreground placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <span className="text-xs text-muted-foreground">
            {bypassDomains.length} custom · {defaultBypass.length} built-in
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3 text-left font-medium">Domain</th>
                <th className="px-5 py-3 text-left font-medium">Source</th>
                <th className="px-5 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-elevated">
              {isLoading ? (
                [...Array(6)].map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {[...Array(3)].map((__, j) => (
                      <td key={j} className="px-5 py-4"><div className="h-4 bg-elevated rounded w-3/4" /></td>
                    ))}
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={3} className="text-center py-12 text-subtle">
                    <Globe className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    {search ? "No bypass domains match your search" : "No bypass domains yet"}
                  </td>
                </tr>
              ) : (
                rows.map(row => (
                  <tr key={`${row.builtin}-${row.domain}`} className="hover:bg-elevated transition-colors">
                    <td className="px-5 py-3 font-mono text-xs text-foreground">{row.domain}</td>
                    <td className="px-5 py-3">
                      <span className={cn(
                        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium",
                        row.builtin ? "bg-elevated text-body" : "bg-brand-500/10 text-brand-500"
                      )}>
                        {row.builtin ? <><Lock className="w-3 h-3" /> Built-in</> : "Added by you"}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end">
                        {row.builtin ? (
                          <span className="text-xs text-subtle">Always excluded</span>
                        ) : (
                          <button
                            onClick={() => setRemoveTarget(row.domain)}
                            title="Remove from bypass list"
                            className="p-1.5 hover:bg-red-500/10 rounded text-subtle hover:text-danger"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
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
          totalPages={Math.ceil(totalRows / limit)}
          total={totalRows}
          limit={limit}
          onPageChange={setPage}
          onLimitChange={n => { setLimit(n); setPage(1); }}
        />
      </div>

      {/* ── Add-domain workflow ───────────────────────────────────────────── */}
      {wizardOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-card rounded-2xl shadow-2xl w-full max-w-3xl max-h-[88vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div>
                <h3 className="font-semibold text-foreground">Add Bypass Domains</h3>
                <div className="flex items-center gap-2 mt-2">
                  {[1, 2, 3].map(s => (
                    <div key={s} className="flex items-center gap-2">
                      <span className={cn(
                        "w-5 h-5 rounded-full text-[10px] font-semibold flex items-center justify-center",
                        step === s ? "bg-brand-500 text-on-brand" : step > s ? "bg-green-500/15 text-success" : "bg-elevated text-subtle"
                      )}>
                        {step > s ? <Check className="w-3 h-3" /> : s}
                      </span>
                      <span className={cn("text-xs", step === s ? "text-foreground font-medium" : "text-subtle")}>
                        {s === 1 ? "Search platform" : s === 2 ? "Select domains" : "Review"}
                      </span>
                      {s < 3 && <ChevronRight className="w-3 h-3 text-faint" />}
                    </div>
                  ))}
                </div>
              </div>
              <button onClick={closeWizard} className="text-subtle hover:text-body"><X className="w-5 h-5" /></button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              {/* Step 1 — what platform? */}
              {step === 1 && (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Enter a platform name or a domain. We look up its sign-in, secrets and certificate-pinned
                    hostnames, plus any matching subdomains your own devices have connected to — so you can bypass
                    only the few that matter instead of the whole platform.
                  </p>
                  <form onSubmit={e => { e.preventDefault(); runDiscovery(); }} className="flex gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle" />
                      <input
                        autoFocus
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="e.g. AWS, Azure, Salesforce, or intranet.company.com"
                        className="pl-9 pr-3 py-2 bg-background border border-border rounded-lg text-sm w-full text-foreground placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-brand-500"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={!query.trim()}
                      className="flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-on-brand px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60"
                    >
                      <Sparkles className="w-4 h-4" /> Find domains
                    </button>
                  </form>

                  {platformSuggestions.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Common platforms</p>
                      <div className="flex flex-wrap gap-2">
                        {platformSuggestions.map(p => (
                          <button
                            key={p}
                            onClick={() => { setQuery(p); setSubmittedQuery(p.toLowerCase()); setSelected(new Set()); setStep(2); }}
                            className="px-3 py-1.5 rounded-lg border border-border text-xs text-body hover:bg-elevated"
                          >
                            {p}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Step 2 — pick the ones to bypass */}
              {step === 2 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <p className="text-sm text-foreground font-medium">
                        {platformName || `Results for "${submittedQuery}"`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {discovering ? "Searching…" : `${groups.reduce((n, g) => n + g.domains.length, 0)} domains found · ${selected.size} selected`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={selectRecommended} className="text-xs text-brand-500 hover:text-brand-400 font-medium">
                        Select recommended
                      </button>
                      <button onClick={() => setSelected(new Set())} className="text-xs text-muted-foreground hover:text-body">
                        Clear
                      </button>
                    </div>
                  </div>

                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle" />
                    <input
                      value={resultFilter}
                      onChange={e => setResultFilter(e.target.value)}
                      placeholder="Filter these results..."
                      className="pl-9 pr-3 py-2 bg-background border border-border rounded-lg text-sm w-full text-foreground placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  </div>

                  {discovering ? (
                    <div className="space-y-2">
                      {[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-elevated rounded-lg animate-pulse" />)}
                    </div>
                  ) : filteredGroups.length === 0 ? (
                    <div className="text-center py-10 text-subtle text-sm">
                      <Globe className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      Nothing found for &quot;{submittedQuery}&quot;. Go back and try a platform name or a full hostname.
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {filteredGroups.map(group => {
                        const selectable = group.domains.filter(d => !d.already_bypassed);
                        const allSelected = selectable.length > 0 && selectable.every(d => selected.has(d.domain));
                        return (
                          <div key={group.group} className="border border-border rounded-xl overflow-hidden">
                            <div className="bg-elevated px-4 py-2.5 flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-foreground">{group.group}</p>
                                {group.description && (
                                  <p className="text-xs text-muted-foreground mt-0.5">{group.description}</p>
                                )}
                              </div>
                              {selectable.length > 0 && (
                                <button
                                  onClick={() => toggleGroup(group)}
                                  className="text-xs text-brand-500 hover:text-brand-400 whitespace-nowrap flex-shrink-0"
                                >
                                  {allSelected ? "Deselect all" : "Select all"}
                                </button>
                              )}
                            </div>
                            <div className="divide-y divide-elevated">
                              {group.domains.map(d => (
                                <label
                                  key={d.domain}
                                  className={cn(
                                    "flex items-center gap-3 px-4 py-2.5",
                                    d.already_bypassed ? "opacity-60" : "cursor-pointer hover:bg-elevated"
                                  )}
                                >
                                  <input
                                    type="checkbox"
                                    disabled={d.already_bypassed}
                                    checked={d.already_bypassed || selected.has(d.domain)}
                                    onChange={() => toggleDomain(d.domain)}
                                    className="rounded border-border-strong"
                                  />
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="font-mono text-xs text-foreground">{d.domain}</span>
                                      {d.recommended && (
                                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-brand-500/10 text-brand-500">
                                          Recommended
                                        </span>
                                      )}
                                      {(d.tags ?? []).map(t => <TagBadge key={t} tag={t} />)}
                                      {d.already_bypassed && (
                                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-500/10 text-success">
                                          Already bypassed
                                        </span>
                                      )}
                                    </div>
                                    {d.note && <p className="text-[11px] text-subtle mt-0.5">{d.note}</p>}
                                  </div>
                                  {!!d.seen_count && (
                                    <span className="text-[11px] text-muted-foreground whitespace-nowrap flex items-center gap-1">
                                      <Eye className="w-3 h-3" /> {d.seen_count} hits
                                    </span>
                                  )}
                                </label>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Step 3 — review */}
              {step === 3 && (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    These domains will never be decrypted. DLP cannot inspect uploads to them, and policies that rely
                    on HTTPS content scanning will not apply.
                  </p>
                  <div className="border border-border rounded-xl divide-y divide-elevated">
                    {[...selected].map(d => (
                      <div key={d} className="flex items-center justify-between px-4 py-2.5">
                        <span className="font-mono text-xs text-foreground">{d}</span>
                        <button onClick={() => toggleDomain(d)} className="text-faint hover:text-danger">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    {selected.size === 0 && (
                      <p className="px-4 py-6 text-center text-sm text-subtle">
                        Nothing selected — go back and pick at least one domain.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Wizard navigation */}
            <div className="px-6 py-4 border-t border-border flex gap-3">
              {step === 1 ? (
                <button onClick={closeWizard} className="flex-1 border border-border text-body py-2 rounded-lg text-sm hover:bg-elevated">
                  Cancel
                </button>
              ) : (
                <button
                  onClick={() => setStep(s => s - 1)}
                  className="flex-1 border border-border text-body py-2 rounded-lg text-sm hover:bg-elevated flex items-center justify-center gap-1"
                >
                  <ChevronLeft className="w-4 h-4" /> Back
                </button>
              )}
              {step === 2 && (
                <button
                  onClick={() => setStep(3)}
                  disabled={selected.size === 0}
                  className="flex-1 bg-brand-500 text-on-brand py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-1 disabled:opacity-60"
                >
                  Review {selected.size > 0 ? `(${selected.size})` : ""} <ChevronRight className="w-4 h-4" />
                </button>
              )}
              {step === 3 && (
                <button
                  onClick={confirmAdd}
                  disabled={selected.size === 0 || saveMut.isPending}
                  className="flex-1 bg-brand-500 text-on-brand py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {saveMut.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  Add {selected.size} domain{selected.size === 1 ? "" : "s"}
                </button>
              )}
              {step === 1 && (
                <button
                  onClick={runDiscovery}
                  disabled={!query.trim()}
                  className="flex-1 bg-brand-500 text-on-brand py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-1 disabled:opacity-60"
                >
                  Next <ChevronRight className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Remove confirm */}
      {removeTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-card rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="w-12 h-12 bg-red-500/10 rounded-xl flex items-center justify-center mx-auto mb-4">
              <Trash2 className="w-5 h-5 text-danger" />
            </div>
            <h3 className="text-center font-semibold text-foreground mb-2">Stop bypassing this domain?</h3>
            <p className="text-center text-sm text-muted-foreground mb-6">
              <span className="font-mono text-foreground">{removeTarget}</span> will be decrypted again while SSL
              inspection is on. Certificate-pinned apps on this domain may stop working.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setRemoveTarget(null)} className="flex-1 border border-border text-body py-2 rounded-lg text-sm">Cancel</button>
              <button
                onClick={() => removeDomain(removeTarget)}
                disabled={saveMut.isPending}
                className="flex-1 bg-red-600 text-white py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {saveMut.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
