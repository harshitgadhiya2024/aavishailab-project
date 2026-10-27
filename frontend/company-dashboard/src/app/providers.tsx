"use client";

import { SessionProvider } from "next-auth/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useEffect, useState } from "react";
import { DEMO_SESSION, isDemo } from "@/lib/demo";

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(() => new QueryClient({
    defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
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
      <SessionProvider
        session={isDemo ? (DEMO_SESSION as any) : undefined}
        refetchInterval={isDemo ? 0 : undefined}
        refetchOnWindowFocus={!isDemo}
      >
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}
