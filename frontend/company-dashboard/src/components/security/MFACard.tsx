"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { mfaApi } from "@/lib/api";
import {
  ShieldCheck, ShieldOff, Loader2, Copy, Check, KeyRound, X, RefreshCw, Smartphone,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/**
 * Enrolment and management of the signed-in user's second factor.
 *
 * The flow is deliberately three steps — secret, verify, recovery codes —
 * because enabling MFA without proving the authenticator works, or without
 * handing over recovery codes, is how people lock themselves out.
 */
export function MFACard() {
  const qc = useQueryClient();
  const [step, setStep] = useState<"idle" | "scan" | "codes">("idle");
  const [setupData, setSetupData] = useState<any>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [showSecret, setShowSecret] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [password, setPassword] = useState("");
  const [regenerating, setRegenerating] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["mfa-status"],
    queryFn: () => mfaApi.status(),
  });
  const status = data?.data ?? {};
  const refresh = () => qc.invalidateQueries({ queryKey: ["mfa-status"] });

  const setupMut = useMutation({
    mutationFn: () => mfaApi.setup(),
    onSuccess: (res) => { setSetupData(res.data); setStep("scan"); setCode(""); },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Could not start setup"),
  });

  const enableMut = useMutation({
    mutationFn: (c: string) => mfaApi.enable(c),
    onSuccess: (res) => {
      setRecoveryCodes(res.data?.recovery_codes ?? []);
      setStep("codes");
      refresh();
      toast.success("Two-factor authentication is on");
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "That code didn't match"),
  });

  const disableMut = useMutation({
    mutationFn: (pw: string) => mfaApi.disable(pw),
    onSuccess: () => {
      toast.success("Two-factor authentication turned off");
      setConfirmDisable(false); setPassword(""); setStep("idle"); refresh();
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Could not turn it off"),
  });

  const regenMut = useMutation({
    mutationFn: (pw: string) => mfaApi.regenerateCodes(pw),
    onSuccess: (res) => {
      setRecoveryCodes(res.data?.recovery_codes ?? []);
      setStep("codes"); setRegenerating(false); setPassword(""); refresh();
      toast.success("New recovery codes generated");
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Could not generate codes"),
  });

  const copyCodes = () => {
    navigator.clipboard.writeText(recoveryCodes.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const enabled = !!status.enabled;

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm">
      <div className="p-5 border-b border-border flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3">
          <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0",
            enabled ? "bg-green-500/10 text-success" : "bg-elevated text-subtle")}>
            {enabled ? <ShieldCheck className="w-5 h-5" /> : <ShieldOff className="w-5 h-5" />}
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Two-factor authentication</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              {isLoading
                ? "Checking…"
                : enabled
                  ? `On — a code from your authenticator app is required at sign-in. ${status.recovery_codes_left ?? 0} recovery codes left.`
                  : "Off — your account is protected by a password alone."}
            </p>
            {status.required_by_org && !enabled && (
              <p className="text-xs text-warning mt-1">Your organization requires this.</p>
            )}
          </div>
        </div>

        {!isLoading && step === "idle" && (
          enabled ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setRegenerating(true); setPassword(""); }}
                className="flex items-center gap-1.5 border border-border text-body hover:bg-elevated px-3 py-2 rounded-lg text-sm"
              >
                <RefreshCw className="w-3.5 h-3.5" /> New recovery codes
              </button>
              <button
                onClick={() => { setConfirmDisable(true); setPassword(""); }}
                disabled={status.required_by_org}
                title={status.required_by_org ? "Your organization requires two-factor authentication" : "Turn off"}
                className="flex items-center gap-1.5 border border-border text-danger hover:bg-red-500/10 px-3 py-2 rounded-lg text-sm disabled:opacity-40"
              >
                <ShieldOff className="w-3.5 h-3.5" /> Turn off
              </button>
            </div>
          ) : (
            <button
              onClick={() => setupMut.mutate()}
              disabled={setupMut.isPending}
              className="flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-on-brand px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60"
            >
              {setupMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Smartphone className="w-4 h-4" />}
              Set up
            </button>
          )
        )}
      </div>

      {/* Step 1 + 2: scan the QR, then prove it works */}
      {step === "scan" && setupData && (
        <div className="p-5 space-y-4">
          <div className="flex flex-col sm:flex-row gap-6">
            <div className="flex-shrink-0">
              {/* White plate behind the QR: scanners struggle with a dark
                  background, and this card follows the app theme. */}
              <div className="bg-white p-3 rounded-lg inline-block">
                <QRCodeSVG value={setupData.provisioning_uri} size={168} level="M" />
              </div>
            </div>
            <div className="flex-1 min-w-0 space-y-3">
              <div>
                <p className="text-sm font-medium text-foreground">1. Scan this with an authenticator app</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Google Authenticator, 1Password, Authy, Microsoft Authenticator — any of them work.
                </p>
              </div>
              <div>
                <button
                  onClick={() => setShowSecret(v => !v)}
                  className="text-xs text-brand-500 hover:text-brand-400"
                >
                  {showSecret ? "Hide" : "Can't scan? Enter this key manually"}
                </button>
                {showSecret && (
                  <p className="mt-2 font-mono text-xs bg-elevated border border-border rounded px-3 py-2 break-all text-foreground">
                    {setupData.secret}
                  </p>
                )}
              </div>
              <div>
                <p className="text-sm font-medium text-foreground mb-1.5">2. Enter the 6-digit code it shows</p>
                <div className="flex gap-2">
                  <input
                    autoFocus
                    value={code}
                    onChange={e => setCode(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && code.trim()) enableMut.mutate(code); }}
                    placeholder="000000"
                    inputMode="numeric"
                    className="w-32 bg-background border border-border rounded-lg px-3 py-2 text-center font-mono tracking-[0.2em] text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  <button
                    onClick={() => enableMut.mutate(code)}
                    disabled={!code.trim() || enableMut.isPending}
                    className="bg-brand-500 hover:bg-brand-600 text-on-brand px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-60"
                  >
                    {enableMut.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                    Verify
                  </button>
                  <button
                    onClick={() => { setStep("idle"); setSetupData(null); }}
                    className="border border-border text-body px-3 py-2 rounded-lg text-sm hover:bg-elevated"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Step 3: recovery codes, shown exactly once */}
      {step === "codes" && (
        <div className="p-5 space-y-4">
          <div className="flex items-start gap-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
            <KeyRound className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-foreground">Save your recovery codes now</p>
              <p className="text-muted-foreground mt-0.5">
                Each code works once, and this is the only time they are shown. Without them, losing your
                phone means losing this account.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {recoveryCodes.map(rc => (
              <code key={rc} className="font-mono text-sm bg-elevated border border-border rounded px-2 py-1.5 text-center text-foreground">
                {rc}
              </code>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={copyCodes}
              className="flex items-center gap-2 border border-border text-body hover:bg-elevated px-3 py-2 rounded-lg text-sm">
              {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
              {copied ? "Copied" : "Copy all"}
            </button>
            <button
              onClick={() => {
                const blob = new Blob([recoveryCodes.join("\n")], { type: "text/plain" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url; a.download = "delsecure-recovery-codes.txt"; a.click();
                URL.revokeObjectURL(url);
              }}
              className="border border-border text-body hover:bg-elevated px-3 py-2 rounded-lg text-sm"
            >
              Download
            </button>
            <button
              onClick={() => { setStep("idle"); setRecoveryCodes([]); setSetupData(null); }}
              className="ml-auto bg-brand-500 text-on-brand px-4 py-2 rounded-lg text-sm font-medium"
            >
              I've saved them
            </button>
          </div>
        </div>
      )}

      {/* Password prompts — both destructive-ish actions require it */}
      {(confirmDisable || regenerating) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-card rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-foreground">
                {confirmDisable ? "Turn off two-factor authentication" : "Generate new recovery codes"}
              </h3>
              <button
                onClick={() => { setConfirmDisable(false); setRegenerating(false); setPassword(""); }}
                className="text-subtle hover:text-body"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              {confirmDisable
                ? "Your account will be protected by a password alone. Confirm with your password."
                : "Your current codes stop working immediately. Confirm with your password."}
            </p>
            <input
              autoFocus
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Your password"
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground mb-4 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <div className="flex gap-3">
              <button
                onClick={() => { setConfirmDisable(false); setRegenerating(false); setPassword(""); }}
                className="flex-1 border border-border text-body py-2 rounded-lg text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => confirmDisable ? disableMut.mutate(password) : regenMut.mutate(password)}
                disabled={!password || disableMut.isPending || regenMut.isPending}
                className={cn(
                  "flex-1 py-2 rounded-lg text-sm font-medium text-white flex items-center justify-center gap-2 disabled:opacity-60",
                  confirmDisable ? "bg-red-600" : "bg-brand-500"
                )}
              >
                {(disableMut.isPending || regenMut.isPending) && <Loader2 className="w-4 h-4 animate-spin" />}
                {confirmDisable ? "Turn off" : "Generate"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
