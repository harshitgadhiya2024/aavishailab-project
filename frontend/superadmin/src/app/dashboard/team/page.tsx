"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { teamApi, SuperAdminLevel } from "@/lib/api";
import {
  Plus, ShieldCheck, ShieldQuestion, X, Loader2, UserMinus, Mail,
} from "lucide-react";
import { toast } from "sonner";
import { getInitials, formatDate, cn } from "@/lib/utils";
import { Modal } from "@/components/ui/Modal";

export default function TeamPage() {
  const qc = useQueryClient();
  const { data: session } = useSession();
  const myLevel = session?.user?.superadmin_level ?? "full";
  const myEmail = session?.user?.email;
  const canManage = myLevel === "full";

  const [showInvite, setShowInvite] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [form, setForm] = useState<{ email: string; first_name: string; last_name: string; level: SuperAdminLevel }>({
    email: "", first_name: "", last_name: "", level: "support",
  });
  const [createdPassword, setCreatedPassword] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["superadmin-team"],
    queryFn: teamApi.list,
  });

  const inviteMut = useMutation({
    mutationFn: teamApi.invite,
    onSuccess: (res) => {
      toast.success("Superadmin invited");
      qc.invalidateQueries({ queryKey: ["superadmin-team"] });
      setCreatedPassword(res.data.temporary_password);
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Failed to invite"),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => teamApi.update(id, data),
    onSuccess: () => {
      toast.success("Updated");
      qc.invalidateQueries({ queryKey: ["superadmin-team"] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Failed to update"),
  });

  const removeMut = useMutation({
    mutationFn: teamApi.remove,
    onSuccess: () => {
      toast.success("Access removed");
      qc.invalidateQueries({ queryKey: ["superadmin-team"] });
      setRemoveId(null);
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Failed to remove"),
  });

  const closeInvite = () => {
    setShowInvite(false);
    setForm({ email: "", first_name: "", last_name: "", level: "support" });
    setCreatedPassword(null);
  };

  const team = data?.data?.team ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Team</h2>
          <p className="text-sm text-muted-foreground mt-1">Who has superadmin access to this platform</p>
        </div>
        {canManage && (
          <button
            onClick={() => setShowInvite(true)}
            className="flex items-center gap-2 bg-primary hover:bg-brand-600 text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            Invite Superadmin
          </button>
        )}
      </div>

      {!canManage && (
        <div className="bg-brand-500/10 border border-brand-500/20 rounded-xl p-4 text-sm text-brand-500">
          Your account is support-level — you can view the team but can't invite, change levels, or remove access.
        </div>
      )}

      <div className="bg-card rounded-xl border border-border shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground text-xs uppercase tracking-wide">
                <th className="text-left px-5 py-3 font-medium">Name</th>
                <th className="text-left px-5 py-3 font-medium">Level</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
                <th className="text-left px-5 py-3 font-medium">Joined</th>
                {canManage && <th className="text-right px-5 py-3 font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                [...Array(3)].map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {[...Array(5)].map((__, j) => (
                      <td key={j} className="px-5 py-4"><div className="h-4 bg-muted rounded w-3/4" /></td>
                    ))}
                  </tr>
                ))
              ) : team.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-12 text-[#6B6B6B]">No superadmins found</td></tr>
              ) : team.map((u: any) => {
                const isSelf = u.email === myEmail;
                const isFull = u.superadmin_level === "full";
                return (
                  <tr key={u.id} className="hover:bg-muted transition-colors">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground text-xs font-bold flex-shrink-0">
                          {getInitials(u.full_name || u.email)}
                        </div>
                        <div>
                          <p className="font-medium text-foreground">{u.full_name || "—"} {isSelf && <span className="text-xs text-muted-foreground">(you)</span>}</p>
                          <p className="text-xs text-[#6B6B6B] flex items-center gap-1"><Mail className="w-3 h-3" />{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span className={cn(
                        "flex items-center gap-1.5 w-fit px-2.5 py-1 rounded-full text-xs font-medium",
                        isFull ? "bg-purple-500/10 text-purple-400" : "bg-muted text-muted-foreground"
                      )}>
                        {isFull ? <ShieldCheck className="w-3.5 h-3.5" /> : <ShieldQuestion className="w-3.5 h-3.5" />}
                        {isFull ? "Full access" : "Support (read-only)"}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <span className={cn(
                        "flex items-center gap-1.5 text-xs font-medium",
                        u.status === "active" ? "text-green-400" : "text-red-400"
                      )}>
                        <span className={cn("w-1.5 h-1.5 rounded-full", u.status === "active" ? "bg-green-500" : "bg-red-400")} />
                        {u.status}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-xs text-muted-foreground">{formatDate(u.created_at)}</td>
                    {canManage && (
                      <td className="px-5 py-4">
                        <div className="flex items-center justify-end gap-2">
                          <select
                            value={u.superadmin_level}
                            disabled={updateMut.isPending}
                            onChange={e => updateMut.mutate({ id: u.id, data: { level: e.target.value } })}
                            className="text-xs border border-border bg-background rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-50"
                          >
                            <option value="full">Full</option>
                            <option value="support">Support</option>
                          </select>
                          {!isSelf && (
                            <button
                              onClick={() => setRemoveId(u.id)}
                              className="p-1.5 hover:bg-red-500/10 rounded text-muted-foreground hover:text-red-400"
                              title="Remove access"
                            >
                              <UserMinus className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Invite modal */}
      <Modal open={showInvite} onClose={closeInvite}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h3 className="font-semibold text-foreground">Invite Superadmin</h3>
          <button onClick={closeInvite} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        {createdPassword ? (
          <div className="px-6 py-5 space-y-4">
            <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
              <p className="text-sm text-green-400 font-medium">Invited successfully</p>
              <p className="text-xs text-muted-foreground mt-1">An email with these credentials was sent. This password won't be shown again.</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Temporary Password</label>
              <p className="font-mono text-sm bg-muted rounded-lg px-3 py-2.5 text-foreground">{createdPassword}</p>
            </div>
            <button onClick={closeInvite} className="w-full bg-primary text-primary-foreground py-2 rounded-lg text-sm font-medium">
              Done
            </button>
          </div>
        ) : (
          <form
            onSubmit={(e) => { e.preventDefault(); inviteMut.mutate(form); }}
            className="px-6 py-5 space-y-4"
          >
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">First Name</label>
                <input
                  value={form.first_name}
                  onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))}
                  className="w-full border border-border bg-background rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Last Name</label>
                <input
                  value={form.last_name}
                  onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))}
                  className="w-full border border-border bg-background rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-muted-foreground mb-1">Email *</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  className="w-full border border-border bg-background rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  required
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-muted-foreground mb-1">Access Level</label>
                <select
                  value={form.level}
                  onChange={e => setForm(f => ({ ...f, level: e.target.value as SuperAdminLevel }))}
                  className="w-full border border-border bg-background rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="support">Support — read-only, no destructive actions</option>
                  <option value="full">Full — everything, including deletes</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={closeInvite} className="flex-1 border border-border text-muted-foreground py-2 rounded-lg text-sm hover:bg-muted">
                Cancel
              </button>
              <button
                type="submit"
                disabled={inviteMut.isPending}
                className="flex-1 bg-primary text-primary-foreground py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {inviteMut.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Send Invite
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Remove confirm */}
      <Modal open={!!removeId} onClose={() => setRemoveId(null)} className="max-w-sm">
        <div className="p-6">
          <div className="w-12 h-12 bg-red-500/10 rounded-xl flex items-center justify-center mx-auto mb-4">
            <UserMinus className="w-5 h-5 text-red-400" />
          </div>
          <h3 className="text-center font-semibold text-foreground mb-2">Remove Superadmin Access?</h3>
          <p className="text-center text-sm text-muted-foreground mb-6">
            They'll be immediately signed out and unable to log in again.
          </p>
          <div className="flex gap-3">
            <button onClick={() => setRemoveId(null)} className="flex-1 border border-border text-muted-foreground py-2 rounded-lg text-sm">
              Cancel
            </button>
            <button
              onClick={() => removeId && removeMut.mutate(removeId)}
              disabled={removeMut.isPending}
              className="flex-1 bg-destructive text-destructive-foreground py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {removeMut.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Remove
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
