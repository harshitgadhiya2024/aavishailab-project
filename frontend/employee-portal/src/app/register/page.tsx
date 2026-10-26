"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { ArrowRight, KeyRound, Loader2 } from "lucide-react";
import { portalApi } from "@/lib/api";
import { toast } from "sonner";
import {
  AUTH_ARROW, AUTH_BUTTON, AUTH_CHECK, AUTH_LABEL, AUTH_LINK,
  AuthError, AuthHeading, AuthShell, PasswordInput, authInput,
} from "@/components/brand/AuthShell";

export default function RegisterPage() {
  const [companyCode, setCompanyCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
    <AuthShell
      headline="Activate your account."
      lead="Your IT administrator has already added you to Aavishield. Set your password to get started."
      topRight={<>Already activated?{" "}<Link href="/login" className={`font-medium ${AUTH_LINK}`}>Sign in</Link></>}
    >
      <AuthHeading eyebrow="First sign-in" title="Activate your account">
        Your IT administrator must have already added you. Set your password below.
      </AuthHeading>

      {error && <AuthError>{error}</AuthError>}

      <form onSubmit={handleSubmit} className="mt-6 space-y-4 [@media(max-height:800px)]:mt-4 [@media(max-height:800px)]:space-y-3">
        <div>
          <label htmlFor="company" className={AUTH_LABEL}>Company code</label>
          <div className="relative">
            <KeyRound className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#71717a]" />
            <input
              id="company"
              type="text"
              value={companyCode}
              onChange={e => { setCompanyCode(e.target.value); setError(""); }}
              className={`${authInput(!!error)} pl-10`}
              placeholder="Provided by your IT administrator"
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
            <label htmlFor="password" className={AUTH_LABEL}>Choose a password</label>
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

        <button type="submit" disabled={loading || !acceptedPrivacy} className={AUTH_BUTTON}>
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {loading ? "Activating..." : "Activate account"}
          {!loading && <ArrowRight className={AUTH_ARROW} />}
        </button>
      </form>
    </AuthShell>
  );
}
