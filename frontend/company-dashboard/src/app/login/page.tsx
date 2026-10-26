"use client";

import { useState, useEffect } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { ArrowRight, Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import { otpApi } from "@/lib/api";
import {
  AUTH_ARROW, AUTH_BUTTON, AUTH_CHECK, AUTH_HINT, AUTH_LABEL, AUTH_LINK, AUTH_SOCIAL,
  AppleIcon, AuthDivider, AuthError, AuthHeading, AuthShell, GoogleIcon, PasswordInput,
  authCodeInput, authInput,
} from "@/components/brand/AuthShell";

const SOCIAL_ERRORS: Record<string, string> = {
  NoAccountFound: "No account found for that email. Please register first.",
  NoEmailFromProvider: "Your Google/Apple account didn't share an email address.",
};

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
  const [loading, setLoading] = useState<"" | "credentials" | "google" | "apple">("");
  const [error, setError] = useState("");
  // Second-factor step: set once the password has been accepted.
  const [mfaToken, setMfaToken] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaSetupNeeded, setMfaSetupNeeded] = useState(false);
  // Emailed-code step: used instead of the authenticator when 2FA is off.
  const [otpToken, setOtpToken] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpEmail, setOtpEmail] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const [resending, setResending] = useState(false);

  useEffect(() => {
    const err = new URLSearchParams(window.location.search).get("error");
    if (err) {
      const message = SOCIAL_ERRORS[err] || err;
      setError(message);
      toast.error(message);
    }
  }, []);

  // Matches the server's 45-second resend cooldown.
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn(n => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

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
    // A stale ?error= from an earlier redirect would otherwise reappear behind
    // whatever happens next.
    if (window.location.search.includes("error=")) {
      window.history.replaceState(null, "", window.location.pathname);
    }
    // Only the fields we actually have: next-auth turns an undefined value
    // into the string "undefined", which the server would read as a real code.
    const credentials: Record<string, string> = { email, password };
    if (mfaToken && mfaCode) {
      credentials.mfaToken = mfaToken;
      credentials.mfaCode = mfaCode;
    }
    if (otpToken && otpCode) {
      credentials.otpToken = otpToken;
      credentials.otpCode = otpCode;
    }

    const result = await signIn("credentials", {
      ...credentials,
      redirect: false,
      callbackUrl: "/dashboard",
    });
    setLoading("");
    if (result?.ok) {
      toast.success("Signed in successfully");
      window.location.href = result.url || "/dashboard";
      return;
    }

    // The password was right; the account needs its second factor. Switch the
    // form to the code step rather than reporting a failure.
    const raw = result?.error ?? "";
    if (raw.startsWith("MFA_REQUIRED:") || raw.startsWith("MFA_SETUP_REQUIRED:")) {
      const [kind, token] = raw.split(":");
      setMfaToken(token ?? "");
      setMfaSetupNeeded(kind === "MFA_SETUP_REQUIRED");
      setMfaCode("");
      setError("");
      if (kind === "MFA_SETUP_REQUIRED") {
        toast.error("Your organization requires two-factor authentication — ask an administrator to help you enrol.");
      }
      return;
    }

    // No authenticator on the account — the server emailed a code instead.
    if (raw.startsWith("OTP_REQUIRED:")) {
      const [, rest = ""] = raw.split("OTP_REQUIRED:");
      const [token, masked = ""] = rest.split("|");
      setOtpToken(token ?? "");
      setOtpEmail(masked);
      setOtpCode("");
      setResendIn(45);
      setError("");
      toast.success(`We emailed a 6-digit code to ${masked || "your address"}.`);
      return;
    }

    if (otpToken) {
      const message = raw || "That code is not valid or has expired.";
      setError(message);
      toast.error(message);
      return;
    }

    const message = raw ||
      (mfaToken
        ? "That code is not valid. Check your authenticator app and try again."
        : "Invalid credentials. Please check your email and password.");
    setError(message);
    toast.error(message);
  };

  const backToPassword = () => {
    setMfaToken("");
    setMfaCode("");
    setMfaSetupNeeded(false);
    setOtpToken("");
    setOtpCode("");
    setOtpEmail("");
    setResendIn(0);
    setError("");
  };

  const resendCode = async () => {
    if (resendIn > 0 || resending) return;
    setResending(true);
    try {
      await otpApi.resendLogin(otpToken);
      setResendIn(45);
      toast.success("A new code is on its way.");
    } catch (err: any) {
      const message = err?.response?.data?.error || "Could not send a new code.";
      toast.error(message);
      // The challenge itself lapsed — the password step has to run again.
      if (err?.response?.data?.code === "OTP_CHALLENGE_EXPIRED") backToPassword();
    } finally {
      setResending(false);
    }
  };

  const handleSocial = (provider: "google" | "apple") => {
    if (!acceptedPrivacy) {
      const message = "Please accept the Privacy Policy to continue.";
      setError(message);
      toast.error(message);
      return;
    }
    setLoading(provider);
    signIn(provider, { callbackUrl: "/dashboard" });
  };

  const verifying = !!mfaToken || !!otpToken;

  return (
    <AuthShell
      topRight={<>New to Aavishield?{" "}<Link href="/register" className={`font-medium ${AUTH_LINK}`}>Register</Link></>}
    >
      <AuthHeading
        eyebrow={verifying ? "Step 2 · Verify" : "Company console"}
        title={mfaToken ? "Two-factor authentication" : otpToken ? "Check your email" : "Sign in to Aavishield"}
      >
        {mfaToken
          ? mfaSetupNeeded
            ? "Your organization requires a second factor on every account."
            : "Enter the 6-digit code from your authenticator app."
          : otpToken
            ? <>We sent a 6-digit code to <span className="font-medium text-[#3f3f46]">{otpEmail || "your email address"}</span>. It expires in 10 minutes.</>
            : "Welcome back. Sign in to manage your devices and policies."}
      </AuthHeading>

      {error && <AuthError>{error}</AuthError>}

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
                onChange={e => { setOtpCode(e.target.value.replace(/\D/g, "")); setError(""); }}
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
        ) : mfaToken ? (
          mfaSetupNeeded ? (
            <div className="rounded-[4px] border border-brand-500/30 bg-[#fff1e5] px-4 py-3 text-sm text-[#3f3f46]">
              <p className="mb-1 font-medium text-[#0b0b0d]">Enrolment needed</p>
              <p className="text-[#5d5d66]">
                An administrator must set up two-factor authentication on your account before you can
                sign in. Ask them to add it from Team &amp; Access, then try again.
              </p>
              <button type="button" onClick={backToPassword} className={`mt-3 text-[13px] ${AUTH_LINK}`}>
                ← Back to sign in
              </button>
            </div>
          ) : (
            <>
              <div>
                <label htmlFor="mfa" className={AUTH_LABEL}>Authentication code</label>
                <input
                  id="mfa"
                  autoFocus
                  inputMode="text"
                  autoComplete="one-time-code"
                  value={mfaCode}
                  onChange={e => { setMfaCode(e.target.value); setError(""); }}
                  className={authCodeInput(!!error)}
                  placeholder="000000"
                  required
                />
                <p className={AUTH_HINT}>Lost your device? Enter one of your recovery codes instead.</p>
              </div>
              <button type="button" onClick={backToPassword} className={`text-[13px] ${AUTH_LINK}`}>
                ← Use a different account
              </button>
            </>
          )
        ) : (
          <>
            <div>
              <label htmlFor="email" className={AUTH_LABEL}>Work email</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={e => { setEmail(e.target.value); setError(""); }}
                className={authInput(!!error)}
                placeholder="you@company.com"
                required
              />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label htmlFor="password" className="block text-sm font-medium text-[#0b0b0d]">Password</label>
                <Link href="/forgot-password" className={`text-[13px] ${AUTH_LINK}`}>
                  Forgot password?
                </Link>
              </div>
              <PasswordInput
                id="password"
                autoComplete="current-password"
                value={password}
                onChange={v => { setPassword(v); setError(""); }}
                show={showPass}
                onToggle={() => setShowPass(!showPass)}
                error={!!error}
                placeholder="Your password"
              />
            </div>

            <label className="flex cursor-pointer items-start gap-2.5 text-[13px] text-[#5d5d66]">
              <input
                type="checkbox"
                checked={acceptedPrivacy}
                onChange={e => setAcceptedPrivacy(e.target.checked)}
                className={AUTH_CHECK}
                required
              />
              <span>
                I accept the{" "}
                <Link href="/privacy" target="_blank" className={`underline underline-offset-2 ${AUTH_LINK}`}>
                  Privacy Policy
                </Link>
              </span>
            </label>
          </>
        )}

        {!mfaSetupNeeded && (
          <button
            type="submit"
            disabled={
              loading !== "" ||
              (!verifying && !acceptedPrivacy) ||
              (!!mfaToken && !mfaCode.trim()) ||
              (!!otpToken && otpCode.trim().length < 6)
            }
            className={AUTH_BUTTON}
          >
            {loading === "credentials" && <Loader2 className="h-4 w-4 animate-spin" />}
            {loading === "credentials"
              ? (verifying ? "Verifying..." : "Signing in...")
              : (verifying ? "Verify and sign in" : "Sign in")}
            {loading !== "credentials" && <ArrowRight className={AUTH_ARROW} />}
          </button>
        )}
      </form>

      {!verifying && (
        <>
          <AuthDivider />
          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={() => handleSocial("google")} disabled={loading !== ""} className={AUTH_SOCIAL}>
              {loading === "google" ? <Loader2 className="h-4 w-4 animate-spin" /> : <GoogleIcon className="h-4 w-4" />}
              Google
            </button>
            <button type="button" onClick={() => handleSocial("apple")} disabled={loading !== ""} className={AUTH_SOCIAL}>
              {loading === "apple" ? <Loader2 className="h-4 w-4 animate-spin" /> : <AppleIcon className="h-4 w-4" />}
              Apple
            </button>
          </div>
        </>
      )}
    </AuthShell>
  );
}
