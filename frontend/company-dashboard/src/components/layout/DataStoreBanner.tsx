"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ServerCrash, X } from "lucide-react";

// Shown on every dashboard page when the company keeps its employee data on
// its own servers and the API reports they can't be reached (a 503 with code
// data_store_unavailable — see lib/api.ts). One clear explanation and a link
// to the fix, instead of each page showing an empty table that looks like the
// data is gone.
export function DataStoreBanner() {
  const [shownAt, setShownAt] = useState<number | null>(null);

  useEffect(() => {
    const show = () => setShownAt(Date.now());
    window.addEventListener("aavishield:data-store-unavailable", show);
    return () => window.removeEventListener("aavishield:data-store-unavailable", show);
  }, []);

  // Hides itself a few minutes after the last failure, so a store that came
  // back doesn't leave a stale warning behind.
  useEffect(() => {
    if (shownAt === null) return;
    const t = setTimeout(() => setShownAt(null), 3 * 60 * 1000);
    return () => clearTimeout(t);
  }, [shownAt]);

  if (shownAt === null) return null;

  return (
    <div role="alert" className="flex items-start gap-3 border-b border-red-500/30 bg-red-500/10 px-6 py-3">
      <ServerCrash className="mt-0.5 h-4 w-4 flex-shrink-0 text-danger" />
      <p className="flex-1 text-sm text-body">
        <span className="font-semibold text-foreground">Your company&apos;s database or file storage can&apos;t be reached.</span>{" "}
        Activity, reports and screenshots can&apos;t load until it&apos;s back. New security events are held and delivered
        automatically once it answers again.{" "}
        <Link href="/dashboard/settings#data-residency" className="font-medium text-brand-500 hover:underline">
          Check the connection
        </Link>
      </p>
      <button onClick={() => setShownAt(null)} aria-label="Dismiss" className="text-subtle hover:text-foreground">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
