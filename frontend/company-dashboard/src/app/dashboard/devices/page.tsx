"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { Pagination } from "@/components/ui/Pagination";

import { Monitor, Laptop, Smartphone, Shield, AlertCircle, Loader2, Trash2, Clock, Ban, Send, HelpCircle } from "lucide-react";
import { deviceApi } from "@/lib/api";
import { EnforcementBadge } from "@/components/enforcement/ScheduleEditor";
import { DeviceScheduleModal } from "@/components/enforcement/DeviceScheduleModal";
import { toast } from "sonner";
import { MetricCard, MetricRow, type MetricTone } from "@/components/ui/MetricCard";

const STATUS_COLORS: Record<string, string> = {
  online: "bg-green-500/10 text-success",
  offline: "bg-elevated text-body",
  warning: "bg-yellow-500/10 text-warning",
  revoked: "bg-red-500/10 text-danger",
};

/** One connect / disconnect / uninstall, as the company sees it. */
type LifecycleEvent = {
  id: string;
  employee: string;
  event: string;
  event_type: string;
  hostname?: string;
  detail?: string;
  timestamp?: string;
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

/**
 * Per-device OS-permission state, so an admin can see at a glance which
 * employee's machine has a feature stuck waiting on a grant rather than
 * silently producing nothing. The agent reports these on every heartbeat
 * (device.metadata.cap_*); an agent too old to report them, or one that
 * has not beaten since this shipped, leaves them undefined — shown as
 * "unknown" rather than as a failure, since we genuinely do not know.
 *
 * A missing permission is not a device fault: the agent keeps running and
 * every other feature keeps working. It is a call to action for whoever
 * owns that machine, which is why the "needs attention" state is amber,
 * not red.
 */
function PermissionCells({ device }: { device: Device }) {
  const items: { label: string; granted?: boolean; hint: string }[] = [
    {
      label: "Screen",
      granted: device.metadata?.cap_screen_recording,
      hint: "Screen Recording — required for screenshots",
    },
    {
      label: "Input",
      granted: device.metadata?.cap_input_monitoring,
      hint: "Input Monitoring — required for keyboard activity",
    },
  ];
  return (
    <div className="flex flex-col gap-1">
      {items.map((it) => {
        const cls =
          it.granted === undefined
            ? "bg-elevated text-subtle"
            : it.granted
            ? "bg-green-500/10 text-success"
            : "bg-yellow-500/10 text-warning";
        const text =
          it.granted === undefined ? "unknown" : it.granted ? "on" : "needs grant";
        return (
          <span
            key={it.label}
            title={it.hint}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[4px] text-[11px] font-medium w-fit whitespace-nowrap ${cls}`}
          >
            {it.label}: {text}
          </span>
        );
      })}
    </div>
  );
}

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [helpFor, setHelpFor] = useState<string | null>(null);
  const [scheduleFor, setScheduleFor] = useState<Device | null>(null);
  const [lifecycle, setLifecycle] = useState<LifecycleEvent[]>([]);

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

  async function loadLifecycle() {
    try {
      const res = await deviceApi.activity({ limit: 25 });
      setLifecycle(res.data?.data || []);
    } catch {
      // A missing trail shouldn't blank the page the devices are on.
    }
  }

  useEffect(() => {
    loadDevices();
    loadLifecycle();
    const t = setInterval(() => { loadDevices(); loadLifecycle(); }, 30000);
    return () => clearInterval(t);
  }, []);

  const stats = useMemo(() => {
    const online = devices.filter((d) => d.status === "online").length;
    const revoked = devices.filter((d) => d.status === "revoked").length;
    const offline = devices.length - online - revoked;
    const pct = (n: number) => (devices.length ? `${Math.round((n / devices.length) * 100)}% of devices` : "no devices yet");
    return [
      { label: "Devices", value: devices.length, icon: Monitor, tone: "neutral" as MetricTone, detail: "enrolled in Aavishield" },
      { label: "Online", value: online, icon: Shield, tone: (online ? "good" : "neutral") as MetricTone, detail: pct(online) },
      { label: "Offline", value: offline, icon: AlertCircle, tone: (offline ? "warn" : "neutral") as MetricTone, detail: offline ? "not checked in recently" : "all checking in" },
      { label: "Revoked", value: revoked, icon: Ban, tone: (revoked ? "bad" : "neutral") as MetricTone, detail: revoked ? "not protected" : "none revoked" },
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

  async function sendReconnectLink(device: Device) {
    setSendingId(device.id);
    try {
      const res = await deviceApi.reconnectLink(device.id);
      toast.success(`Reconnect instructions sent to ${res.data?.email || "the employee"}`);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Could not send the reconnect link.");
    } finally {
      setSendingId(null);
    }
  }

  const pagedDevices = useMemo(
    () => devices.slice((page - 1) * limit, page * limit),
    [devices, page]
  );

  return (
    <div className="space-y-6">
      <div>
        <p className="page-eyebrow">Organization</p>
        <h2 className="mt-2 text-[2rem] font-normal leading-[1.1] tracking-[-0.035em] text-foreground">Devices</h2>
        <p className="text-sm text-muted-foreground mt-1">Endpoint agent status and management</p>
      </div>

      <MetricRow>
        {stats.map(s => <MetricCard key={s.label} label={s.label} value={s.value} detail={s.detail} icon={s.icon} tone={s.tone} />)}
      </MetricRow>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-sm text-danger">{error}</div>
      )}

      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="font-semibold text-foreground">Registered Devices</h3>
          <p className="text-xs text-subtle mt-0.5">Devices with Aavishield endpoint agent installed</p>
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
                <th className="px-5 py-3 text-left font-medium">Permissions</th>
                <th className="px-5 py-3 text-left font-medium">IP / Geo</th>
                <th className="px-5 py-3 text-left font-medium">Last Seen</th>
                <th className="px-5 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-elevated">
              {loading && (
                <tr>
                  <td colSpan={12} className="px-5 py-10 text-center text-muted-foreground">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
                    Loading enrolled devices...
                  </td>
                </tr>
              )}
              {!loading && devices.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-5 py-10 text-center text-muted-foreground">
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
                const isRevoked = d.status === "revoked";
                const dim = isRevoked ? "opacity-50" : "";
                return (
                  <Fragment key={d.id}>
                  <tr className={isRevoked ? "bg-red-500/[0.03]" : "hover:bg-elevated"}>
                    <td className={`px-5 py-4 ${dim}`}>
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
                    <td className={`px-5 py-4 text-muted-foreground text-xs ${dim}`}>{[d.os_type, d.os_version].filter(Boolean).join(" ") || "Unknown"}</td>
                    <td className={`px-5 py-4 text-muted-foreground text-xs font-mono ${dim}`}>{d.agent_version || "unknown"}</td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-[4px] text-xs font-medium ${STATUS_COLORS[d.status] ?? "bg-elevated text-body"}`}>
                        {isRevoked && <Ban className="w-3 h-3" />}
                        {isRevoked ? "Revoked" : d.status}
                      </span>
                      {isRevoked && <p className="mt-1 text-[11px] text-subtle whitespace-nowrap">Not reporting · not protected</p>}
                    </td>
                    <td className={`px-5 py-4 ${dim}`}>
                      <select
                        disabled={isRevoked}
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
                    {isRevoked ? (
                      <>
                        <td className="px-5 py-4 text-xs text-subtle">—</td>
                        <td className="px-5 py-4 text-xs text-subtle">—</td>
                        <td className="px-5 py-4 text-xs text-subtle">—</td>
                      </>
                    ) : (
                    <>
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
                    <td className="px-5 py-4">
                      <PermissionCells device={d} />
                    </td>
                    </>
                    )}
                    <td className={`px-5 py-4 text-xs text-muted-foreground ${dim}`}>
                      <div>{d.ip_address || "No IP"}</div>
                      {geo && <div className="text-subtle">{geo}</div>}
                    </td>
                    <td className="px-5 py-4 text-xs text-subtle">{relativeTime(d.last_seen_at)}</td>
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-3 whitespace-nowrap">
                        {isRevoked ? (
                          <>
                            <button
                              onClick={() => setHelpFor(helpFor === d.id ? null : d.id)}
                              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                              aria-expanded={helpFor === d.id}
                            >
                              <HelpCircle className="w-3 h-3" /> How to re-add
                            </button>
                            <button
                              onClick={() => sendReconnectLink(d)}
                              disabled={sendingId === d.id || !d.employee}
                              title={d.employee ? `Email ${d.employee.email || "the employee"} how to reconnect` : "No employee assigned to this device"}
                              className="inline-flex items-center gap-1 rounded-md bg-brand-500 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-50"
                            >
                              {sendingId === d.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                              Send reconnect link
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => revokeDevice(d)}
                            disabled={revokingId === d.id}
                            className="inline-flex items-center gap-1 text-xs text-danger hover:text-danger disabled:opacity-50"
                          >
                            {revokingId === d.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                            Revoke
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {isRevoked && helpFor === d.id && (
                    <tr className="bg-red-500/[0.03]">
                      <td colSpan={12} className="px-5 pb-5 pt-0">
                        {/* Pinned left: the table scrolls sideways, the steps shouldn't. */}
                        <div className="sticky left-5 w-[min(640px,calc(100vw-24rem))] min-w-[280px] rounded-lg border border-border bg-card p-4 text-[13px] text-muted-foreground">
                          <p className="font-medium text-foreground">Bringing {d.hostname || "this device"} back</p>
                          <ol className="mt-2 list-decimal space-y-1 pl-5">
                            <li>On that computer, {employee !== "Unassigned" ? employee : "the employee"} opens the <span className="text-foreground">Aavishield</span> app. It now says <span className="text-foreground">Removed by your IT administrator</span>.</li>
                            <li>They click <span className="text-foreground">Reconnect</span> and sign in to the employee portal in the browser page that opens.</li>
                            <li>The device returns here as the same entry, with its history, usually within a minute.</li>
                          </ol>
                          <p className="mt-2 text-[12px] text-subtle">
                            <span className="text-foreground">Send reconnect link</span> emails them these steps. If the app was uninstalled, they download it again from the employee portal.
                            Older agents without a Reconnect button: click Disconnect, reopen the app, then Connect.
                          </p>
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
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

      {/* Connector activity — who connected, disconnected or removed the
          connector, and when. Kept apart from the web-traffic activity feed:
          these events have no domain or risk score, only who/what/when. */}
      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="font-semibold text-foreground">Connector Activity</h3>
          <p className="text-xs text-subtle mt-0.5">
            Connect, disconnect and uninstall events per employee
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3 text-left font-medium">Employee</th>
                <th className="px-5 py-3 text-left font-medium">Event</th>
                <th className="px-5 py-3 text-left font-medium">Device</th>
                <th className="px-5 py-3 text-left font-medium">Details</th>
                <th className="px-5 py-3 text-left font-medium">Date &amp; Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-elevated">
              {lifecycle.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">
                    No connector activity yet.
                  </td>
                </tr>
              )}
              {lifecycle.map(ev => (
                <tr key={ev.id} className="hover:bg-elevated/50">
                  <td className="px-5 py-3 text-foreground">{ev.employee}</td>
                  <td className="px-5 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      ev.event_type === "device_connect" ? "bg-green-500/10 text-success"
                        : ev.event_type === "device_uninstall" ? "bg-red-500/10 text-danger"
                        : "bg-yellow-500/10 text-warning"
                    }`}>
                      {ev.event}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{ev.hostname || "—"}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{ev.detail || "—"}</td>
                  <td className="px-5 py-3 text-xs text-subtle whitespace-nowrap">
                    {ev.timestamp ? new Date(ev.timestamp).toLocaleString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
              Install the Aavishield Windows agent on employee machines to enable real-time DNS filtering,
              web policy enforcement, DLP, malware scanning, and SSL inspection where the org CA is trusted.
              Employees can download installers from the employee portal.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
