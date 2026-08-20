"use client";

import { SessionProvider } from "next-auth/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useEffect, useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(() => new QueryClient({
    defaultOptions: { queries: { retry: 1, staleTime: 15_000, refetchInterval: 30_000 } },
  }));

  // The error boundary sets this before reloading out of a stale build. Once
  // the app mounts the reload clearly worked, so clear it — otherwise the tab
  // would refuse to auto-recover from the *next* deploy.
  useEffect(() => {
    sessionStorage.removeItem("aavishield:chunk-reload");
  }, []);

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      disableTransitionOnChange
      storageKey="aavishield-theme"
    >
      <SessionProvider>
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}
