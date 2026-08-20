"use client";

import { useMemo, useState } from "react";
import { Pagination } from "@/components/ui/Pagination";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { swgApi } from "@/lib/api";
import {
  Globe, Plus, Trash2, Search, X, Loader2, Shield, AlertCircle,
  CheckCircle2, XCircle
} from "lucide-react";
import { formatDate, cn } from "@/lib/utils";
import { toast } from "sonner";

export default function SWGPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ domain: "", rule_type: "block", category: "", is_global: false });
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [checkUrl, setCheckUrl] = useState("");
  const [checkResult, setCheckResult] = useState<any>(null);
  const [checking, setChecking] = useState(false);

  const { data: rulesData, isLoading } = useQuery({
    queryKey: ["swg-rules", search],
    queryFn: () => swgApi.listRules({ search: search || undefined }),
  });

  const { data: statsData } = useQuery({
    queryKey: ["swg-stats"],
    queryFn: swgApi.stats,
    refetchInterval: 30_000,
  });

  const { data: catsData } = useQuery({
    queryKey: ["swg-cats"],
    queryFn: swgApi.categories,
  });

  const createMut = useMutation({
    mutationFn: swgApi.createRule,
    onSuccess: () => { toast.success("Rule created"); qc.invalidateQueries({ queryKey: ["swg-rules"] }); setShowForm(false); setForm({ domain: "", rule_type: "block", category: "", is_global: false }); },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Failed"),
  });

  const deleteMut = useMutation({
    mutationFn: swgApi.deleteRule,
    onSuccess: () => { toast.success("Rule deleted"); qc.invalidateQueries({ queryKey: ["swg-rules"] }); setDeleteId(null); },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Failed"),
  });

  const rules = Array.isArray(rulesData?.data?.data) ? rulesData.data.data : (rulesData?.data?.rules ?? []);
  const pagedRules = useMemo(
    () => rules.slice((page - 1) * limit, page * limit),
    [rules, page]
  );
  const stats = statsData?.data ?? {};
  const categories = Array.isArray(catsData?.data) ? catsData.data : (catsData?.data?.categories ?? []);

  const handleCheck = async () => {
    if (!checkUrl.trim()) return;
    setChecking(true);
    setCheckResult(null);
    try {
      const res = await swgApi.checkUrl(checkUrl);
      setCheckResult(res.data);
    } catch (e: any) {
      toast.error(e.response?.data?.error ?? "Check failed");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Secure Web Gateway</h2>
        <p className="text-sm text-muted-foreground mt-1">DNS filtering and domain rules</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Rules", value: stats.rule_count ?? stats.total_rules ?? 0, color: "bg-brand-500/10 text-brand-500", icon: Shield },
          { label: "Blocked Requests", value: stats.total_blocked ?? stats.blocked_domains ?? 0, color: "bg-red-500/10 text-danger", icon: XCircle },
          { label: "Allowed Requests", value: stats.total_allowed ?? 0, color: "bg-purple-500/10 text-accent-purple", icon: Globe },
          { label: "Top Categories", value: (stats.top_blocked_categories ?? []).length, color: "bg-green-500/10 text-success", icon: AlertCircle },
        ].map(s => (
          <div key={s.label} className="bg-card rounded-xl p-4 border border-border shadow-sm flex items-center gap-3">
            <div className={`p-2 rounded-lg ${s.color}`}><s.icon className="w-4 h-4" /></div>
            <div>
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-xl font-bold text-foreground">{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* URL Checker */}
      <div className="bg-card rounded-xl border border-border shadow-sm p-5">
        <h3 className="font-semibold text-foreground mb-3">URL Checker</h3>
        <div className="flex gap-3">
          <input
            value={checkUrl}
            onChange={e => setCheckUrl(e.target.value)}
            placeholder="https://example.com/path"
            className="flex-1 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            onKeyDown={e => e.key === "Enter" && handleCheck()}
          />
          <button
            onClick={handleCheck}
            disabled={checking}
            className="flex items-center gap-2 bg-brand-500 text-on-brand px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60"
          >
            {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Check
          </button>
        </div>
        {checkResult && (
          <div className={cn("mt-3 flex items-center gap-3 p-3 rounded-lg text-sm",
            checkResult.blocked ? "bg-red-500/10 text-danger" : "bg-green-500/10 text-success")}>
            {checkResult.blocked
              ? <XCircle className="w-5 h-5 flex-shrink-0" />
              : <CheckCircle2 className="w-5 h-5 flex-shrink-0" />}
            <div>
              <p className="font-medium">{checkResult.blocked ? "Blocked" : "Allowed"}</p>
              {checkResult.reason && <p className="text-xs opacity-80">{checkResult.reason}</p>}
              {checkResult.category && <p className="text-xs opacity-80">Category: {checkResult.category}</p>}
            </div>
          </div>
        )}
      </div>

      {/* Rules */}
      <div className="bg-card rounded-xl border border-border shadow-sm">
        <div className="p-4 border-b border-border flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search domain rules..."
              className="pl-9 pr-3 py-2 border border-border rounded-lg text-sm w-full focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 bg-brand-500 text-on-brand px-4 py-2 rounded-lg text-sm font-medium"
          >
            <Plus className="w-4 h-4" /> Add Rule
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3 text-left font-medium">Domain</th>
                <th className="px-5 py-3 text-left font-medium">Rule</th>
                <th className="px-5 py-3 text-left font-medium">Category</th>
                <th className="px-5 py-3 text-left font-medium">Scope</th>
                <th className="px-5 py-3 text-left font-medium">Created</th>
                <th className="px-5 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-elevated">
              {isLoading ? (
                [...Array(4)].map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {[...Array(6)].map((__, j) => <td key={j} className="px-5 py-4"><div className="h-4 bg-elevated rounded w-3/4" /></td>)}
                  </tr>
                ))
              ) : rules.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-subtle">
                    <Globe className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No domain rules yet
                  </td>
                </tr>
              ) : (
                pagedRules.map((r: any) => (
                  <tr key={r.id} className="hover:bg-elevated">
                    <td className="px-5 py-3">
                      <span className="font-mono text-sm text-foreground">*.{r.domain}</span>
                    </td>
                    <td className="px-5 py-3">
                      <span className={cn("px-2.5 py-1 rounded-full text-xs font-medium",
                        (r.action ?? r.rule_type) === "block" ? "bg-red-500/10 text-danger" : "bg-green-500/10 text-success")}>
                        {r.action ?? r.rule_type}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground text-sm">{r.category || "—"}</td>
                    <td className="px-5 py-3">
                      <span className={cn("text-xs", (!r.org_id || r.is_global) ? "text-brand-500 font-medium" : "text-muted-foreground")}>
                        {(!r.org_id || r.is_global) ? "Global" : "Org"}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-xs text-subtle">{formatDate(r.created_at)}</td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => setDeleteId(r.id)}
                        className="p-1.5 hover:bg-red-500/10 rounded text-subtle hover:text-danger"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <Pagination
          page={page}
          totalPages={Math.ceil(rules.length / limit)}
          total={rules.length}
          limit={limit}
          onPageChange={setPage}
          onLimitChange={n => { setLimit(n); setPage(1); }}
        />
      </div>

      {/* Add Rule Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-card rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="font-semibold text-foreground">Add Domain Rule</h3>
              <button onClick={() => setShowForm(false)} className="text-subtle hover:text-body"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-body mb-1">Domain *</label>
                <input
                  value={form.domain}
                  onChange={e => setForm(f => ({ ...f, domain: e.target.value }))}
                  placeholder="example.com (without wildcard)"
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-body mb-1">Rule Type</label>
                <select
                  value={form.rule_type}
                  onChange={e => setForm(f => ({ ...f, rule_type: e.target.value }))}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="block">Block</option>
                  <option value="allow">Allow</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-body mb-1">Category</label>
                <select
                  value={form.category}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="">None</option>
                  {categories.map((c: any) => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowForm(false)} className="flex-1 border border-border text-body py-2 rounded-lg text-sm">Cancel</button>
                <button
                  onClick={() => createMut.mutate(form)}
                  disabled={!form.domain.trim() || createMut.isPending}
                  className="flex-1 bg-brand-500 text-on-brand py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {createMut.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Add Rule
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-card rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="w-12 h-12 bg-red-500/10 rounded-xl flex items-center justify-center mx-auto mb-4">
              <Trash2 className="w-5 h-5 text-danger" />
            </div>
            <h3 className="text-center font-semibold text-foreground mb-2">Delete Rule?</h3>
            <p className="text-center text-sm text-muted-foreground mb-6">The domain will no longer be filtered.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteId(null)} className="flex-1 border border-border text-body py-2 rounded-lg text-sm">Cancel</button>
              <button
                onClick={() => deleteMut.mutate(deleteId)}
                disabled={deleteMut.isPending}
                className="flex-1 bg-red-600 text-white py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {deleteMut.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
