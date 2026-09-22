"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { portalApi } from "@/lib/api";
import { KeyRound, Loader2, UserRound } from "lucide-react";
import { toast } from "sonner";

const inputClass =
  "w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60";

function Panel({
  title, description, children,
}: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="bg-card rounded-xl border border-border shadow-sm">
      <div className="p-5 border-b border-border">
        <h3 className="font-semibold text-foreground">{title}</h3>
        <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function PasswordPanel() {
  const [form, setForm] = useState({ current_password: "", new_password: "", confirm: "" });
  const [error, setError] = useState("");

  const mut = useMutation({
    mutationFn: portalApi.changePassword,
    onSuccess: () => {
      toast.success("Password changed");
      setForm({ current_password: "", new_password: "", confirm: "" });
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Could not change the password"),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (form.new_password !== form.confirm) return setError("The new passwords don't match");
    if (form.new_password.length < 8) return setError("Use at least 8 characters");
    setError("");
    mut.mutate({ current_password: form.current_password, new_password: form.new_password });
  };

  return (
    <Panel title="Password" description="Choose a new password for signing in to this portal">
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-danger rounded-lg px-3 py-2 mb-4 text-sm">{error}</div>
      )}
      <form onSubmit={submit} className="space-y-4 max-w-md">
        {[
          { key: "current_password", label: "Current password" },
          { key: "new_password", label: "New password" },
          { key: "confirm", label: "Confirm new password" },
        ].map(f => (
          <div key={f.key}>
            <label className="block text-xs font-medium text-body mb-1">{f.label}</label>
            <input
              type="password"
              value={(form as any)[f.key]}
              onChange={e => { setForm(s => ({ ...s, [f.key]: e.target.value })); setError(""); }}
              className={inputClass}
              required
              autoComplete={f.key === "current_password" ? "current-password" : "new-password"}
            />
          </div>
        ))}
        <button
          type="submit"
          disabled={mut.isPending}
          className="flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-on-brand px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60"
        >
          {mut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
          Change password
        </button>
      </form>
    </Panel>
  );
}

export default function ProfilePage() {
  const { data } = useQuery({ queryKey: ["portal-me"], queryFn: () => portalApi.me() });
  const employee = data?.data?.employee ?? {};
  // A social-only account (Google/Apple, no password set) has nothing to
  // change here — ForgotPassword still lets it set one for the first time.
  const hasPassword = employee.has_password !== false;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Profile</h2>
        <p className="text-sm text-muted-foreground mt-1">Your account details for this portal</p>
      </div>

      <Panel title="Account" description="How you're identified to your organization">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-brand-500/10 text-brand-500 flex items-center justify-center flex-shrink-0">
            <UserRound className="w-5 h-5" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">
              {[employee.first_name, employee.last_name].filter(Boolean).join(" ") || "—"}
            </p>
            <p className="text-xs text-muted-foreground">{employee.email ?? "—"}</p>
          </div>
        </div>
      </Panel>

      {hasPassword ? (
        <PasswordPanel />
      ) : (
        <Panel title="Password" description="This account signs in with Google or Apple">
          <p className="text-sm text-muted-foreground">There's no password to change here.</p>
        </Panel>
      )}
    </div>
  );
}
