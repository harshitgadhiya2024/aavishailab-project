"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { announcementApi } from "@/lib/api";
import { Megaphone, Plus, Trash2, X, Loader2, Info, AlertTriangle, Siren } from "lucide-react";
import { formatDateTime, cn } from "@/lib/utils";
import { toast } from "sonner";

const SEVERITY_ICON: Record<string, any> = { info: Info, warning: AlertTriangle, critical: Siren };
const SEVERITY_COLOR: Record<string, string> = {
  info: "bg-brand-500/10 text-brand-500",
  warning: "bg-yellow-500/10 text-yellow-400",
  critical: "bg-red-500/10 text-red-400",
};

export default function AnnouncementsPage() {
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ title: "", body: "", severity: "info" });

  const { data, isLoading } = useQuery({ queryKey: ["announcements"], queryFn: announcementApi.list });

  const createMut = useMutation({
    mutationFn: announcementApi.create,
    onSuccess: () => {
      toast.success("Announcement published");
      qc.invalidateQueries({ queryKey: ["announcements"] });
      setShowNew(false);
      setForm({ title: "", body: "", severity: "info" });
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Failed to publish"),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => announcementApi.update(id, { active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["announcements"] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => announcementApi.delete(id),
    onSuccess: () => {
      toast.success("Announcement deleted");
      qc.invalidateQueries({ queryKey: ["announcements"] });
    },
  });

  const items = data?.data?.announcements ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Announcements</h2>
          <p className="text-sm text-muted-foreground mt-1">Broadcast a banner to every org's dashboard</p>
        </div>
        <button onClick={() => setShowNew(true)} className="flex items-center gap-2 bg-primary hover:bg-brand-600 text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          <Plus className="w-4 h-4" /> New Announcement
        </button>
      </div>

      <div className="bg-card rounded-xl border border-border shadow-sm divide-y divide-border">
        {isLoading ? (
          [...Array(3)].map((_, i) => <div key={i} className="h-20 animate-pulse bg-muted/40" />)
        ) : items.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Megaphone className="w-8 h-8 mx-auto mb-2 opacity-30" />
            No announcements yet
          </div>
        ) : items.map((a: any) => {
          const Icon = SEVERITY_ICON[a.severity] ?? Info;
          return (
            <div key={a.id} className="px-5 py-4 flex items-start gap-4">
              <div className={cn("p-2 rounded-lg flex-shrink-0", SEVERITY_COLOR[a.severity])}>
                <Icon className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-foreground">{a.title}</p>
                {a.body && <p className="text-sm text-muted-foreground mt-0.5">{a.body}</p>}
                <p className="text-xs text-[#6B6B6B] mt-1">Created {formatDateTime(a.created_at)}</p>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <button
                  onClick={() => toggleMut.mutate({ id: a.id, active: !a.active })}
                  className={cn("text-xs font-medium px-2.5 py-1 rounded-full", a.active ? "bg-green-500/10 text-green-400" : "bg-muted text-muted-foreground")}
                >
                  {a.active ? "Active" : "Inactive"}
                </button>
                <button onClick={() => deleteMut.mutate(a.id)} className="p-1.5 hover:bg-red-500/10 rounded text-muted-foreground hover:text-red-400">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setShowNew(false)}>
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="font-semibold text-foreground">New Announcement</h3>
              <button onClick={() => setShowNew(false)} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); createMut.mutate(form); }} className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Title *</label>
                <input required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  className="w-full border border-border bg-background rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Message</label>
                <textarea rows={3} value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                  className="w-full border border-border bg-background rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Severity</label>
                <select value={form.severity} onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value }))}
                  className="w-full border border-border bg-background rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
                  <option value="info">Info</option>
                  <option value="warning">Warning</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
              <button type="submit" disabled={createMut.isPending}
                className="w-full bg-primary text-primary-foreground py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60">
                {createMut.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Publish
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
