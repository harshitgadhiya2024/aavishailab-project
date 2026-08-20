"use client";

import { useState } from "react";
import Link from "next/link";
import { Shield, Loader2, ArrowLeft, MailCheck } from "lucide-react";
import { portalApi } from "@/lib/api";
import { toast } from "sonner";

export default function ForgotPasswordPage() {
  const [companyCode, setCompanyCode] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [devResetUrl, setDevResetUrl] = useState<string | null>(null);

  const inputClass =
    "w-full rounded-lg bg-background px-3 py-2.5 text-sm outline-none transition-colors border border-border/60 focus:border-brand-500";

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
    <div className="min-h-screen relative flex items-center justify-center p-6 bg-gradient-to-br from-brand-tint via-brand-tint-soft to-background overflow-hidden">
      <div className="absolute inset-0 opacity-20 pointer-events-none [background-image:radial-gradient(circle_at_20%_20%,#FF7000,transparent_35%),radial-gradient(circle_at_80%_70%,#FF7000,transparent_35%)]" />

      <div className="relative w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-brand-500 rounded-2xl mb-4">
            <Shield className="w-8 h-8 text-on-brand" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Delsecure</h1>
          <p className="text-muted-foreground mt-1">Employee Security Portal</p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-8 shadow-2xl">
          {sent ? (
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 bg-brand-500/10 rounded-full mb-4">
                <MailCheck className="w-6 h-6 text-brand-500" />
              </div>
              <h2 className="text-lg font-semibold text-foreground mb-2">Check your email</h2>
              <p className="text-sm text-muted-foreground mb-6">
                If that account exists, we've sent reset instructions.
              </p>
              {devResetUrl && (
                <div className="bg-brand-500/10 border border-brand-500/30 rounded-lg p-3 mb-6 text-left">
                  <p className="text-xs text-brand-500 font-medium mb-1">Dev mode — email isn't wired up yet:</p>
                  <Link href={devResetUrl} className="text-xs text-brand-500 underline break-all">
                    {devResetUrl}
                  </Link>
                </div>
              )}
              <Link href="/login" className="text-sm text-brand-500 hover:text-brand-400 font-medium">
                Back to sign in
              </Link>
            </div>
          ) : (
            <>
              <h2 className="text-xl font-semibold text-foreground mb-1">Reset your password</h2>
              <p className="text-sm text-muted-foreground mb-6">
                Enter your company code and work email — we'll send you reset instructions.
              </p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-1">Company code</label>
                  <input
                    type="text"
                    value={companyCode}
                    onChange={e => setCompanyCode(e.target.value)}
                    className={inputClass}
                    placeholder="Provided by your IT administrator"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-1">Work email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className={inputClass}
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-primary hover:bg-brand-600 text-primary-foreground font-medium py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {loading ? "Sending..." : "Send reset instructions"}
                </button>
              </form>

              <Link
                href="/login"
                className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mt-6"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back to sign in
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
