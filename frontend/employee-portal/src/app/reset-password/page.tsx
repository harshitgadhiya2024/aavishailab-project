"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Shield, Eye, EyeOff, Loader2, CheckCircle2 } from "lucide-react";
import { portalApi } from "@/lib/api";
import { toast } from "sonner";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const inputClass =
    "w-full rounded-lg bg-background px-3 py-2.5 text-sm outline-none transition-colors border " +
    (error ? "border-red-500 focus:border-red-500" : "border-border/60 focus:border-brand-500");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!token) {
      const message = "This reset link is missing its token. Please request a new one.";
      setError(message);
      toast.error(message);
      return;
    }
    if (password !== confirmPassword) {
      const message = "Passwords do not match";
      setError(message);
      toast.error(message);
      return;
    }
    if (password.length < 8) {
      const message = "Password must be at least 8 characters";
      setError(message);
      toast.error(message);
      return;
    }

    setLoading(true);
    try {
      await portalApi.resetPassword({ token, new_password: password });
      setDone(true);
      toast.success("Password reset successfully");
    } catch (err: any) {
      const message = err.response?.data?.error || "This reset link is invalid or has expired.";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative flex items-center justify-center p-6 bg-gradient-to-br from-brand-tint via-brand-tint-soft to-background overflow-hidden">
      <div className="absolute inset-0 opacity-20 pointer-events-none [background-image:radial-gradient(circle_at_20%_20%,#FF7000,transparent_35%),radial-gradient(circle_at_80%_70%,#FF7000,transparent_35%)]" />

      <div className="relative w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-brand-500 rounded-2xl mb-4">
            <Shield className="w-8 h-8 text-on-brand" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Delsecure</h1>
          <p className="text-muted-foreground mt-1">Employee Security Portal</p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-8 shadow-2xl">
          {done ? (
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 bg-brand-500/10 rounded-full mb-4">
                <CheckCircle2 className="w-6 h-6 text-brand-500" />
              </div>
              <h2 className="text-lg font-semibold text-foreground mb-2">Password reset</h2>
              <p className="text-sm text-muted-foreground mb-6">You can now sign in with your new password.</p>
              <Link
                href="/login"
                className="inline-block w-full bg-primary hover:bg-brand-600 text-primary-foreground font-medium py-2.5 rounded-lg transition-colors"
              >
                Go to sign in
              </Link>
            </div>
          ) : (
            <>
              <h2 className="text-xl font-semibold text-foreground mb-1">Set a new password</h2>
              <p className="text-sm text-muted-foreground mb-6">Choose a new password for your account.</p>

              {error && (
                <div className="bg-red-500/10 border border-red-500/30 text-danger rounded-lg px-4 py-3 mb-4 text-sm">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-1">New password</label>
                  <div className="relative">
                    <input
                      type={showPass ? "text" : "password"}
                      value={password}
                      onChange={e => { setPassword(e.target.value); setError(""); }}
                      className={`${inputClass} pr-10`}
                      placeholder="At least 8 characters"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass(!showPass)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-1">Confirm password</label>
                  <input
                    type={showPass ? "text" : "password"}
                    value={confirmPassword}
                    onChange={e => { setConfirmPassword(e.target.value); setError(""); }}
                    className={inputClass}
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-primary hover:bg-brand-600 text-primary-foreground font-medium py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {loading ? "Resetting..." : "Reset password"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
