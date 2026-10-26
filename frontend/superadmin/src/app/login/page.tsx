"use client";

import { useState, useEffect } from "react";
import { signIn } from "next-auth/react";
import { ArrowRight, Loader2, Mail } from "lucide-react";
import { otpApi } from "@/lib/api";
import {
  AUTH_ARROW, AUTH_BUTTON, AUTH_LABEL, AUTH_LINK,
  AuthError, AuthHeading, AuthShell, PasswordInput, authCodeInput, authInput,
} from "@/components/brand/AuthShell";

// Company admins sign in on the company dashboard, not here.
const COMPANY_URL = process.env.NEXT_PUBLIC_COMPANY_URL;

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
    <AuthShell
      topRight={
        COMPANY_URL ? (
          <>Company admin?{" "}<a href={`${COMPANY_URL}/login`} className={`font-medium ${AUTH_LINK}`}>Sign in here</a></>
        ) : undefined
      }
    >
      <AuthHeading
        eyebrow={otpToken ? "Step 2 · Verify" : "Superadmin console"}
        title={otpToken ? "Check your email" : "Sign in to Aavishield"}
      >
        {otpToken
          ? <>We sent a 6-digit code to <span className="font-medium text-[#3f3f46]">{otpEmail || "your email address"}</span>. It expires in 10 minutes.</>
          : "Platform administrators only. Every sign-in is confirmed with an emailed code."}
      </AuthHeading>

      {error && (
        <AuthError>
          {error === "SuperadminAccessRequired"
            ? "Please sign in with a superadmin account. Company dashboard sessions are not valid here."
            : error}
        </AuthError>
      )}

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        {otpToken ? (
          <>
            <div>
              <label htmlFor="otp" className={AUTH_LABEL}>Verification code</label>
              <input
                id="otp"
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={otpCode}
                onChange={(e) => { setOtpCode(e.target.value.replace(/\D/g, "")); setError(""); }}
                className={authCodeInput(!!error)}
                placeholder="000000"
                required
              />
            </div>
            <div className="flex items-center justify-between text-[13px]">
              <button type="button" onClick={backToPassword} className={AUTH_LINK}>
                ← Use a different account
              </button>
              <button
                type="button"
                onClick={resendCode}
                disabled={resendIn > 0 || resending}
                className={`inline-flex items-center gap-1.5 ${AUTH_LINK} disabled:text-[#71717a] disabled:hover:text-[#71717a]`}
              >
                <Mail className="h-3.5 w-3.5" />
                {resendIn > 0 ? `Resend in ${resendIn}s` : resending ? "Sending..." : "Resend code"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div>
              <label htmlFor="email" className={AUTH_LABEL}>Email address</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(""); }}
                className={authInput(!!error)}
                placeholder="you@company.com"
                required
              />
            </div>

            <div>
              <label htmlFor="password" className={AUTH_LABEL}>Password</label>
              <PasswordInput
                id="password"
                autoComplete="current-password"
                value={password}
                onChange={(v) => { setPassword(v); setError(""); }}
                show={showPassword}
                onToggle={() => setShowPassword(!showPassword)}
                error={!!error}
                placeholder="Your password"
              />
            </div>
          </>
        )}

        <button
          type="submit"
          disabled={loading || (!!otpToken && otpCode.trim().length < 6)}
          className={AUTH_BUTTON}
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {loading ? (otpToken ? "Verifying..." : "Signing in...") : otpToken ? "Verify and sign in" : "Sign in"}
          {!loading && <ArrowRight className={AUTH_ARROW} />}
        </button>
      </form>
    </AuthShell>
  );
}
