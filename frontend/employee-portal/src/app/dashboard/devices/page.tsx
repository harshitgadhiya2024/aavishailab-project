"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { portalApi } from "@/lib/api";
import { Monitor, Wifi, WifiOff, Loader2, Trash2 } from "lucide-react";
import { formatDateTime, cn } from "@/lib/utils";
import Link from "next/link";

const STATUS_STYLES: Record<string, string> = {
  online: "bg-green-500/10 text-success",
  offline: "bg-elevated text-muted-foreground",
  revoked: "bg-red-500/10 text-danger",
};

export default function DevicesPage() {
  const queryClient = useQueryClient();
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["portal-devices"],
    queryFn: () => portalApi.devices(),
    refetchInterval: 30_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => portalApi.deleteDevice(id),
    onMutate: (id: string) => setPendingDeleteId(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["portal-devices"] }),
    onSettled: () => setPendingDeleteId(null),
  });

  const devices = data?.data?.data ?? [];

  const handleDelete = (device: any) => {
    const label = device.hostname || "this device";
    if (!window.confirm(`Remove ${label}? This revokes its agent key — if it's still running, it will stop reporting.`)) {
      return;
    }
    deleteMutation.mutate(device.id);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">My Devices</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Devices enrolled with the Delsecure security agent
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-brand-500" />
        </div>
      ) : devices.length === 0 ? (
        <div className="bg-card rounded-xl border border-border shadow-sm p-12 text-center">
          <Monitor className="w-12 h-12 text-subtle mx-auto mb-4" />
          <h3 className="font-semibold text-body mb-2">No devices enrolled</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Download and run the security agent to enroll this or another device.
          </p>
          <Link
            href="/dashboard/download"
            className="inline-block bg-brand-500 text-on-brand px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-600 hover:text-white"
          >
            Download Agent
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {devices.map((device: any) => (
            <div key={device.id} className="bg-card rounded-xl border border-border shadow-sm p-5">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-brand-500/10 flex items-center justify-center">
                    <Monitor className="w-5 h-5 text-brand-500" />
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">{device.hostname || "Unknown device"}</p>
                    <p className="text-xs text-subtle capitalize">{device.os_type} {device.os_version}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn("px-2.5 py-1 rounded-full text-xs font-medium capitalize", STATUS_STYLES[device.status] ?? "bg-elevated text-muted-foreground")}>
                    {device.status === "online"
                      ? <span className="flex items-center gap-1"><Wifi className="w-3 h-3" /> online</span>
                      : device.status === "offline"
                      ? <span className="flex items-center gap-1"><WifiOff className="w-3 h-3" /> offline</span>
                      : device.status}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleDelete(device)}
                    disabled={deleteMutation.isPending && pendingDeleteId === device.id}
                    title="Remove device"
                    className="p-1.5 rounded-lg text-subtle hover:text-danger hover:bg-red-500/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {deleteMutation.isPending && pendingDeleteId === device.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
              <div className="space-y-1.5 text-xs text-muted-foreground">
                {device.ip_address && <p>IP: {device.ip_address}</p>}
                {device.agent_version && <p>Agent: v{device.agent_version}</p>}
                {device.last_seen_at && <p>Last seen: {formatDateTime(device.last_seen_at)}</p>}
                {device.enrolled_at && <p>Enrolled: {formatDateTime(device.enrolled_at)}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
