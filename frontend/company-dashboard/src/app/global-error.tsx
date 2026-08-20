"use client";

import { useEffect } from "react";

// Last-resort boundary: catches errors thrown by the root layout itself, where
// the normal error.tsx (which renders inside that layout) can't run. It has to
// bring its own <html>/<body>, and can't rely on the app's CSS being loaded.
const CHUNK_ERROR = /ChunkLoadError|Loading chunk [\d]+ failed|Failed to fetch dynamically imported module|Importing a module script failed/i;
const RELOAD_FLAG = "aavishield:chunk-reload";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Root error boundary caught:", error);

    if (CHUNK_ERROR.test(`${error?.name} ${error?.message}`) && typeof window !== "undefined") {
      if (!sessionStorage.getItem(RELOAD_FLAG)) {
        sessionStorage.setItem(RELOAD_FLAG, "1");
        window.location.reload();
      }
    }
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
          background: "#0A0A0A",
          color: "#F5F5F5",
        }}
      >
        <div style={{ textAlign: "center", padding: 24, maxWidth: 420 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Something went wrong</h2>
          <p style={{ fontSize: 14, color: "#A3A3A3", marginBottom: 24 }}>
            The dashboard could not be loaded. Try again, or reload the page.
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            <button
              onClick={() => reset()}
              style={{
                background: "#FF7000",
                color: "#fff",
                border: "none",
                padding: "8px 18px",
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: "transparent",
                color: "#F5F5F5",
                border: "1px solid #262626",
                padding: "8px 18px",
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Reload page
            </button>
          </div>
          {error?.digest && (
            <p style={{ marginTop: 20, fontSize: 12, color: "#6B6B6B", fontFamily: "monospace" }}>
              Reference: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
