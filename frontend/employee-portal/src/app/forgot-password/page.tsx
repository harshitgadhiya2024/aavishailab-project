"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, KeyRound, Loader2, MailCheck } from "lucide-react";
import { portalApi } from "@/lib/api";
import { toast } from "sonner";
import {
  AUTH_ARROW, AUTH_BUTTON, AUTH_LABEL, AUTH_LINK,
  AuthDoneIcon, AuthHeading, AuthShell, authInput,
} from "@/components/brand/AuthShell";

export default function ForgotPasswordPage() {
  const [companyCode, setCompanyCode] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [devResetUrl, setDevResetUrl] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await portalApi.forgotPassword({ company_code: companyCode, email });
      if (res.data?.reset_token) {
        setDevResetUrl(`/reset-password?token=${encodeURIComponent(res.data.reset_token)}`);
      }
      setSent(true);
      toast.success("If that account exists, reset instructions are on the way.");
    } catch {
      setSent(true);
      toast.success("If that account exists, reset instructions are on the way.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      headline="Locked out? Back in a minute."
      lead="We'll email a secure link to reset your portal password. Your laptop stays protected while you do."
      topRight={<>Remembered it?{" "}<Link href="/login" className={`font-medium ${AUTH_LINK}`}>Sign in</Link></>}
    >
      {sent ? (
        <>
          <AuthDoneIcon><MailCheck className="h-5 w-5" /></AuthDoneIcon>
          <AuthHeading eyebrow="Email sent" title="Check your email">
            If that account exists, we&apos;ve sent reset instructions to your work email.
          </AuthHeading>
          {devResetUrl && (
            <div className="mt-6 rounded-[4px] border border-brand-500/30 bg-[#fff1e5] p-3">
              <p className="mb-1 font-mono text-[10.5px] uppercase tracking-[0.1em] text-[#c2410c]">Dev mode · email isn&apos;t wired up yet</p>
              <Link href={devResetUrl} className={`break-all text-[13px] underline underline-offset-2 ${AUTH_LINK}`}>
                {devResetUrl}
              </Link>
            </div>
          )}
          <Link href="/login" className={`${AUTH_BUTTON} mt-7`}>
            Back to sign in
            <ArrowRight className={AUTH_ARROW} />
          </Link>
        </>
      ) : (
        <>
          <AuthHeading eyebrow="Account recovery" title="Reset your password">
            Enter your company code and work email, and we&apos;ll send you reset instructions.
          </AuthHeading>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="company" className={AUTH_LABEL}>Company code</label>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#71717a]" />
                <input
                  id="company"
                  type="text"
                  value={companyCode}
                  onChange={e => setCompanyCode(e.target.value)}
                  className={`${authInput()} pl-10`}
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
                onChange={e => setEmail(e.target.value)}
                className={authInput()}
                placeholder="you@company.com"
                required
              />
            </div>

            <button type="submit" disabled={loading} className={AUTH_BUTTON}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading ? "Sending..." : "Send reset link"}
              {!loading && <ArrowRight className={AUTH_ARROW} />}
            </button>
          </form>

          <Link
            href="/login"
            className="mt-6 flex items-center justify-center gap-1.5 text-[13px] text-[#5d5d66] transition-colors hover:text-[#0b0b0d]"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
          </Link>
        </>
      )}
    </AuthShell>
  );
}
