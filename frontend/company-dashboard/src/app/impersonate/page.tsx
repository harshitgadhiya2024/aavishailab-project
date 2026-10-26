"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Loader2, AlertTriangle } from "lucide-react";
import { BrandLogo } from "@/components/brand/BrandLogo";

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
    <div className="grid min-h-screen place-items-center bg-[#fafafa] px-6 text-[#0b0b0d] [color-scheme:light]">
      <div className="w-full max-w-[400px] text-center">
        <BrandLogo className="text-[24px]" ink="text-[#0b0b0d]" />
        {error ? (
          <>
            <p className="mt-10 flex items-center justify-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-[#b42318]">
              <AlertTriangle className="h-3.5 w-3.5" /> Session not started
            </p>
            <h1 className="mt-3 [font-family:Satoshi,var(--font-inter),sans-serif] text-[1.75rem] font-normal tracking-[-0.03em]">Couldn&apos;t sign you in</h1>
            <p className="mt-2 text-[15px] text-[#5d5d66]">{error}</p>
            <p className="mt-4 text-[13px] text-[#71717a]">Ask the superadmin to start a new &quot;View as Org&quot; session.</p>
          </>
        ) : (
          <>
            <p className="mt-10 flex items-center justify-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-[#c2410c]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Support session
            </p>
            <h1 className="mt-3 [font-family:Satoshi,var(--font-inter),sans-serif] text-[1.75rem] font-normal tracking-[-0.03em]">Signing you in…</h1>
            <p className="mt-2 text-[15px] text-[#5d5d66]">Starting a temporary support session.</p>
          </>
        )}
      </div>
    </div>
  );
}
