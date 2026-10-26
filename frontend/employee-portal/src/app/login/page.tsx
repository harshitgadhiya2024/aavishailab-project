"use client";

import { useState, useEffect } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  AUTH_ARROW, AUTH_BUTTON, AUTH_CHECK, AUTH_LABEL, AUTH_LINK,
  AuthError, AuthHeading, AuthShell, PasswordInput, authInput,
} from "@/components/brand/AuthShell";

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

  return (
    <AuthShell
      topRight={<>First time here?{" "}<Link href="/register" className={`font-medium ${AUTH_LINK}`}>Activate account</Link></>}
    >
      <AuthHeading eyebrow="Employee portal" title="Sign in to Aavishield">
        Use the work email your IT administrator added you with.
      </AuthHeading>

      {error && <AuthError>{error}</AuthError>}

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
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
            <label htmlFor="password" className="block text-sm font-medium text-[#0b0b0d]">Portal password</label>
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

        <button type="submit" disabled={loading !== "" || !acceptedPrivacy} className={AUTH_BUTTON}>
          {loading === "credentials" && <Loader2 className="h-4 w-4 animate-spin" />}
          {loading === "credentials" ? "Signing in..." : "Sign in"}
          {loading !== "credentials" && <ArrowRight className={AUTH_ARROW} />}
        </button>
      </form>
    </AuthShell>
  );
}
