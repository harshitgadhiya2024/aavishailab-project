"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { AlertTriangle, Info, X, Siren } from "lucide-react";
import { cn } from "@/lib/utils";

type Announcement = {
  id: string;
  title: string;
  body: string;
  severity: "info" | "warning" | "critical";
};

const SEVERITY_STYLE: Record<Announcement["severity"], { icon: any; classes: string }> = {
  info: { icon: Info, classes: "bg-brand-500/10 text-brand-500 border-brand-500/20" },
  warning: { icon: AlertTriangle, classes: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" },
  critical: { icon: Siren, classes: "bg-red-500/10 text-red-400 border-red-500/20" },
};

// Polled rather than pushed — a platform announcement isn't latency
// sensitive, and this avoids a websocket just for a banner.
export function AnnouncementBanner() {
  const { data } = useQuery({
    queryKey: ["announcements-active"],
    queryFn: () => api.get("/api/v1/announcements/active"),
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  });
  const [dismissed, setDismissed] = useState<string[]>([]);

  const items: Announcement[] = (data?.data?.announcements ?? []).filter(
    (a: Announcement) => !dismissed.includes(a.id)
  );
  if (items.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 px-4 pt-4">
      {items.map((a) => {
        const style = SEVERITY_STYLE[a.severity] ?? SEVERITY_STYLE.info;
        return (
          <div key={a.id} className={cn("flex items-start gap-3 rounded-lg border px-4 py-3 text-sm", style.classes)}>
            <style.icon className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-medium">{a.title}</p>
              {a.body && <p className="text-xs opacity-90 mt-0.5">{a.body}</p>}
            </div>
            <button
              onClick={() => setDismissed((d) => [...d, a.id])}
              className="opacity-60 hover:opacity-100 flex-shrink-0"
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
