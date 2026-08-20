"use client";

import { useState } from "react";
import Link from "next/link";
import { Shield, Loader2, ArrowLeft, MailCheck } from "lucide-react";
import { authApi } from "@/lib/api";
import { toast } from "sonner";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [devResetUrl, setDevResetUrl] = useState<string | null>(null);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await authApi.forgotPassword(email);
      if (res.data?.reset_token) {
        setDevResetUrl(`/reset-password?token=${encodeURIComponent(res.data.reset_token)}`);
      }
      setSent(true);
      toast.success("If an account exists for that email, reset instructions are on the way.");
    } catch {
      // Always show the generic success state — avoids leaking which emails exist.
      setSent(true);
      toast.success("If an account exists for that email, reset instructions are on the way.");
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
          <p className="text-muted-foreground mt-1">Company Security Console</p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-8 shadow-2xl">
          {sent ? (
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 bg-brand-500/10 rounded-full mb-4">
                <MailCheck className="w-6 h-6 text-brand-500" />
              </div>
              <h2 className="text-lg font-semibold text-foreground mb-2">Check your email</h2>
              <p className="text-sm text-muted-foreground mb-6">
                If an account exists for <span className="text-foreground">{email}</span>, we've sent reset
                instructions.
              </p>
              {devResetUrl && (
                <div className="bg-brand-500/10 border border-brand-500/30 rounded-lg p-3 mb-6 text-left">
                  <p className="text-xs text-brand-500 font-medium mb-1">Dev mode — email isn't wired up yet:</p>
                  <Link href={devResetUrl} className="text-xs text-brand-500 underline break-all">
                    {devResetUrl}
                  </Link>
                </div>
              )}
              <Link href="/login" className="text-sm text-brand-500 hover:text-brand-400 font-medium">
                Back to sign in
              </Link>
            </div>
          ) : (
            <>
              <h2 className="text-xl font-semibold text-foreground mb-1">Reset your password</h2>
              <p className="text-sm text-muted-foreground mb-6">
                Enter your email and we'll send you reset instructions.
              </p>

              {error && (
                <div className="bg-red-500/10 border border-red-500/30 text-danger rounded-lg px-4 py-3 mb-4 text-sm">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-1">Email address</label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => { setEmail(e.target.value); setError(""); }}
                    className={
                      "w-full rounded-lg bg-background px-3 py-2.5 text-sm outline-none transition-colors border " +
                      (error ? "border-red-500 focus:border-red-500" : "border-border/60 focus:border-brand-500")
                    }
                    placeholder="you@company.com"
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-primary hover:bg-brand-600 text-primary-foreground font-medium py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {loading ? "Sending..." : "Send reset instructions"}
                </button>
              </form>

              <Link
                href="/login"
                className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mt-6"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back to sign in
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
