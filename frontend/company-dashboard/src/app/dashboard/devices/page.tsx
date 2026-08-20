"use client";

import { useEffect, useMemo, useState } from "react";
import { Pagination } from "@/components/ui/Pagination";

import { Monitor, Laptop, Smartphone, Shield, AlertCircle, Loader2, Trash2, Clock } from "lucide-react";
import { deviceApi } from "@/lib/api";
import { EnforcementBadge } from "@/components/enforcement/ScheduleEditor";
import { DeviceScheduleModal } from "@/components/enforcement/DeviceScheduleModal";
import { toast } from "sonner";

const STATUS_COLORS: Record<string, string> = {
  online: "bg-green-500/10 text-success",
  offline: "bg-elevated text-body",
  warning: "bg-yellow-500/10 text-warning",
};

type Device = {
  id: string;
  hostname: string;
  os_type?: string;
  os_version?: string;
  agent_version?: string;
  mac_address?: string;
  ip_address?: string;
  status: string;
  last_seen_at?: string | null;
  posture_score?: number;
  ownership?: string;
  enforcement?: any;
  metadata?: Record<string, any>;
  employee?: { first_name?: string; last_name?: string; email?: string };
};

function deviceIcon(device: Device) {
  const os = `${device.os_type || ""} ${device.hostname || ""}`.toLowerCase();
  if (os.includes("darwin") || os.includes("mac") || os.includes("laptop")) return Laptop;
  if (os.includes("ios") || os.includes("android") || os.includes("mobile")) return Smartphone;
  return Monitor;
}

