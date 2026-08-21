"use client";

import { useQuery } from "@tanstack/react-query";
import { healthApi } from "@/lib/api";
import { Activity, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

const SERVICE_LABELS: Record<string, string> = {
  "admin-api": "Admin API",
  "ai-service": "AI Assistant",
  "dlp-service": "DLP Service",
  "malware-service": "Malware Scanning",
  "threatintel-service": "Threat Intel",
  "posture-service": "Device Posture",
  "shadowit-service": "Shadow IT",
  "casb-service": "CASB",
};

export default function SystemHealthPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["system-health"],
    queryFn: healthApi.get,
    refetchInterval: 15_000,
  });

  const d = data?.data;
  const services = d?.services ?? [];
  const reachable = d?.reachable ?? false;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">System Health</h2>
          <p className="text-sm text-muted-foreground mt-1">Live status of every backend service, pulled from Prometheus</p>
        </div>
        {d && (
          <span className={cn(
            "flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium",
            d.up_count === d.total && d.total > 0 ? "bg-green-500/10 text-green-400" : "bg-yellow-500/10 text-yellow-400"
          )}>
            <Activity className="w-4 h-4" />
            {d.up_count}/{d.total} services up
          </span>
        )}
      </div>

      {!isLoading && !reachable && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-5 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-red-400">Could not reach Prometheus</p>
            <p className="text-sm text-muted-foreground mt-0.5">{d?.error ?? "The metrics backend is unreachable — service status below is unavailable."}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {isLoading ? (
          [...Array(8)].map((_, i) => <div key={i} className="h-28 bg-card rounded-xl border border-border animate-pulse" />)
        ) : services.length === 0 ? (
          <div className="col-span-full bg-card rounded-xl border border-border p-12 text-center text-muted-foreground">
            No services reporting yet
          </div>
        ) : services.map((s: any) => (
          <div key={s.job} className={cn(
            "bg-card rounded-xl p-5 border shadow-sm",
            s.up ? "border-border" : "border-red-500/30"
          )}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">{SERVICE_LABELS[s.job] ?? s.job}</p>
                <p className="text-xs text-[#6B6B6B] mt-0.5">{s.job}</p>
              </div>
              {s.up ? (
                <CheckCircle2 className="w-5 h-5 text-green-400" />
              ) : (
                <XCircle className="w-5 h-5 text-red-400" />
              )}
            </div>
            <div className="mt-4 flex items-center justify-between">
              <span className={cn(
                "text-xs font-medium px-2 py-0.5 rounded-full",
                s.up ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"
              )}>
                {s.up ? "Healthy" : "Down"}
              </span>
              {s.up && (
                <span className="text-xs text-muted-foreground font-mono">
                  {(s.last_scrape_duration_seconds * 1000).toFixed(0)}ms scrape
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-[#6B6B6B]">
        Status reflects each service's last Prometheus scrape (15s interval). Refreshes automatically every 15 seconds.
      </p>
    </div>
  );
}
