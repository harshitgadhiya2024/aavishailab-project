"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { reportApi } from "@/lib/api";
import {
  Users, FileText, Shield, Activity, AlertTriangle, FileWarning, Bug,
  TrendingUp, TrendingDown, Minus, Monitor, Inbox, ArrowRight, Clock,
} from "lucide-react";
import { formatNumber, cn } from "@/lib/utils";
import { useChartTheme } from "@/lib/chart-theme";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, PieChart, Pie, Legend, LabelList,
} from "recharts";

const RANGES = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** A headline number is a stat tile, never a one-bar chart. */
function StatTile({
  label, value, sub, icon: Icon, tone, delta,
}: {
  label: string; value: string; sub?: string; icon: React.ElementType;
  tone: string; delta?: number | null;
}) {
  // More blocks isn't automatically "bad" and fewer isn't "good", so the delta
  // states direction and size without colouring it as a verdict.
  const DeltaIcon = delta == null ? Minus : delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  return (
    <div className="bg-card rounded-xl p-5 border border-border shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-3xl font-bold text-foreground mt-1 tabular-nums">{value}</p>
          {sub && <p className="text-xs text-subtle mt-1">{sub}</p>}
        </div>
        <div className={cn("p-2 rounded-lg flex-shrink-0", tone)}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <div className="flex items-center gap-1.5 mt-3 text-xs text-muted-foreground">
        <DeltaIcon className="w-3.5 h-3.5" />
        {delta == null ? "no prior period" : `${delta > 0 ? "+" : ""}${delta}% vs previous period`}
      </div>
    </div>
  );
}

