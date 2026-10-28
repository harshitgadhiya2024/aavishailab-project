"use client";

import { useState, useEffect } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { ArrowRight, Building2, Loader2, Mail } from "lucide-react";
import { otpApi } from "@/lib/api";
import { toast } from "sonner";
import {
  AUTH_ARROW, AUTH_BUTTON, AUTH_CHECK, AUTH_HINT, AUTH_LABEL, AUTH_LINK,
  AuthError, AuthHeading, AuthShell, PasswordInput,
  authCodeInput, authInput,
} from "@/components/brand/AuthShell";


export default function RegisterPage() {
  const [companyName, setCompanyName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
  const [loading, setLoading] = useState<"" | "credentials">("");
  const [error, setError] = useState("");
  // Confirmation step: nothing exists server-side until this code is accepted.
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const [resending, setResending] = useState(false);

  useEffect(() => {
    const err = new URLSearchParams(window.location.search).get("error");
    if (err) {
      const message = err;
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

    setLoading("credentials");
    try {
      await otpApi.startRegistration({
        company_name: companyName,
        first_name: firstName,
        last_name: lastName,
        email,
        password,
      });
      setCodeSent(true);
      setCode("");
      setResendIn(45);
      toast.success(`We emailed a 6-digit code to ${email}.`);
    } catch (err: any) {
      const message = err.response?.data?.error || "Could not start registration. Please try again.";
      setError(message);
      toast.error(message);
    } finally {
      setLoading("");
    }
  };

  // The account is created only once the code checks out, and the same call
  // hands back a session — so this lands on the dashboard directly.
  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading("credentials");
    const result = await signIn("credentials", {
      email,
      password,
      regCode: code,
      redirect: false,
      callbackUrl: "/dashboard",
    });
    setLoading("");
    if (result?.ok) {
      toast.success("Your organization is ready");
      window.location.href = result.url || "/dashboard";
      return;
    }
    const message = result?.error || "That code is not valid or has expired.";
    setError(message);
    toast.error(message);
  };

  const resendCode = async () => {
    if (resendIn > 0 || resending) return;
    setResending(true);
    try {
      await otpApi.resendRegistration(email);
      setResendIn(45);
      toast.success("A new code is on its way.");
    } catch (err: any) {
      const message = err?.response?.data?.error || "Could not send a new code.";
      toast.error(message);
    } finally {
      setResending(false);
    }
  };

  const backToDetails = () => {
    setCodeSent(false);
    setCode("");
    setResendIn(0);
    setError("");
  };

  return (
    <AuthShell
      headline="Start your 14-day free trial."
      lead="No credit card required. Set up your organization in minutes and put policy on every device today."
      topRight={<>Already have an account?{" "}<Link href="/login" className={`font-medium ${AUTH_LINK}`}>Sign in</Link></>}
    >
      <AuthHeading
        eyebrow={codeSent ? "Step 2 · Verify" : "Free trial · 14 days"}
        title={codeSent ? "Confirm your email" : "Create your organization"}
      >
        {codeSent
          ? <>We sent a 6-digit code to <span className="font-medium text-[#3f3f46]">{email}</span>. Your organization is created once you enter it.</>
          : "No credit card required."}
      </AuthHeading>

      {error && <AuthError>{error}</AuthError>}

      {codeSent ? (
        <form onSubmit={handleVerify} className="mt-6 space-y-4">
          <div>
            <label htmlFor="code" className={AUTH_LABEL}>Verification code</label>
            <input
              id="code"
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={e => { setCode(e.target.value.replace(/\D/g, "")); setError(""); }}
              className={authCodeInput(!!error)}
              placeholder="000000"
              required
            />
            <p className={AUTH_HINT}>The code expires in 10 minutes.</p>
          </div>

          <div className="flex items-center justify-between text-[13px]">
            <button type="button" onClick={backToDetails} className={AUTH_LINK}>
              ← Edit your details
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

          <button type="submit" disabled={loading !== "" || code.trim().length < 6} className={AUTH_BUTTON}>
            {loading === "credentials" && <Loader2 className="h-4 w-4 animate-spin" />}
            {loading === "credentials" ? "Creating account..." : "Verify and create account"}
            {loading !== "credentials" && <ArrowRight className={AUTH_ARROW} />}
          </button>
        </form>
      ) : (
        <>
          <form onSubmit={handleSubmit} className="mt-6 space-y-4 [@media(max-height:800px)]:mt-4 [@media(max-height:800px)]:space-y-3">
            <div>
              <label htmlFor="company" className={AUTH_LABEL}>Company name</label>
              <div className="relative">
                <Building2 className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#71717a]" />
                <input
                  id="company"
                  type="text"
                  autoComplete="organization"
                  value={companyName}
                  onChange={e => { setCompanyName(e.target.value); setError(""); }}
                  className={`${authInput(!!error)} pl-10`}
                  placeholder="Acme Inc."
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="first" className={AUTH_LABEL}>First name</label>
                <input
                  id="first"
                  type="text"
                  autoComplete="given-name"
                  value={firstName}
                  onChange={e => { setFirstName(e.target.value); setError(""); }}
                  className={authInput(!!error)}
                  required
                />
              </div>
              <div>
                <label htmlFor="last" className={AUTH_LABEL}>Last name</label>
                <input
                  id="last"
                  type="text"
                  autoComplete="family-name"
                  value={lastName}
                  onChange={e => { setLastName(e.target.value); setError(""); }}
                  className={authInput(!!error)}
                  required
                />
              </div>
            </div>

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

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="password" className={AUTH_LABEL}>Password</label>
                <PasswordInput
                  id="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={v => { setPassword(v); setError(""); }}
                  show={showPass}
                  onToggle={() => setShowPass(!showPass)}
                  error={!!error}
                  placeholder="8+ characters"
                />
              </div>
              <div>
                <label htmlFor="confirm" className={AUTH_LABEL}>Confirm password</label>
                <input
                  id="confirm"
                  type={showPass ? "text" : "password"}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={e => { setConfirmPassword(e.target.value); setError(""); }}
                  className={authInput(!!error)}
                  required
                />
              </div>
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

            <button type="submit" disabled={loading !== "" || !acceptedPrivacy} className={AUTH_BUTTON}>
              {loading === "credentials" && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading === "credentials" ? "Sending code..." : "Create account"}
              {loading !== "credentials" && <ArrowRight className={AUTH_ARROW} />}
            </button>
          </form>
        </>
      )}
    </AuthShell>
  );
}
