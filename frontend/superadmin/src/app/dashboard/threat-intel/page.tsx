"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { blocklistApi } from "@/lib/api";
import { ShieldAlert, Plus, Trash2, X, Loader2, Rss } from "lucide-react";
import { formatDate, cn } from "@/lib/utils";
import { toast } from "sonner";

export default function ThreatIntelPage() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ domain: "", action: "block", category: "", reason: "" });

  const { data, isLoading } = useQuery({ queryKey: ["blocklist"], queryFn: blocklistApi.list });
  const { data: feeds } = useQuery({ queryKey: ["threat-feeds"], queryFn: blocklistApi.feedStatus });

  const createMut = useMutation({
    mutationFn: blocklistApi.create,
    onSuccess: () => {
      toast.success("Global rule added");
      qc.invalidateQueries({ queryKey: ["blocklist"] });
      setShowAdd(false);
      setForm({ domain: "", action: "block", category: "", reason: "" });
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Failed to add rule"),
  });

  const toggleMut = useMutation({
    mutationFn: (id: string) => blocklistApi.toggle(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["blocklist"] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => blocklistApi.delete(id),
    onSuccess: () => {
      toast.success("Rule removed");
      qc.invalidateQueries({ queryKey: ["blocklist"] });
    },
  });

  const rules = data?.data?.rules ?? [];
  const feedRows = feeds?.data?.feeds ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Threat Intel & Global Blocklist</h2>
          <p className="text-sm text-muted-foreground mt-1">Rules and feeds that apply to every organization</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 bg-primary hover:bg-brand-600 text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" /> Add Global Rule
        </button>
      </div>

      {/* Feed sync status */}
      <div className="bg-card rounded-xl border border-border shadow-sm">
        <div className="px-5 py-4 border-b border-border flex items-center gap-2">
          <Rss className="w-4 h-4 text-brand-500" />
          <h3 className="font-semibold text-foreground">Threat Feeds</h3>
          <span className="text-xs text-muted-foreground">({feeds?.data?.total_indicators ?? 0} indicators total)</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-border">
          {feedRows.length === 0 ? (
            <p className="text-center text-sm text-[#6B6B6B] py-8 col-span-3">No feed data synced yet — first sync runs within 6h of startup</p>
          ) : feedRows.map((f: any) => (
            <div key={f.source} className="px-5 py-4">
              <p className="text-sm font-medium text-foreground capitalize">{f.source}</p>
              <p className="text-2xl font-bold text-foreground mt-1">{f.count}</p>
              <p className="text-xs text-muted-foreground mt-1">last seen {f.last_seen_at ? formatDate(f.last_seen_at) : "—"}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Global rules */}
      <div className="bg-card rounded-xl border border-border shadow-sm">
        <div className="px-5 py-4 border-b border-border flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-red-400" />
          <h3 className="font-semibold text-foreground">Global Domain Rules</h3>
          <span className="text-xs text-muted-foreground">({rules.length})</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground text-xs uppercase tracking-wide">
                <th className="text-left px-5 py-3 font-medium">Domain</th>
                <th className="text-left px-5 py-3 font-medium">Action</th>
                <th className="text-left px-5 py-3 font-medium">Category</th>
                <th className="text-left px-5 py-3 font-medium">Enabled</th>
                <th className="text-right px-5 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                [...Array(3)].map((_, i) => <tr key={i} className="animate-pulse"><td colSpan={5} className="px-5 py-4"><div className="h-4 bg-muted rounded w-3/4" /></td></tr>)
              ) : rules.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-12 text-[#6B6B6B]">No global rules yet</td></tr>
              ) : rules.map((r: any) => (
                <tr key={r.id} className="hover:bg-muted transition-colors">
                  <td className="px-5 py-3 text-foreground font-mono">{r.domain}</td>
                  <td className="px-5 py-3">
                    <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium capitalize",
                      r.action === "block" ? "bg-red-500/10 text-red-400" : r.action === "alert" ? "bg-yellow-500/10 text-yellow-400" : "bg-green-500/10 text-green-400")}>
                      {r.action}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{r.category || "—"}</td>
                  <td className="px-5 py-3">
                    <button onClick={() => toggleMut.mutate(r.id)} className={cn("w-9 h-5 rounded-full transition-colors relative", r.enabled ? "bg-brand-500" : "bg-muted")}>
                      <span className={cn("absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform", r.enabled ? "translate-x-4" : "translate-x-0.5")} />
                    </button>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button onClick={() => deleteMut.mutate(r.id)} className="p-1.5 hover:bg-red-500/10 rounded text-muted-foreground hover:text-red-400">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setShowAdd(false)}>
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="font-semibold text-foreground">Add Global Rule</h3>
              <button onClick={() => setShowAdd(false)} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); createMut.mutate(form); }} className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Domain *</label>
                <input required value={form.domain} onChange={(e) => setForm((f) => ({ ...f, domain: e.target.value }))}
                  placeholder="malicious-site.com"
                  className="w-full border border-border bg-background rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Action</label>
                <select value={form.action} onChange={(e) => setForm((f) => ({ ...f, action: e.target.value }))}
                  className="w-full border border-border bg-background rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
                  <option value="block">Block</option>
                  <option value="alert">Alert</option>
                  <option value="allow">Allow</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Category</label>
                <input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  placeholder="malware, phishing, ..."
                  className="w-full border border-border bg-background rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Reason</label>
                <input value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                  className="w-full border border-border bg-background rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
              </div>
              <p className="text-xs text-[#6B6B6B]">Applies to every organization on the platform immediately.</p>
              <button type="submit" disabled={createMut.isPending}
                className="w-full bg-primary text-primary-foreground py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60">
                {createMut.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Add Rule
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
