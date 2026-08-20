"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { Shield, Eye, EyeOff, Loader2, CheckCircle2, KeyRound } from "lucide-react";
import { portalApi } from "@/lib/api";
import { toast } from "sonner";

const FEATURES = [
  "One-click install for Mac, Windows & Linux",
  "See exactly what was blocked and why",
  "Track your device's compliance status",
  "Your personal activity, kept private by design",
];

export default function RegisterPage() {
  const [companyCode, setCompanyCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const inputClass =
    "w-full rounded-lg bg-background px-3 py-2.5 text-sm outline-none transition-colors border " +
    (error ? "border-red-500 focus:border-red-500" : "border-border/60 focus:border-brand-500");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!acceptedPrivacy) {
      const message = "Please accept the Privacy Policy to continue.";
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
      await portalApi.signup({ company_code: companyCode, email, password });
      toast.success("Account activated successfully");

      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
        callbackUrl: "/dashboard",
      });

      if (result?.ok) {
        window.location.href = result.url || "/dashboard";
        return;
      }
      setLoading(false);
      window.location.href = "/login";
    } catch (err: any) {
      setLoading(false);
      const message = err.response?.data?.error || "Could not activate your account. Please try again.";
      setError(message);
      toast.error(message);
    }
  };

  return (
    <div className="min-h-screen relative flex bg-gradient-to-br from-brand-tint via-brand-tint-soft to-background overflow-hidden">
      <div className="absolute inset-0 opacity-20 pointer-events-none [background-image:radial-gradient(circle_at_20%_20%,#FF7000,transparent_35%),radial-gradient(circle_at_80%_70%,#FF7000,transparent_35%)]" />

      <div className="hidden lg:flex lg:w-1/2 relative flex-col justify-between p-12">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-brand-500 rounded-xl flex items-center justify-center">
            <Shield className="w-6 h-6 text-on-brand" />
          </div>
          <span className="font-bold text-xl text-foreground">Delsecure</span>
        </div>

        <div className="space-y-8">
          <div>
            <h1 className="text-4xl font-bold text-foreground leading-tight">Activate your account</h1>
            <p className="text-muted-foreground mt-4 text-base">
              Your IT administrator has already added you to Delsecure —
              set your password to get started.
            </p>
          </div>

          <ul className="space-y-3">
            {FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-3 text-sm text-body">
                <CheckCircle2 className="w-5 h-5 text-brand-500 flex-shrink-0 mt-0.5" />
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-subtle">© 2026 Delsecure. Your device traffic is protected by company policy.</p>
      </div>

      <div className="w-full lg:w-1/2 relative flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md">
          <div className="lg:hidden text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-brand-500 rounded-2xl mb-4">
              <Shield className="w-8 h-8 text-on-brand" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">Delsecure</h1>
            <p className="text-muted-foreground mt-1">Employee Security Portal</p>
          </div>

          <div className="bg-card border border-border rounded-2xl p-8 shadow-2xl">
            <h2 className="text-xl font-semibold text-foreground mb-1">Activate your account</h2>
            <p className="text-sm text-muted-foreground mb-6">
              Your IT administrator must have already added you. Set your password below.
            </p>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 text-danger rounded-lg px-4 py-3 mb-4 text-sm">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Company code</label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={companyCode}
                    onChange={e => { setCompanyCode(e.target.value); setError(""); }}
                    className={`${inputClass} pl-9 pr-3`}
                    placeholder="Provided by your IT administrator"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Work email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => { setEmail(e.target.value); setError(""); }}
                  className={inputClass}
                  placeholder="you@company.com"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Choose a password</label>
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

              <label className="flex items-start gap-2 text-xs text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={acceptedPrivacy}
                  onChange={e => setAcceptedPrivacy(e.target.checked)}
                  className="mt-0.5 w-3.5 h-3.5 rounded border-border accent-brand-500"
                  required
                />
                <span>
                  I accept the{" "}
                  <Link href="/privacy" target="_blank" className="text-brand-500 hover:text-brand-400 underline">
                    Privacy Policy
                  </Link>
                </span>
              </label>

              <button
                type="submit"
                disabled={loading || !acceptedPrivacy}
                className="w-full bg-primary hover:bg-brand-600 text-primary-foreground font-medium py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                {loading ? "Activating..." : "Activate Account"}
              </button>
            </form>

            <p className="text-center text-sm text-muted-foreground mt-6">
              Already activated?{" "}
              <Link href="/login" className="text-brand-500 hover:text-brand-400 font-medium">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
