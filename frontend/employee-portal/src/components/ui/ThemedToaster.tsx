"use client";

import { Toaster } from "sonner";
import { useTheme } from "next-themes";

/** Sonner defaults to the OS theme; pin it to the app's own theme instead. */
export function ThemedToaster() {
  const { resolvedTheme } = useTheme();

  return (
    <Toaster
      position="top-right"
      richColors
      closeButton
      theme={resolvedTheme === "light" ? "light" : "dark"}
    />
  );
}
