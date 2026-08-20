"use client";

import { useState, useEffect } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { Shield, Eye, EyeOff, Loader2, CheckCircle2, Building2, Mail } from "lucide-react";
import { otpApi } from "@/lib/api";
import { toast } from "sonner";

const SOCIAL_ERRORS: Record<string, string> = {
  NoAccountFound: "No account found for that email. Please complete registration below first.",
  NoEmailFromProvider: "Your Google/Apple account didn't share an email address.",
};

const FEATURES = [
  "Real-time policy enforcement across every device",
  "Full visibility into employee activity & risk",
  "AI-powered threat detection and alerts",
  "Audit-ready reporting in a few clicks",
];

export default function RegisterPage() {
  const [companyName, setCompanyName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
  const [loading, setLoading] = useState<"" | "credentials" | "google" | "apple">("");
  const [error, setError] = useState("");
  // Confirmation step: nothing exists server-side until this code is accepted.
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
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

  const inputClass =
    "w-full rounded-lg bg-background px-3 py-2.5 text-sm outline-none transition-colors border " +
    (error ? "border-red-500 focus:border-red-500" : "border-border/60 focus:border-brand-500");

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

  return (
    <div className="min-h-screen relative flex bg-gradient-to-br from-brand-tint via-brand-tint-soft to-background overflow-hidden">
      <div className="absolute inset-0 opacity-20 pointer-events-none [background-image:radial-gradient(circle_at_20%_20%,#FF7000,transparent_35%),radial-gradient(circle_at_80%_70%,#FF7000,transparent_35%)]" />

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
              Start your 14-day free trial
            </h1>
            <p className="text-muted-foreground mt-4 text-base">
              No credit card required. Set up your organization in minutes and
              start protecting every device today.
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

        <p className="text-xs text-subtle">© 2026 Delsecure. Zero Trust Security Platform.</p>
      </div>

      <div className="w-full lg:w-1/2 relative flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md">
          <div className="lg:hidden text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-brand-500 rounded-2xl mb-4">
              <Shield className="w-8 h-8 text-on-brand" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">Delsecure</h1>
            <p className="text-muted-foreground mt-1">Company Security Console</p>
          </div>

          <div className="bg-card border border-border rounded-2xl p-8 shadow-2xl">
            <h2 className="text-xl font-semibold text-foreground mb-1">
              {codeSent ? "Confirm your email" : "Create your organization"}
            </h2>
            <p className="text-sm text-muted-foreground mb-6">
              {codeSent
                ? <>We sent a 6-digit code to <span className="text-body font-medium">{email}</span>. Your organization is created once you enter it.</>
                : "Start your 14-day free trial. No credit card required."}
            </p>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 text-danger rounded-lg px-4 py-3 mb-4 text-sm">
                {error}
              </div>
            )}

            {codeSent ? (
              <form onSubmit={handleVerify} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-1">
                    Verification code
                  </label>
                  <input
                    autoFocus
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={code}
                    onChange={e => { setCode(e.target.value.replace(/\D/g, "")); setError(""); }}
                    className={`${inputClass} tracking-[0.3em] text-center text-lg font-mono`}
                    placeholder="000000"
                    required
                  />
                  <p className="text-xs text-subtle mt-2">The code expires in 10 minutes.</p>
                </div>

                <div className="flex items-center justify-between">
                  <button type="button" onClick={backToDetails}
                    className="text-xs text-brand-500 hover:text-brand-400">
                    ← Edit your details
                  </button>
                  <button
                    type="button"
                    onClick={resendCode}
                    disabled={resendIn > 0 || resending}
                    className="inline-flex items-center gap-1.5 text-xs text-brand-500 hover:text-brand-400 disabled:text-subtle disabled:hover:text-subtle"
                  >
                    <Mail className="w-3.5 h-3.5" />
                    {resendIn > 0 ? `Resend in ${resendIn}s` : resending ? "Sending..." : "Resend code"}
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={loading !== "" || code.trim().length < 6}
                  className="w-full bg-primary hover:bg-brand-600 text-primary-foreground font-medium py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {loading === "credentials" && <Loader2 className="w-4 h-4 animate-spin" />}
                  {loading === "credentials" ? "Creating account..." : "Verify and create account"}
                </button>
              </form>
            ) : (
            <>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Company name</label>
                <div className="relative">
                  <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={companyName}
                    onChange={e => { setCompanyName(e.target.value); setError(""); }}
                    className={`${inputClass} pl-9 pr-3`}
                    placeholder="Acme Inc."
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-1">First name</label>
                  <input
                    type="text"
                    value={firstName}
                    onChange={e => { setFirstName(e.target.value); setError(""); }}
                    className={inputClass}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-1">Last name</label>
                  <input
                    type="text"
                    value={lastName}
                    onChange={e => { setLastName(e.target.value); setError(""); }}
                    className={inputClass}
                    required
                  />
                </div>
              </div>

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
                <label className="block text-sm font-medium text-muted-foreground mb-1">Password</label>
                <div className="relative">
                  <input
                    type={showPass ? "text" : "password"}
                    value={password}
                    onChange={e => { setPassword(e.target.value); setError(""); }}
                    className={`${inputClass} pr-10`}
                    placeholder="At least 8 characters"
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

              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Confirm password</label>
                <input
                  type={showPass ? "text" : "password"}
                  value={confirmPassword}
                  onChange={e => { setConfirmPassword(e.target.value); setError(""); }}
                  className={inputClass}
                  required
                />
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
                {loading === "credentials" ? "Sending code..." : "Create Account"}
              </button>
            </form>

            <div className="flex items-center gap-3 my-5">
              <div className="h-px bg-border flex-1" />
              <span className="text-xs text-muted-foreground">or continue with</span>
              <div className="h-px bg-border flex-1" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => handleSocial("google")}
                disabled={loading !== ""}
                className="flex items-center justify-center gap-2 border border-border rounded-lg py-2.5 text-sm font-medium text-foreground bg-background hover:bg-muted transition-colors disabled:opacity-60"
              >
                <GoogleIcon className="w-4 h-4" />
                Google
              </button>
              <button
                type="button"
                onClick={() => handleSocial("apple")}
                disabled={loading !== ""}
                className="flex items-center justify-center gap-2 border border-border rounded-lg py-2.5 text-sm font-medium text-foreground bg-background hover:bg-muted transition-colors disabled:opacity-60"
              >
                <AppleIcon className="w-4 h-4" />
                Apple
              </button>
            </div>

            </>
            )}

            <p className="text-center text-sm text-muted-foreground mt-6">
              Already have an account?{" "}
              <Link href="/login" className="text-brand-500 hover:text-brand-400 font-medium">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.47a5.54 5.54 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.57-5.17 3.57-8.82Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.95-2.91l-3.88-3c-1.08.72-2.46 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.27v3.11A11.99 11.99 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.27 14.28a7.2 7.2 0 0 1 0-4.56V6.61H1.27a12 12 0 0 0 0 10.78l4-3.11Z" />
      <path fill="#EA4335" d="M12 4.75c1.76 0 3.34.6 4.58 1.79l3.44-3.44C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.27 6.61l4 3.11C6.22 6.86 8.87 4.75 12 4.75Z" />
    </svg>
  );
}

function AppleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zm3.378-3.066c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.56-1.702z"
      />
    </svg>
  );
}
