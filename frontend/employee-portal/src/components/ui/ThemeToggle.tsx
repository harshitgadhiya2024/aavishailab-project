"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Light/dark switch as a row in the profile menu: icon, label and a small
 * switch that shows the current state. The resolved theme is only known on
 * the client, so the switch stays neutral until mount to keep SSR stable.
 */
export function ThemeMenuItem({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const isDark = mounted && resolvedTheme === "dark";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={cn(
        "flex w-full items-center gap-2 px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      Dark mode
      <span
        aria-hidden
        className={cn(
          "ml-auto flex h-4 w-7 items-center rounded-[4px] p-0.5 transition-colors",
          isDark ? "bg-brand-500" : "bg-border-strong",
        )}
      >
        <span className={cn("h-3 w-3 rounded-[3px] bg-white transition-transform", isDark && "translate-x-3")} />
      </span>
    </button>
  );
}
