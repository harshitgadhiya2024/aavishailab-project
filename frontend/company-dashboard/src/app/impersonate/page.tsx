"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Shield, Loader2, AlertTriangle } from "lucide-react";

export default function ImpersonatePage() {
  return (
    <Suspense>
      <ImpersonateInner />
    </Suspense>
  );
}

function ImpersonateInner() {
  const params = useSearchParams();
  const router = useRouter();
  const [error, setError] = useState("");

  useEffect(() => {
    const code = params.get("code");
    if (!code) {
      setError("No impersonation code was provided.");
      return;
    }
    signIn("impersonation", { code, redirect: false }).then((res) => {
      if (res?.error) {
        setError(res.error);
      } else {
        router.replace("/dashboard");
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-sm w-full text-center space-y-4">
        <div className="w-12 h-12 bg-brand-500/10 rounded-xl flex items-center justify-center mx-auto">
          <Shield className="w-6 h-6 text-brand-500" />
        </div>
        {error ? (
          <>
            <AlertTriangle className="w-8 h-8 text-red-400 mx-auto" />
            <h1 className="text-lg font-semibold text-foreground">Couldn't sign you in</h1>
            <p className="text-sm text-muted-foreground">{error}</p>
            <p className="text-xs text-[#6B6B6B]">Ask the superadmin to start a new "View as Org" session.</p>
          </>
        ) : (
          <>
            <Loader2 className="w-6 h-6 animate-spin text-brand-500 mx-auto" />
            <h1 className="text-lg font-semibold text-foreground">Signing you in…</h1>
            <p className="text-sm text-muted-foreground">Starting a temporary support session.</p>
          </>
        )}
      </div>
    </div>
  );
}
