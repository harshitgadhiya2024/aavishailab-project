"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { featureFlagApi, orgApi } from "@/lib/api";
import { Flag, Plus, Trash2, X, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export default function FeatureFlagsPage() {
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ key: "", description: "" });
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ["feature-flags"], queryFn: featureFlagApi.list });
  const { data: orgsData } = useQuery({ queryKey: ["orgs-for-flags"], queryFn: () => orgApi.list({ limit: 100 }) });

  const createMut = useMutation({
    mutationFn: featureFlagApi.create,
    onSuccess: () => {
      toast.success("Flag created");
      qc.invalidateQueries({ queryKey: ["feature-flags"] });
      setShowNew(false);
      setForm({ key: "", description: "" });
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Failed to create flag"),
  });

  const toggleGlobalMut = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => featureFlagApi.update(id, { enabled_globally: enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["feature-flags"] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => featureFlagApi.delete(id),
    onSuccess: () => {
      toast.success("Flag deleted");
      qc.invalidateQueries({ queryKey: ["feature-flags"] });
    },
  });

  const enableOrgMut = useMutation({
    mutationFn: ({ id, orgId }: { id: string; orgId: string }) => featureFlagApi.enableForOrg(id, orgId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["feature-flags"] }),
  });
  const disableOrgMut = useMutation({
    mutationFn: ({ id, orgId }: { id: string; orgId: string }) => featureFlagApi.disableForOrg(id, orgId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["feature-flags"] }),
  });

  const flags = data?.data?.flags ?? [];
  const orgs = orgsData?.data?.organizations ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Feature Flags</h2>
          <p className="text-sm text-muted-foreground mt-1">Roll out a feature globally, or pilot it on specific orgs first</p>
        </div>
        <button onClick={() => setShowNew(true)} className="flex items-center gap-2 bg-primary hover:bg-brand-600 text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          <Plus className="w-4 h-4" /> New Flag
        </button>
      </div>

      <div className="bg-card rounded-xl border border-border shadow-sm divide-y divide-border">
        {isLoading ? (
          [...Array(3)].map((_, i) => <div key={i} className="h-16 animate-pulse bg-muted/40" />)
        ) : flags.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Flag className="w-8 h-8 mx-auto mb-2 opacity-30" />
            No feature flags yet
          </div>
        ) : flags.map((f: any) => {
          const isOpen = expanded === f.id;
          const orgIds: string[] = f.org_ids ?? [];
          return (
            <div key={f.id}>
              <div className="px-5 py-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-mono text-sm font-medium text-foreground">{f.key}</p>
                  {f.description && <p className="text-xs text-muted-foreground mt-0.5">{f.description}</p>}
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="text-xs text-muted-foreground">{orgIds.length} org override{orgIds.length === 1 ? "" : "s"}</span>
                  <button
                    onClick={() => toggleGlobalMut.mutate({ id: f.id, enabled: !f.enabled_globally })}
                    className={cn("text-xs font-medium px-2.5 py-1 rounded-full", f.enabled_globally ? "bg-green-500/10 text-green-400" : "bg-muted text-muted-foreground")}
                  >
                    {f.enabled_globally ? "On for everyone" : "Off"}
                  </button>
                  <button onClick={() => setExpanded(isOpen ? null : f.id)} className="text-muted-foreground hover:text-foreground">
                    {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  <button onClick={() => deleteMut.mutate(f.id)} className="p-1.5 hover:bg-red-500/10 rounded text-muted-foreground hover:text-red-400">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              {isOpen && (
                <div className="px-5 pb-4 pl-8">
                  <p className="text-xs text-muted-foreground mb-2">Per-org overrides (on regardless of the global toggle):</p>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {orgs.map((o: any) => {
                      const enabled = orgIds.includes(o.id);
                      return (
                        <label key={o.id} className="flex items-center gap-2 text-sm py-1">
                          <input
                            type="checkbox"
                            checked={enabled}
                            onChange={() => enabled
                              ? disableOrgMut.mutate({ id: f.id, orgId: o.id })
                              : enableOrgMut.mutate({ id: f.id, orgId: o.id })}
                          />
                          <span className="text-foreground">{o.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setShowNew(false)}>
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="font-semibold text-foreground">New Feature Flag</h3>
              <button onClick={() => setShowNew(false)} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); createMut.mutate(form); }} className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Key *</label>
                <input required value={form.key} onChange={(e) => setForm((f) => ({ ...f, key: e.target.value }))}
                  placeholder="e.g. new-policy-editor"
                  className="w-full border border-border bg-background rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Description</label>
                <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  className="w-full border border-border bg-background rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
              </div>
              <button type="submit" disabled={createMut.isPending}
                className="w-full bg-primary text-primary-foreground py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60">
                {createMut.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Create
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
