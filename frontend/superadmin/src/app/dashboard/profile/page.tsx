"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useMutation } from "@tanstack/react-query";
import { authApi } from "@/lib/api";
import { User, Lock, Loader2, Check } from "lucide-react";
import { toast } from "sonner";
import { getInitials } from "@/lib/utils";

export default function ProfilePage() {
  const { data: session, update: updateSession } = useSession();
  const user = (session as any)?.user;

  const [pwForm, setPwForm] = useState({ current_password: "", new_password: "", confirm: "" });
  const [pwError, setPwError] = useState("");

  const changePwMut = useMutation({
    mutationFn: authApi.changePassword,
    onSuccess: () => {
      toast.success("Password changed successfully");
      setPwForm({ current_password: "", new_password: "", confirm: "" });
      setPwError("");
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Failed to change password"),
  });

  const handleChangePw = (e: React.FormEvent) => {
    e.preventDefault();
    if (pwForm.new_password !== pwForm.confirm) {
      setPwError("Passwords do not match");
      return;
    }
    if (pwForm.new_password.length < 8) {
      setPwError("Password must be at least 8 characters");
      return;
    }
    setPwError("");
    changePwMut.mutate({ current_password: pwForm.current_password, new_password: pwForm.new_password });
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Profile</h2>
        <p className="text-sm text-muted-foreground mt-1">Your account information</p>
      </div>

      {/* Profile info */}
      <div className="bg-card rounded-xl border border-border shadow-sm p-6">
        <div className="flex items-center gap-5 mb-6">
          <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center text-primary-foreground text-xl font-bold">
            {getInitials(user?.full_name || user?.name || "SA")}
          </div>
          <div>
            <p className="text-xl font-semibold text-foreground">{user?.full_name || user?.name || "Super Admin"}</p>
            <p className="text-sm text-muted-foreground">{user?.email || session?.user?.email}</p>
            <span className="inline-block mt-1 px-2.5 py-0.5 bg-brand-500/10 text-brand-500 text-xs font-medium rounded-full">
              Superadmin
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">First Name</label>
            <p className="text-sm text-foreground bg-muted rounded-lg px-3 py-2.5">{user?.first_name || "—"}</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Last Name</label>
            <p className="text-sm text-foreground bg-muted rounded-lg px-3 py-2.5">{user?.last_name || "—"}</p>
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-muted-foreground mb-1">Email</label>
            <p className="text-sm text-foreground bg-muted rounded-lg px-3 py-2.5">{user?.email || session?.user?.email}</p>
          </div>
        </div>
      </div>

      {/* Change password */}
      <div className="bg-card rounded-xl border border-border shadow-sm p-6">
        <div className="flex items-center gap-2 mb-5">
          <Lock className="w-4 h-4 text-muted-foreground" />
          <h3 className="font-semibold text-foreground">Change Password</h3>
        </div>

        <form onSubmit={handleChangePw} className="space-y-4">
          {pwError && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-3">
              {pwError}
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Current Password *</label>
            <input
              type="password"
              value={pwForm.current_password}
              onChange={e => setPwForm(f => ({ ...f, current_password: e.target.value }))}
              className="w-full border border-border bg-background rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">New Password *</label>
            <input
              type="password"
              value={pwForm.new_password}
              onChange={e => setPwForm(f => ({ ...f, new_password: e.target.value }))}
              className="w-full border border-border bg-background rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              required
              minLength={8}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Confirm New Password *</label>
            <input
              type="password"
              value={pwForm.confirm}
              onChange={e => setPwForm(f => ({ ...f, confirm: e.target.value }))}
              className="w-full border border-border bg-background rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              required
            />
          </div>
          <button
            type="submit"
            disabled={changePwMut.isPending}
            className="flex items-center gap-2 bg-primary hover:bg-brand-600 text-primary-foreground px-5 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-60"
          >
            {changePwMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Update Password
          </button>
        </form>
      </div>
    </div>
  );
}
