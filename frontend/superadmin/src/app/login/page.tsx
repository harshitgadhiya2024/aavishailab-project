"use client";

import { useState, useEffect } from "react";
import { signIn } from "next-auth/react";
import { Shield, Eye, EyeOff, Loader2, CheckCircle2, Mail } from "lucide-react";
import { otpApi } from "@/lib/api";

const FEATURES = [
  "Oversee every organization's security posture",
  "Provision and manage admin accounts",
  "Platform-wide activity & audit visibility",
  "Global policy templates & controls",
];

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // Emailed 6-digit code step — every superadmin sign-in gets one, since
  // there's no authenticator-app enrolment for this panel.
  const [otpToken, setOtpToken] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpEmail, setOtpEmail] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const [resending, setResending] = useState(false);

  useEffect(() => {
    const err = new URLSearchParams(window.location.search).get("error");
    if (err) setError(err);
  }, []);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const backToPassword = () => {
    setOtpToken("");
    setOtpCode("");
    setOtpEmail("");
    setResendIn(0);
    setError("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const credentials: Record<string, string> = { email, password };
    if (otpToken && otpCode) {
      credentials.otpToken = otpToken;
      credentials.otpCode = otpCode;
    }

    const result = await signIn("credentials", {
      ...credentials,
      redirect: false,
      callbackUrl: "/dashboard",
    });

    setLoading(false);

    if (result?.ok) {
      window.location.href = result.url || "/dashboard";
      return;
    }

    const raw = result?.error || "";

    // The password was right; the account's second factor is a mailed code.
    if (raw.startsWith("OTP_REQUIRED:")) {
      const [, rest = ""] = raw.split("OTP_REQUIRED:");
      const [token, masked = ""] = rest.split("|");
      setOtpToken(token ?? "");
      setOtpEmail(masked);
      setOtpCode("");
      setResendIn(45);
      setError("");
      return;
    }

    if (raw.startsWith("MFA_REQUIRED:")) {
      setError("This account has an authenticator app enrolled, which the superadmin console doesn't support signing in with yet. Disable it on the account or sign in from the company dashboard instead.");
      return;
    }

    if (otpToken) {
      setError(raw || "That code is not valid or has expired.");
      return;
    }

    setError(raw || "Invalid credentials");
  };

  const resendCode = async () => {
    if (resendIn > 0 || resending) return;
    setResending(true);
    try {
      await otpApi.resendLogin(otpToken);
      setResendIn(45);
    } catch (err: any) {
      const message = err?.response?.data?.error || "Could not send a new code.";
      setError(message);
      if (err?.response?.data?.code === "OTP_CHALLENGE_EXPIRED") backToPassword();
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-screen relative flex bg-gradient-to-br from-[#2B1000] via-[#140800] to-[#0A0A0A] overflow-hidden">
      <div className="absolute inset-0 opacity-20 pointer-events-none [background-image:radial-gradient(circle_at_20%_20%,#FF7000,transparent_35%),radial-gradient(circle_at_80%_70%,#FF7000,transparent_35%)]" />

      {/* Left — brand content, sits on the same background as the form */}
      <div className="hidden lg:flex lg:w-1/2 relative flex-col justify-between p-12">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-brand-500 rounded-xl flex items-center justify-center">
            <Shield className="w-6 h-6 text-[#0A0A0A]" />
          </div>
          <span className="font-bold text-xl text-white">Delsecure</span>
        </div>

        <div className="space-y-8">
          <div>
            <h1 className="text-4xl font-bold text-white leading-tight">
              Manage every organization from one place
            </h1>
            <p className="text-[#A3A3A3] mt-4 text-base">
              The platform-wide control plane for Delsecure — organizations,
              admins, and global policy, all in one console.
            </p>
          </div>

          <ul className="space-y-3">
            {FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-3 text-sm text-[#D4D4D4]">
                <CheckCircle2 className="w-5 h-5 text-brand-500 flex-shrink-0 mt-0.5" />
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-[#6B6B6B]">© 2026 Delsecure. Zero Trust Security Platform.</p>
      </div>

      {/* Right — form, no separate background block */}
      <div className="w-full lg:w-1/2 relative flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md">
          <div className="lg:hidden text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-brand-500 rounded-2xl mb-4">
              <Shield className="w-8 h-8 text-[#0A0A0A]" />
            </div>
            <h1 className="text-2xl font-bold text-white">Delsecure</h1>
            <p className="text-[#A3A3A3] mt-1">Superadmin Console</p>
          </div>

          <div className="bg-card/95 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl">
            <h2 className="text-xl font-semibold text-foreground mb-1">
              {otpToken ? "Check your email" : "Sign in to your account"}
            </h2>
            {otpToken && (
              <p className="text-sm text-muted-foreground mb-5">
                We sent a 6-digit code to <span className="text-foreground font-medium">{otpEmail || "your email address"}</span>. It expires in 10 minutes.
              </p>
            )}
            {!otpToken && <div className="mb-6" />}

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg px-4 py-3 mb-4 text-sm">
                {error === "SuperadminAccessRequired"
                  ? "Please sign in with a superadmin account. Company dashboard sessions are not valid here."
                  : error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {otpToken ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-muted-foreground mb-1">
                      Verification code
                    </label>
                    <input
                      autoFocus
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={otpCode}
                      onChange={(e) => { setOtpCode(e.target.value.replace(/\D/g, "")); setError(""); }}
                      className="w-full border border-border bg-background rounded-lg px-3 py-2.5 text-sm tracking-[0.3em] text-center text-lg font-mono focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                      placeholder="000000"
                      required
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <button type="button" onClick={backToPassword} className="text-xs text-brand-500 hover:text-brand-400">
                      ← Use a different account
                    </button>
                    <button
                      type="button"
                      onClick={resendCode}
                      disabled={resendIn > 0 || resending}
                      className="inline-flex items-center gap-1.5 text-xs text-brand-500 hover:text-brand-400 disabled:text-muted-foreground"
                    >
                      <Mail className="w-3.5 h-3.5" />
                      {resendIn > 0 ? `Resend in ${resendIn}s` : resending ? "Sending..." : "Resend code"}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-muted-foreground mb-1">Email address</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => { setEmail(e.target.value); setError(""); }}
                      className="w-full border border-border bg-background rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                      placeholder="you@company.com"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-muted-foreground mb-1">Password</label>
                    <div className="relative">
                      <input
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => { setPassword(e.target.value); setError(""); }}
                        className="w-full border border-border bg-background rounded-lg px-3 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                        placeholder="••••••••"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </>
              )}

              <button
                type="submit"
                disabled={loading || (!!otpToken && otpCode.trim().length < 6)}
                className="w-full bg-primary hover:bg-brand-600 text-primary-foreground font-medium py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                {loading ? "Signing in..." : otpToken ? "Verify and sign in" : "Sign In"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