function ChartCard({
  title, subtitle, children,
}: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-card rounded-xl border border-border shadow-sm p-5">
      <div className="mb-4">
        <h3 className="font-semibold text-foreground text-sm">{title}</h3>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function EmptyPlot({ message, height = 240 }: { message: string; height?: number }) {
  return (
    <div style={{ height }} className="flex flex-col items-center justify-center text-subtle text-sm">
      <Activity className="w-8 h-8 mb-2 opacity-30" />
      {message}
    </div>
  );
}

export default function DashboardPage() {
  const chart = useChartTheme();
  const [days, setDays] = useState(30);

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-overview", days],
    queryFn: () => reportApi.overview({ days }),
    refetchInterval: 60_000,
  });

  const d = data?.data ?? {};
  const kpis = d.kpis ?? {};
  const coverage = d.coverage ?? {};
  const deltas = kpis.delta ?? {};

  const trend = useMemo(
    () => (d.trend ?? []).map((p: any) => ({ ...p, label: shortDate(p.date) })),
    [d.trend]
  );

  const byAction = useMemo(
    () => (d.by_action ?? []).map((r: any) => ({
      name: r.label,
      value: r.count,
      fill: chart.action[r.label] ?? chart.neutral,
    })),
    [d.by_action, chart]
  );

  const byCategory = useMemo(
    () => (d.by_category ?? []).slice(0, 6).map((r: any) => ({
      name: r.label.replace(/_/g, " "),
      count: r.count,
    })),
    [d.by_category]
  );

  const byOperation = useMemo(
    () => (d.by_operation ?? []).slice(0, 6).map((r: any) => ({ name: r.label, count: r.count })),
    [d.by_operation]
  );

  const topDomains = useMemo(
    () => (d.top_domains ?? []).slice(0, 8).map((r: any) => ({
      name: r.domain.length > 26 ? r.domain.slice(0, 24) + "…" : r.domain,
      count: r.count,
    })),
    [d.top_domains]
  );

  const detectors = useMemo(
    () => (d.top_detectors ?? []).map((r: any) => ({
      name: r.label.replace(/_/g, " "),
      count: r.count,
    })),
    [d.top_detectors]
  );

  const hourly = useMemo(
    () => (d.hourly ?? []).map((h: any) => ({
      hour: `${String(h.hour).padStart(2, "0")}:00`,
      incidents: h.incidents,
    })),
    [d.hourly]
  );

  const topUsers = d.top_users ?? [];
  const hasEvents = (kpis.total_events ?? 0) > 0;

  const tooltip = {
    contentStyle: chart.tooltip as any,
    labelStyle: { color: chart.axis, fontSize: 11 },
    itemStyle: { fontSize: 11 },
  };
  const axis = { stroke: chart.axis, fontSize: 11, tickLine: false, axisLine: false };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Security Overview</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {isLoading ? "Loading…" : `Last ${days} days across your organization`}
          </p>
        </div>
        <div className="flex items-center gap-1 bg-background border border-border rounded-lg p-1">
          {RANGES.map(r => (
            <button
              key={r.days}
              onClick={() => setDays(r.days)}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                days === r.days ? "bg-brand-500 text-white" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile
          label="Security incidents" value={formatNumber((kpis.blocked ?? 0) + (kpis.alerted ?? 0))}
          sub={`${formatNumber(kpis.blocked ?? 0)} blocked · ${formatNumber(kpis.alerted ?? 0)} alerted`}
          icon={Shield} tone="bg-red-500/10 text-danger" delta={deltas.blocked}
        />
        <StatTile
          label="DLP incidents" value={formatNumber(kpis.dlp_incidents ?? 0)}
          sub="sensitive data stopped or flagged"
          icon={FileWarning} tone="bg-yellow-500/10 text-warning" delta={deltas.dlp_incidents}
        />
        <StatTile
          label="Malware detections" value={formatNumber(kpis.malware ?? 0)}
          sub="files caught on download"
          icon={Bug} tone="bg-purple-500/10 text-accent-purple"
        />
        <StatTile
          label="Employees affected" value={formatNumber(kpis.affected_users ?? 0)}
          sub={`of ${formatNumber(coverage.employees ?? 0)} employees`}
          icon={Users} tone="bg-brand-500/10 text-brand-500"
        />
      </div>

      {/* Coverage strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Devices enrolled", value: `${coverage.devices_online ?? 0}/${coverage.devices ?? 0}`, sub: "online now", icon: Monitor, href: "/dashboard/devices" },
          { label: "Employees protected", value: `${coverage.protected_employees ?? 0}/${coverage.employees ?? 0}`, sub: "have an agent", icon: Users, href: "/dashboard/employees" },
          { label: "Active policies", value: `${coverage.policies_enabled ?? 0}/${coverage.policies ?? 0}`, sub: "enabled", icon: FileText, href: "/dashboard/policies" },
          { label: "Pending requests", value: formatNumber(coverage.pending_requests ?? 0), sub: "awaiting review", icon: Inbox, href: "/dashboard/access-requests" },
        ].map(item => (
          <Link key={item.label} href={item.href}
            className="bg-card rounded-xl p-4 border border-border shadow-sm flex items-center gap-3 hover:bg-elevated transition-colors">
            <div className="p-2 rounded-lg bg-elevated text-muted-foreground flex-shrink-0">
              <item.icon className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">{item.label}</p>
              <p className="text-lg font-semibold text-foreground tabular-nums">{item.value}</p>
              <p className="text-[11px] text-subtle">{item.sub}</p>
            </div>
            <ArrowRight className="w-3.5 h-3.5 text-faint flex-shrink-0" />
          </Link>
        ))}
      </div>

      {/* Trend — the headline chart */}
      <ChartCard
        title="Activity over time"
        subtitle="Blocked and alerted events per day, with total traffic for context"
      >
        {trend.length === 0 ? (
          <EmptyPlot message="No activity recorded in this period" height={280} />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={trend} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="gTotal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={chart.categorical[0]} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={chart.categorical[0]} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
              <XAxis dataKey="label" {...axis} minTickGap={24} />
              <YAxis {...axis} allowDecimals={false} width={44} />
              <Tooltip {...tooltip} />
              <Legend wrapperStyle={{ fontSize: 11, color: chart.axis }} iconType="plainline" />
              <Area type="monotone" dataKey="total" name="All events" stroke={chart.categorical[0]}
                strokeWidth={2} fill="url(#gTotal)" dot={false} />
              <Area type="monotone" dataKey="blocked" name="Blocked" stroke={chart.action.blocked}
                strokeWidth={2} fill="none" dot={false} />
              <Area type="monotone" dataKey="alerted" name="Alerted" stroke={chart.action.alerted}
                strokeWidth={2} fill="none" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Outcome mix */}
        <ChartCard title="What happened to traffic" subtitle="Every event by enforcement outcome">
          {byAction.length === 0 ? (
            <EmptyPlot message="No events yet" />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={byAction} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90}
                  paddingAngle={2} stroke={chart.tooltip.background as string} strokeWidth={2}>
                  {byAction.map((entry: any) => <Cell key={entry.name} fill={entry.fill} />)}
                </Pie>
                <Tooltip {...tooltip} />
                <Legend wrapperStyle={{ fontSize: 11, color: chart.axis }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* Category mix */}
        <ChartCard title="Incidents by category" subtitle="Which control caught them">
          {byCategory.length === 0 ? (
            <EmptyPlot message="No categorised incidents yet" />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={byCategory} layout="vertical" margin={{ top: 0, right: 40, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} horizontal={false} />
                <XAxis type="number" {...axis} allowDecimals={false} />
                <YAxis type="category" dataKey="name" {...axis} width={110} />
                <Tooltip {...tooltip} cursor={{ fill: chart.grid, opacity: 0.3 }} />
                <Bar dataKey="count" name="Incidents" fill={chart.categorical[0]} radius={[0, 4, 4, 0]} barSize={16}>
                  <LabelList dataKey="count" position="right" fill={chart.axis} fontSize={11} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* Top destinations */}
        <ChartCard title="Most-hit destinations" subtitle="Domains behind blocked and alerted events">
          {topDomains.length === 0 ? (
            <EmptyPlot message="No blocked destinations in this period" height={260} />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={topDomains} layout="vertical" margin={{ top: 0, right: 40, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} horizontal={false} />
                <XAxis type="number" {...axis} allowDecimals={false} />
                <YAxis type="category" dataKey="name" {...axis} width={150} />
                <Tooltip {...tooltip} cursor={{ fill: chart.grid, opacity: 0.3 }} />
                <Bar dataKey="count" name="Events" radius={[0, 4, 4, 0]} barSize={14}>
                  {topDomains.map((_: any, i: number) => (
                    // Sequential ramp: darker = more hits, so rank reads without a legend.
                    <Cell key={i} fill={chart.sequential[Math.max(0, chart.sequential.length - 1 - i)]} />
                  ))}
                  <LabelList dataKey="count" position="right" fill={chart.axis} fontSize={11} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* Data-in-motion */}
        <ChartCard title="How data was moving" subtitle="Operation behind each incident">
          {byOperation.length === 0 ? (
            <EmptyPlot message="No operations recorded yet" height={260} />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={byOperation} margin={{ top: 16, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
                <XAxis dataKey="name" {...axis} interval={0} angle={-15} textAnchor="end" height={58} />
                <YAxis {...axis} allowDecimals={false} width={44} />
                <Tooltip {...tooltip} cursor={{ fill: chart.grid, opacity: 0.3 }} />
                <Bar dataKey="count" name="Events" fill={chart.categorical[1]} radius={[4, 4, 0, 0]} barSize={28}>
                  <LabelList dataKey="count" position="top" fill={chart.axis} fontSize={11} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* When incidents happen */}
        <ChartCard title="When incidents happen" subtitle="Incidents by hour of day — off-hours spikes stand out">
          {!hasEvents ? (
            <EmptyPlot message="Not enough activity to show a pattern" />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={hourly} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
                <XAxis dataKey="hour" {...axis} interval={3} />
                <YAxis {...axis} allowDecimals={false} width={44} />
                <Tooltip {...tooltip} cursor={{ fill: chart.grid, opacity: 0.3 }} />
                <Bar dataKey="incidents" name="Incidents" fill={chart.categorical[2]} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* DLP detectors */}
        <ChartCard title="Sensitive data detected" subtitle="Which DLP detectors fired most">
          {detectors.length === 0 ? (
            <EmptyPlot message="No DLP detections in this period" />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={detectors} layout="vertical" margin={{ top: 0, right: 40, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} horizontal={false} />
                <XAxis type="number" {...axis} allowDecimals={false} />
                <YAxis type="category" dataKey="name" {...axis} width={130} />
                <Tooltip {...tooltip} cursor={{ fill: chart.grid, opacity: 0.3 }} />
                <Bar dataKey="count" name="Detections" fill={chart.categorical[3]} radius={[0, 4, 4, 0]} barSize={14}>
                  <LabelList dataKey="count" position="right" fill={chart.axis} fontSize={11} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Riskiest employees — a ranked list is a table, not a chart */}
      <div className="bg-card rounded-xl border border-border shadow-sm">
        <div className="p-5 border-b border-border flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-foreground text-sm">Employees with the most incidents</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Blocked and alerted events in this period</p>
          </div>
          <Link href="/dashboard/reports" className="text-xs text-brand-500 hover:text-brand-400 flex items-center gap-1">
            Full report <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3 text-left font-medium">Employee</th>
                <th className="px-5 py-3 text-left font-medium">Department</th>
                <th className="px-5 py-3 text-left font-medium">Incidents</th>
                <th className="px-5 py-3 text-left font-medium">Blocked</th>
                <th className="px-5 py-3 text-left font-medium">DLP</th>
                <th className="px-5 py-3 text-left font-medium">Highest risk</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-elevated">
              {topUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-10 text-subtle text-sm">
                    <Shield className="w-7 h-7 mx-auto mb-2 opacity-30" />
                    No employee incidents in this period
                  </td>
                </tr>
              ) : (
                topUsers.slice(0, 8).map((u: any) => (
                  <tr key={u.employee_id} className="hover:bg-elevated transition-colors">
                    <td className="px-5 py-3">
                      <p className="text-foreground font-medium">{u.name || u.email}</p>
                      <p className="text-xs text-subtle">{u.email}</p>
                    </td>
                    <td className="px-5 py-3 text-body text-xs">{u.department || "—"}</td>
                    <td className="px-5 py-3 text-body tabular-nums">{u.incidents}</td>
                    <td className="px-5 py-3 text-danger tabular-nums">{u.blocked}</td>
                    <td className="px-5 py-3 text-warning tabular-nums">{u.dlp}</td>
                    <td className="px-5 py-3">
                      <span className={cn("px-2 py-0.5 rounded-md text-xs font-semibold tabular-nums",
                        u.max_risk >= 80 ? "bg-red-500/10 text-danger"
                          : u.max_risk >= 50 ? "bg-yellow-500/10 text-warning"
                          : "bg-elevated text-body")}>
                        {u.max_risk || "—"}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!isLoading && !hasEvents && (
        <div className="bg-brand-500/10 border border-brand-500/30 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-brand-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="text-foreground font-medium">No activity recorded yet</p>
            <p className="text-muted-foreground mt-0.5">
              Figures appear once endpoint agents start reporting. Enrol a device from{" "}
              <Link href="/dashboard/devices" className="text-brand-500 hover:underline">Devices</Link>,
              or widen the period above.
            </p>
          </div>
        </div>
      )}

      <p className="text-xs text-subtle flex items-center gap-1.5">
        <Clock className="w-3 h-3" /> Refreshes every 60 seconds
      </p>
    </div>
  );
}
