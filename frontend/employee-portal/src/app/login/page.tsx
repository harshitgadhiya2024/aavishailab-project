"use client";

import { useState, useEffect } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { Shield, Eye, EyeOff, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

const FEATURES = [
  "One-click install for Mac, Windows & Linux",
  "See exactly what was blocked and why",
  "Track your device's compliance status",
  "Your personal activity, kept private by design",
];

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
  const [loading, setLoading] = useState<"" | "credentials">("");
  const [error, setError] = useState("");
  // Where to land after signing in. Kept relative so the parameter can only
  // ever bounce somebody around this portal, never off to another site.
  const [next, setNext] = useState("/dashboard");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const target = params.get("callbackUrl");
    if (target && target.startsWith("/") && !target.startsWith("//")) {
      setNext(target);
    }
    const err = params.get("error");
    if (err) {
      setError(err);
      toast.error(err);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!acceptedPrivacy) {
      const message = "Please accept the Privacy Policy to continue.";
      setError(message);
      toast.error(message);
      return;
    }
    setLoading("credentials");
    setError("");
    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
      callbackUrl: next,
    });
    setLoading("");
    if (result?.ok) {
      toast.success("Signed in successfully");
      window.location.href = result.url || next;
      return;
    }
    const message = result?.error || "Invalid credentials. Contact your IT administrator.";
    setError(message);
    toast.error(message);
  };

  const inputClass =
    "w-full rounded-lg bg-background px-3 py-2.5 text-sm outline-none transition-colors border " +
    (error ? "border-red-500 focus:border-red-500" : "border-border/60 focus:border-brand-500");

  return (
    <div className="min-h-screen relative flex bg-gradient-to-br from-brand-tint via-brand-tint-soft to-background overflow-hidden">
      <div className="absolute inset-0 opacity-20 pointer-events-none [background-image:radial-gradient(circle_at_20%_20%,#FF7000,transparent_35%),radial-gradient(circle_at_80%_70%,#FF7000,transparent_35%)]" />

      {/* Left — brand content */}
      <div className="hidden lg:flex lg:w-1/2 relative flex-col justify-between p-12">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-brand-500 rounded-xl flex items-center justify-center">
            <Shield className="w-6 h-6 text-on-brand" />
          </div>
          <span className="font-bold text-xl text-foreground">Delsecure</span>
        </div>

        <div className="space-y-8">
          <div>
            <h1 className="text-4xl font-bold text-foreground leading-tight">
              Stay protected. Stay productive.
            </h1>
            <p className="text-muted-foreground mt-4 text-base">
              Your company's security portal — install the agent, check your
              device status, and understand what's blocked on your network.
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

      {/* Right — form */}
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
            <h2 className="text-xl font-semibold text-foreground mb-6">Sign in to your account</h2>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 text-danger rounded-lg px-4 py-3 mb-4 text-sm">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
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
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-muted-foreground">Portal password</label>
                  <Link href="/forgot-password" className="text-xs text-brand-500 hover:text-brand-400">
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <input
                    type={showPass ? "text" : "password"}
                    value={password}
                    onChange={e => { setPassword(e.target.value); setError(""); }}
                    className={`${inputClass} pr-10`}
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
                disabled={loading !== "" || !acceptedPrivacy}
                className="w-full bg-primary hover:bg-brand-600 text-primary-foreground font-medium py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {loading === "credentials" && <Loader2 className="w-4 h-4 animate-spin" />}
                {loading === "credentials" ? "Signing in..." : "Sign In"}
              </button>
            </form>

            <p className="text-center text-sm text-muted-foreground mt-6">
              Don't have an account?{" "}
              <Link href="/register" className="text-brand-500 hover:text-brand-400 font-medium">
                Activate account
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
