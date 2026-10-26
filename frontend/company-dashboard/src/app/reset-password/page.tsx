"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Loader2 } from "lucide-react";
import { authApi } from "@/lib/api";
import { toast } from "sonner";
import {
  AUTH_ARROW, AUTH_BUTTON, AUTH_LABEL, AUTH_LINK,
  AuthDoneIcon, AuthError, AuthHeading, AuthShell, PasswordInput, authInput,
} from "@/components/brand/AuthShell";

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
      await authApi.resetPassword({ token, new_password: password });
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
    <AuthShell
      headline="A fresh password, the same protection."
      lead="Choose a strong password you don't use anywhere else, then sign in to pick up where you left off."
      topRight={<>Remembered it?{" "}<Link href="/login" className={`font-medium ${AUTH_LINK}`}>Sign in</Link></>}
    >
      {done ? (
        <>
          <AuthDoneIcon><CheckCircle2 className="h-5 w-5" /></AuthDoneIcon>
          <AuthHeading eyebrow="All set" title="Password reset">
            You can now sign in with your new password.
          </AuthHeading>
          <Link href="/login" className={`${AUTH_BUTTON} mt-7`}>
            Go to sign in
            <ArrowRight className={AUTH_ARROW} />
          </Link>
        </>
      ) : (
        <>
          <AuthHeading eyebrow="Account recovery" title="Set a new password">
            Choose a new password for your account.
          </AuthHeading>

          {error && <AuthError>{error}</AuthError>}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="password" className={AUTH_LABEL}>New password</label>
              <PasswordInput
                id="password"
                autoComplete="new-password"
                value={password}
                onChange={v => { setPassword(v); setError(""); }}
                show={showPass}
                onToggle={() => setShowPass(!showPass)}
                error={!!error}
                placeholder="At least 8 characters"
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

            <button type="submit" disabled={loading} className={AUTH_BUTTON}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading ? "Resetting..." : "Reset password"}
              {!loading && <ArrowRight className={AUTH_ARROW} />}
            </button>
          </form>
        </>
      )}
    </AuthShell>
  );
}
