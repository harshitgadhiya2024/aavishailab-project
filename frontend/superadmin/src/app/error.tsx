"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw, RotateCcw } from "lucide-react";

// A chunk that 404s is not an app bug — it means this tab is running an older
// build than the server now serves (we redeployed while the tab was open).
// The page is unrecoverable in place, so reload once to pick up the new build.
// The sessionStorage flag stops that from turning into a reload loop when the
// failure is something else.
const CHUNK_ERROR = /ChunkLoadError|Loading chunk [\d]+ failed|Failed to fetch dynamically imported module|Importing a module script failed/i;
const RELOAD_FLAG = "aavishield:chunk-reload";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const isStaleBuild = CHUNK_ERROR.test(`${error?.name} ${error?.message}`);

  useEffect(() => {
    console.error("Dashboard error boundary caught:", error);

    if (isStaleBuild && typeof window !== "undefined") {
      if (!sessionStorage.getItem(RELOAD_FLAG)) {
        sessionStorage.setItem(RELOAD_FLAG, "1");
        window.location.reload();
      }
    } else if (typeof window !== "undefined") {
      sessionStorage.removeItem(RELOAD_FLAG);
    }
  }, [error, isStaleBuild]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="bg-card border border-border rounded-2xl shadow-sm max-w-md w-full p-8 text-center">
        <div className="w-12 h-12 rounded-xl bg-red-500/10 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="w-6 h-6 text-red-500" />
        </div>

        <h2 className="text-lg font-semibold text-foreground mb-2">
          {isStaleBuild ? "Updating to the latest version" : "Something went wrong"}
        </h2>
        <p className="text-sm text-muted-foreground mb-6">
          {isStaleBuild
            ? "This page was updated while you had it open. Reloading now…"
            : "This page hit an unexpected error. Your data is safe — try again, and reload if it keeps happening."}
        </p>

        <div className="flex gap-3">
          <button
            onClick={() => reset()}
            className="flex-1 flex items-center justify-center gap-2 bg-brand-500 hover:bg-brand-600 text-white py-2 rounded-lg text-sm font-medium"
          >
            <RotateCcw className="w-4 h-4" /> Try again
          </button>
          <button
            onClick={() => window.location.reload()}
            className="flex-1 flex items-center justify-center gap-2 border border-border text-foreground hover:bg-muted py-2 rounded-lg text-sm font-medium"
          >
            <RefreshCw className="w-4 h-4" /> Reload page
          </button>
        </div>

        {error?.digest && (
          <p className="mt-5 text-xs text-muted-foreground font-mono">Reference: {error.digest}</p>
        )}
      </div>
    </div>
  );
}