function relativeTime(value?: string | null) {
  if (!value) return "Never";
  const ts = new Date(value).getTime();
  if (Number.isNaN(ts)) return "Unknown";
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [scheduleFor, setScheduleFor] = useState<Device | null>(null);

  async function loadDevices() {
    setError("");
    try {
      const res = await deviceApi.list();
      const rows = res.data?.rows;
      setDevices(
        Array.isArray(rows) && rows.length > 0
          ? rows.map((r: any) => ({ ...r.device, enforcement: r.enforcement }))
          : res.data?.data || []
      );
    } catch {
      setError("Could not load devices. Check API connectivity and organization scope.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDevices();
    const t = setInterval(loadDevices, 30000);
    return () => clearInterval(t);
  }, []);

  const stats = useMemo(() => {
    const online = devices.filter((d) => d.status === "online").length;
    const offline = devices.filter((d) => d.status !== "online").length;
    const current = devices.filter((d) => (d.agent_version || "").startsWith("1.0")).length;
    return [
      { label: "Total Devices", value: devices.length, icon: Monitor, color: "bg-brand-500/10 text-brand-500" },
      { label: "Online", value: online, icon: Shield, color: "bg-green-500/10 text-success" },
      { label: "Offline", value: offline, icon: AlertCircle, color: "bg-elevated text-body" },
      { label: "Agent v1.0+", value: current, icon: Laptop, color: "bg-purple-500/10 text-accent-purple" },
    ];
  }, [devices]);

  async function revokeDevice(device: Device) {
    if (!confirm(`Revoke ${device.hostname || "this device"}? The installed agent token will stop working.`)) return;
    setRevokingId(device.id);
    try {
      await deviceApi.revoke(device.id);
      await loadDevices();
    } catch {
      setError("Could not revoke device. Please try again.");
    } finally {
      setRevokingId(null);
    }
  }

  const pagedDevices = useMemo(
    () => devices.slice((page - 1) * limit, page * limit),
    [devices, page]
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Devices</h2>
        <p className="text-sm text-muted-foreground mt-1">Endpoint agent status and management</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map(s => (
          <div key={s.label} className="bg-card rounded-xl p-4 border border-border shadow-sm flex items-center gap-3">
            <div className={`p-2 rounded-lg ${s.color}`}><s.icon className="w-4 h-4" /></div>
            <div>
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-xl font-bold text-foreground">{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-sm text-danger">{error}</div>
      )}

      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="font-semibold text-foreground">Registered Devices</h3>
          <p className="text-xs text-subtle mt-0.5">Devices with Delsecure endpoint agent installed</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3 text-left font-medium">Device</th>
                <th className="px-5 py-3 text-left font-medium">Employee</th>
                <th className="px-5 py-3 text-left font-medium">OS</th>
                <th className="px-5 py-3 text-left font-medium">Agent</th>
                <th className="px-5 py-3 text-left font-medium">Status</th>
                <th className="px-5 py-3 text-left font-medium">Ownership</th>
                <th className="px-5 py-3 text-left font-medium">Enforcement</th>
                <th className="px-5 py-3 text-left font-medium">Posture</th>
                <th className="px-5 py-3 text-left font-medium">IP / Geo</th>
                <th className="px-5 py-3 text-left font-medium">Last Seen</th>
                <th className="px-5 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-elevated">
              {loading && (
                <tr>
                  <td colSpan={11} className="px-5 py-10 text-center text-muted-foreground">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
                    Loading enrolled devices...
                  </td>
                </tr>
              )}
              {!loading && devices.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-5 py-10 text-center text-muted-foreground">
                    No enrolled devices yet. Ask employees to download the agent from the employee portal.
                  </td>
                </tr>
              )}
              {!loading && pagedDevices.map(d => {
                const Icon = deviceIcon(d);
                const employee = d.employee
                  ? `${d.employee.first_name || ""} ${d.employee.last_name || ""}`.trim() || d.employee.email || "Unassigned"
                  : "Unassigned";
                const geo = d.metadata?.geo_country_code || d.metadata?.geo_country || "";
                return (
                  <tr key={d.id} className="hover:bg-elevated">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-elevated rounded-lg flex items-center justify-center">
                          <Icon className="w-4 h-4 text-muted-foreground" />
                        </div>
                        <div>
                          <p className="font-mono text-sm font-medium text-body">{d.hostname || "Unknown"}</p>
                          <p className="text-[11px] text-subtle">{d.mac_address || "No MAC reported"}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-body">{employee}</td>
                    <td className="px-5 py-4 text-muted-foreground text-xs">{[d.os_type, d.os_version].filter(Boolean).join(" ") || "Unknown"}</td>
                    <td className="px-5 py-4 text-muted-foreground text-xs font-mono">{d.agent_version || "unknown"}</td>
                    <td className="px-5 py-4">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[d.status] ?? "bg-elevated text-body"}`}>
                        {d.status}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <select
                        value={d.ownership || "company"}
                        onChange={async e => {
                          const next = e.target.value as "company" | "personal";
                          try {
                            await deviceApi.setOwnership(d.id, next);
                            setDevices(list => list.map(x => (x.id === d.id ? { ...x, ownership: next } : x)));
                            toast.success(next === "personal"
                              ? "Marked as a personal device"
                              : "Marked as company-owned");
                          } catch {
                            toast.error("Could not update ownership");
                          }
                        }}
                        className="rounded-lg border border-border bg-background px-2 py-1 text-xs outline-none focus:border-brand-500"
                      >
                        <option value="company">Company</option>
                        <option value="personal">Personal (BYOD)</option>
                      </select>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <EnforcementBadge state={d.enforcement} />
                        <button
                          onClick={() => setScheduleFor(d)}
                          title="Working hours for this device"
                          className="text-subtle hover:text-brand-500"
                        >
                          <Clock className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {d.ownership === "personal" && d.enforcement?.mode === "full" && !d.enforcement?.until && (
                        <p className="text-[11px] text-warning mt-1">Personal device, monitored 24×7</p>
                      )}
                    </td>
                    <td className="px-5 py-4 text-xs text-body">{d.posture_score ?? 100}/100</td>
                    <td className="px-5 py-4 text-xs text-muted-foreground">
                      <div>{d.ip_address || "No IP"}</div>
                      {geo && <div className="text-subtle">{geo}</div>}
                    </td>
                    <td className="px-5 py-4 text-xs text-subtle">{relativeTime(d.last_seen_at)}</td>
                    <td className="px-5 py-4 text-right">
                      <button
                        onClick={() => revokeDevice(d)}
                        disabled={revokingId === d.id}
                        className="inline-flex items-center gap-1 text-xs text-danger hover:text-danger disabled:opacity-50"
                      >
                        {revokingId === d.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                        Revoke
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <Pagination
          page={page}
          totalPages={Math.ceil(devices.length / limit)}
          total={devices.length}
          limit={limit}
          onPageChange={setPage}
          onLimitChange={n => { setLimit(n); setPage(1); }}
        />
      </div>

      {scheduleFor && (
        <DeviceScheduleModal
          device={scheduleFor}
          onClose={() => setScheduleFor(null)}
          onSaved={() => { setScheduleFor(null); loadDevices(); }}
        />
      )}

      <div className="bg-brand-500/10 border border-brand-500/30 rounded-xl p-5">
        <div className="flex items-start gap-3">
          <Shield className="w-5 h-5 text-brand-500 flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="font-semibold text-brand-500">Endpoint Agent Deployment</h4>
            <p className="text-sm text-body mt-1">
              Install the Delsecure Windows agent on employee machines to enable real-time DNS filtering,
              web policy enforcement, DLP, malware scanning, and SSL inspection where the org CA is trusted.
              Employees can download installers from the employee portal.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
