"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useTheme } from "next-themes";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle, AppWindow, ArrowDownRight, ArrowRight, ArrowUpRight, Bug, CheckCircle2, Clock,
  Download, FileWarning, Globe, Inbox, Laptop, Loader2, MonitorCheck, ShieldAlert, ShieldCheck,
  ShieldOff, ShieldX, Sparkles, type LucideIcon,
} from "lucide-react";
import { portalApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { periodFor, periodText, viewerTimeZone, type Period, type PeriodId } from "@/lib/report-period";
import { PeriodPicker } from "@/components/dashboard/PeriodPicker";

// ─── Types (mirror GET /api/v1/portal/overview) ───────────────────────────────

type ControlId = "dlp" | "web" | "apps" | "vpn" | "threats" | "devices";
type ControlStat = { id: ControlId; label: string; count: number; blocked: number; alerted: number; prev: number; delta: number | null };
type TrendPoint = { t: string; total: number } & Partial<Record<ControlId, number>>;
type Issue = { name: string; fix: string };
type Device = {
  id: string; hostname: string; os: string; agent_version: string; latest_version?: string;
  update_available: boolean; status: string; last_seen_at: string | null; stale: boolean;
  ownership: string; security_score: number; issues: Issue[];
  enforcement: { active: boolean; mode: string; reason: string; until?: string | null };
};
type Tip = { severity: "high" | "medium" | "info"; title: string; detail: string; href?: string; action?: string };
type Overview = {
  period: { start: string; end: string; tz: string; bucket: "hour" | "day" };
  employee: { first_name: string; full_name: string; department: string; job_title: string; team: string };
  protection: { status: "protected" | "attention" | "unprotected"; headline: string; devices_total: number; devices_online: number; settings_off: number; stale: number; updates: number; paused: number };
  devices: Device[];
  totals: { incidents: number; prev: number; delta: number | null; blocked: number; flagged: number };
  controls: ControlStat[];
  trend: TrendPoint[];
  top_sites: { domain: string; category: string; count: number; last: string; request_status: string }[];
  top_apps: { name: string; control: string; count: number; last: string }[];
  sensitive_data: { count: number; high: number; services: { service: string; count: number; high: number }[]; types: { label: string; count: number }[] };
  work: {
    enabled: boolean; screenshots_blurred?: boolean; tracked_seconds?: number; active_seconds?: number; active_percent?: number;
    days_worked?: number; avg_per_day_seconds?: number; sessions?: number; screenshots?: number;
    by_day?: { date: string; tracked_seconds: number }[];
    recent_sessions?: { started_at: string; ended_at: string | null; tracked_seconds: number; avg_activity: number }[];
  };
  access_requests: { pending: number; in_period: Record<string, number>; recent: { id: string; label: string; status: string; created_at: string; review_note: string }[] };
  recent: { at: string; control: ControlId; control_label: string; action: string; what: string; operation: string; policy: string; data_types?: string[] }[];
  tips: Tip[];
  truncated: boolean;
};

// ─── Presentation helpers ─────────────────────────────────────────────────────

const CONTROL_META: Record<ControlId, { label: string; icon: LucideIcon }> = {
  dlp: { label: "Sensitive data", icon: FileWarning },
  web: { label: "Websites", icon: Globe },
  apps: { label: "Apps", icon: AppWindow },
  vpn: { label: "VPN & bypass", icon: ShieldOff },
  threats: { label: "Malware & threats", icon: Bug },
  devices: { label: "Device health", icon: MonitorCheck },
};
const CONTROL_ORDER: ControlId[] = ["dlp", "web", "apps", "vpn", "threats", "devices"];

// Same validated categorical palette as the company dashboard, in the same
// order, so a control has one colour across the whole product.
const PALETTE = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#6B7280"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#6B6B6B"],
};
function useControlColors() {
  const { resolvedTheme } = useTheme();
  const p = resolvedTheme === "light" ? PALETTE.light : PALETTE.dark;
  return (id: ControlId) => p[CONTROL_ORDER.indexOf(id)] ?? p[5];
}

function duration(seconds = 0) {
  if (seconds <= 0) return "0m";
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60);
  return h === 0 ? `${m}m` : `${h}h ${String(m).padStart(2, "0")}m`;
}
function ago(iso?: string | null) {
  if (!iso) return "never";
  try { return formatDistanceToNow(new Date(iso), { addSuffix: true }); } catch { return ""; }
}
function when(iso: string) {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

const PERIOD_OPTIONS: PeriodId[] = ["today", "yesterday", "7d", "30d", "this_month", "3m"];
const STORAGE_KEY = "aavishield-portal-period";

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { data: session } = useSession();
  const [period, setPeriod] = useState<Period>(() => periodFor("7d"));

  // Remember the chosen preset between visits (a custom range is a one-off).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as PeriodId | null;
      if (saved && PERIOD_OPTIONS.includes(saved)) setPeriod(periodFor(saved));
    } catch { /* storage blocked: the default is fine */ }
  }, []);
  const choose = (p: Period) => {
    setPeriod(p);
    try { if (p.id !== "custom") localStorage.setItem(STORAGE_KEY, p.id); } catch { /* ignore */ }
  };

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ["portal-overview", period.start, period.end],
    queryFn: () => portalApi.overview({ start: period.start, end: period.end, tz: viewerTimeZone() }),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const o: Overview | undefined = data?.data;
  const firstName = o?.employee.first_name || (session?.user as any)?.first_name || "there";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="page-eyebrow">Overview</p>
          <h2 className="mt-2 text-[2rem] font-normal leading-[1.1] tracking-[-0.035em] text-foreground">Welcome, {firstName}</h2>
          <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            Your protection and activity · {periodText(period)}
            {isFetching && !isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          </p>
        </div>
        <PeriodPicker value={period} onChange={choose} options={PERIOD_OPTIONS} />
      </div>

      {isLoading ? <Skeleton /> : isError || !o ? <LoadError error={error} /> : (
        <>
          <ProtectionHero o={o} />
          {o.tips.length > 0 && <Tips tips={o.tips} />}
          <Kpis o={o} />
          <div className="grid gap-6 lg:grid-cols-3">
            <TrendCard o={o} className="lg:col-span-2" />
            <ControlBreakdown o={o} />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <TopSites o={o} />
            <TopApps o={o} />
          </div>
          {(o.sensitive_data.count > 0 || o.work.enabled) && (
            <div className="grid gap-6 lg:grid-cols-2">
              {o.sensitive_data.count > 0 && <SensitiveData o={o} />}
              {o.work.enabled && <WorkTime o={o} singleDay={period.start === period.end} />}
            </div>
          )}
          <div className="grid gap-6 lg:grid-cols-2">
            <Devices o={o} />
            <Requests o={o} />
          </div>
          <Recent o={o} />
          {o.truncated && (
            <p className="text-center text-xs text-subtle">This period has a very large amount of activity; figures cover the first 500,000 events.</p>
          )}
        </>
      )}
    </div>
  );
}

// ─── Sections ─────────────────────────────────────────────────────────────────

function Card({ title, subtitle, action, children, className }: {
  title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    // The website’s UI card: a mono title bar over a hairline, then the content.
    <section className={cn("flex flex-col rounded-lg border border-border bg-card", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <h3 className="font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-foreground">{title}</h3>
        {action}
      </div>
      <div className="flex flex-1 flex-col p-5">
        {subtitle && <p className="-mt-1 mb-4 text-[13px] text-muted-foreground">{subtitle}</p>}
        {children}
      </div>
    </section>
  );
}

function Empty({ icon: Icon = CheckCircle2, text }: { icon?: LucideIcon; text: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
      <Icon className="h-6 w-6 text-green-500" />
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

function ProtectionHero({ o }: { o: Overview }) {
  const p = o.protection;
  const tone = {
    protected: { icon: ShieldCheck, ring: "border-green-500/30 bg-green-500/5", text: "text-green-600 dark:text-green-400" },
    attention: { icon: ShieldAlert, ring: "border-amber-500/30 bg-amber-500/5", text: "text-warning" },
    unprotected: { icon: ShieldX, ring: "border-red-500/30 bg-red-500/5", text: "text-danger" },
  }[p.status];
  const primary = o.devices[0];
  return (
    <section className={cn("flex flex-wrap items-center gap-4 rounded-lg border p-5", tone.ring)}>
      <span className={cn("grid h-12 w-12 flex-shrink-0 place-items-center rounded-md border border-border bg-card", tone.text)}>
        <tone.icon className="h-6 w-6" />
      </span>
      <div className="min-w-0 flex-1 basis-56">
        <p className={cn("[font-family:Satoshi,var(--font-inter),sans-serif] text-[1.35rem] font-medium tracking-[-0.02em]", tone.text)}>{p.headline}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {p.devices_total === 0
            ? "Install the agent so your company's protection can keep you safe online."
            : <>
                {p.devices_online} of {p.devices_total} {p.devices_total === 1 ? "device" : "devices"} online
                {primary?.enforcement?.reason ? <> · {primary.enforcement.reason}</> : null}
              </>}
        </p>
      </div>
      {p.devices_total === 0 ? (
        <Link href="/dashboard/download" className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-4 py-2 font-mono text-[12px] font-medium uppercase tracking-[0.06em] text-white hover:bg-brand-600">
          <Download className="h-4 w-4" /> Install agent
        </Link>
      ) : (
        <Link href="/dashboard/devices" className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.08em] text-brand-600 hover:text-brand-700 dark:text-brand-400">
          View devices <ArrowRight className="h-4 w-4" />
        </Link>
      )}
    </section>
  );
}

function Tips({ tips }: { tips: Tip[] }) {
  const sev = {
    high: "border-red-500/30 bg-red-500/5 text-danger",
    medium: "border-amber-500/30 bg-amber-500/5 text-warning",
    info: "border-brand-500/30 bg-brand-500/5 text-brand-500",
  };
  return (
    <Card title="Things to do" subtitle="Personal to you, most important first">
      <ul className="space-y-2">
        {tips.map((t, i) => (
          <li key={i} className="flex flex-wrap items-start gap-3 rounded-lg border border-border p-3 sm:flex-nowrap">
            <span className={cn("mt-0.5 grid h-6 w-6 flex-shrink-0 place-items-center rounded-full border", sev[t.severity])}>
              {t.severity === "info" ? <Sparkles className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
            </span>
            <div className="min-w-0 flex-1 basis-48">
              <p className="text-sm font-medium text-foreground">{t.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{t.detail}</p>
            </div>
            {t.href && (
              <Link href={t.href} className="ml-9 flex-shrink-0 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-body hover:bg-elevated sm:ml-0">
                {t.action || "Open"}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Delta({ value }: { value: number | null }) {
  if (value === null || value === undefined) return <span className="text-xs text-subtle">no earlier data</span>;
  if (value === 0) return <span className="text-xs text-subtle">same as before</span>;
  // Fewer incidents is good news for the employee, so down is green.
  const up = value > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium", up ? "text-danger" : "text-green-600 dark:text-green-400")}>
      <Icon className="h-3.5 w-3.5" />{Math.abs(value)}% vs previous period
    </span>
  );
}

function Kpis({ o }: { o: Overview }) {
  const items: { label: string; value: string; icon: LucideIcon; tone: string; foot?: React.ReactNode }[] = [
    { label: "Blocked or flagged", value: String(o.totals.incidents), icon: ShieldAlert, tone: "text-danger bg-red-500/10", foot: <Delta value={o.totals.delta} /> },
    { label: "Blocked", value: String(o.totals.blocked), icon: ShieldX, tone: "text-danger bg-red-500/10" },
    { label: "Flagged for review", value: String(o.totals.flagged), icon: AlertTriangle, tone: "text-warning bg-amber-500/10" },
  ];
  if (o.work.enabled) {
    items.push({ label: "Time tracked", value: duration(o.work.tracked_seconds), icon: Clock, tone: "text-brand-500 bg-brand-500/10",
      foot: <span className="text-xs text-subtle">{o.work.active_percent ?? 0}% active</span> });
  } else {
    items.push({ label: "Sensitive data alerts", value: String(o.sensitive_data.count), icon: FileWarning, tone: "text-brand-500 bg-brand-500/10",
      foot: o.sensitive_data.high > 0 ? <span className="text-xs text-danger">{o.sensitive_data.high} high risk</span> : undefined });
  }
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {items.map((k) => (
        <div key={k.label} className="rounded-lg border border-border bg-card p-4">
          <span className={cn("mb-3 grid h-9 w-9 place-items-center rounded-lg", k.tone)}><k.icon className="h-4 w-4" /></span>
          <p className="mt-1 [font-family:Satoshi,var(--font-inter),sans-serif] text-[1.75rem] font-medium leading-tight tracking-[-0.03em] tabular-nums text-foreground">{k.value}</p>
          <p className="mt-1 font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">{k.label}</p>
          {k.foot && <div className="mt-1.5">{k.foot}</div>}
        </div>
      ))}
    </div>
  );
}

function TrendCard({ o, className }: { o: Overview; className?: string }) {
  const color = useControlColors();
  const hourly = o.period.bucket === "hour";
  const max = Math.max(1, ...o.trend.map((p) => p.total));
  const active = CONTROL_ORDER.filter((id) => o.trend.some((p) => (p[id] ?? 0) > 0));
  // Label every bar when there are few; thin them out for long ranges.
  const step = Math.max(1, Math.ceil(o.trend.length / (hourly ? 8 : 7)));
  const label = (t: string) => {
    if (hourly) return t.slice(11, 16);
    const d = new Date(t + "T00:00:00");
    return o.trend.length <= 7
      ? d.toLocaleDateString("en-GB", { weekday: "short" })
      : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  };
  return (
    <Card title="Blocked and flagged over time" subtitle={hourly ? "Per hour" : "Per day"} className={className}>
      {o.totals.incidents === 0 ? <Empty text="Nothing was blocked or flagged in this period." /> : (
        <>
          <div className="flex h-44 items-end gap-[2px] border-b border-border" role="img" aria-label="Incidents over time">
            {o.trend.map((p) => (
              <div key={p.t} className="group relative flex h-full flex-1 flex-col justify-end">
                <div className="flex w-full flex-col-reverse overflow-hidden rounded-t" style={{ height: `${(p.total / max) * 100}%` }}>
                  {CONTROL_ORDER.map((id) => (p[id] ?? 0) > 0 && (
                    <div key={id} style={{ height: `${((p[id] ?? 0) / p.total) * 100}%`, background: color(id) }} />
                  ))}
                </div>
                {p.total > 0 && (
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-elevated px-2 py-1 text-xs text-foreground shadow group-hover:block">
                    <p className="font-semibold">{label(p.t)} · {p.total}</p>
                    {CONTROL_ORDER.filter((id) => (p[id] ?? 0) > 0).map((id) => (
                      <p key={id} className="text-muted-foreground">{CONTROL_META[id].label}: {p[id]}</p>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex gap-[2px]">
            {o.trend.map((p, i) => (
              <span key={p.t} className="flex-1 overflow-visible whitespace-nowrap text-center text-[10px] text-subtle">{i % step === 0 ? label(p.t) : ""}</span>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-3">
            {active.map((id) => (
              <span key={id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color(id) }} />{CONTROL_META[id].label}
              </span>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

function ControlBreakdown({ o }: { o: Overview }) {
  const color = useControlColors();
  const rows = [...o.controls].sort((a, b) => b.count - a.count);
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <Card title="By protection area" subtitle="What stopped or flagged activity">
      {o.totals.incidents === 0 ? <Empty text="All clear." /> : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const Meta = CONTROL_META[r.id];
            return (
              <li key={r.id}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-body"><Meta.icon className="h-4 w-4 text-subtle" />{Meta.label}</span>
                  <span className="font-medium text-foreground">{r.count}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-elevated">
                  <div className="h-full rounded-full" style={{ width: `${(r.count / max) * 100}%`, background: color(r.id) }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function RequestBadge({ status }: { status: string }) {
  if (!status) return null;
  const tone: Record<string, string> = {
    pending: "bg-amber-500/10 text-warning", approved: "bg-green-500/10 text-green-600 dark:text-green-400",
    denied: "bg-red-500/10 text-danger", revoked: "bg-elevated text-muted-foreground",
  };
  const label: Record<string, string> = { pending: "Requested", approved: "Access granted", denied: "Declined", revoked: "Revoked" };
  return <span className={cn("rounded-[4px] px-2 py-0.5 text-[11px] font-medium", tone[status] ?? tone.revoked)}>{label[status] ?? status}</span>;
}

function TopSites({ o }: { o: Overview }) {
  return (
    <Card title="Most blocked websites" action={<Link href="/dashboard/activity?source=web_gateway" className="text-xs font-medium text-brand-500 hover:underline">All activity</Link>}>
      {o.top_sites.length === 0 ? <Empty text="No websites were blocked." /> : (
        <ul className="divide-y divide-border">
          {o.top_sites.map((s) => (
            <li key={s.domain} className="flex items-center gap-3 py-2.5">
              <Globe className="h-4 w-4 flex-shrink-0 text-subtle" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-sm text-body">{s.domain}</p>
                <p className="truncate text-xs text-subtle">{s.category || "Company policy"} · last {ago(s.last)}</p>
              </div>
              <RequestBadge status={s.request_status} />
              <span className="rounded-[4px] bg-red-500/10 px-2 py-0.5 text-xs font-medium text-danger">{s.count}×</span>
            </li>
          ))}
        </ul>
      )}
      {o.top_sites.some((s) => !s.request_status) && (
        <p className="mt-3 text-xs text-muted-foreground">
          Need one of these for work? Open it in <Link href="/dashboard/activity?action=blocked" className="text-brand-500 hover:underline">Activity</Link> and request access.
        </p>
      )}
    </Card>
  );
}

function TopApps({ o }: { o: Overview }) {
  return (
    <Card title="Most blocked apps" action={<Link href="/dashboard/activity?source=application" className="text-xs font-medium text-brand-500 hover:underline">All activity</Link>}>
      {o.top_apps.length === 0 ? <Empty text="No apps were blocked." /> : (
        <ul className="divide-y divide-border">
          {o.top_apps.map((a) => (
            <li key={a.name + a.control} className="flex items-center gap-3 py-2.5">
              {a.control === "vpn" ? <ShieldOff className="h-4 w-4 flex-shrink-0 text-subtle" /> : <AppWindow className="h-4 w-4 flex-shrink-0 text-subtle" />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-body">{a.name}</p>
                <p className="text-xs text-subtle">{a.control === "vpn" ? "VPN / bypass tool" : "Application control"} · last {ago(a.last)}</p>
              </div>
              <span className="rounded-[4px] bg-red-500/10 px-2 py-0.5 text-xs font-medium text-danger">{a.count}×</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function SensitiveData({ o }: { o: Overview }) {
  const s = o.sensitive_data;
  const max = Math.max(1, ...s.services.map((x) => x.count));
  return (
    <Card title="Sensitive data alerts" subtitle={`${s.count} in this period${s.high ? ` · ${s.high} high risk` : ""}`}
      action={<Link href="/dashboard/activity?source=dlp" className="text-xs font-medium text-brand-500 hover:underline">Review</Link>}>
      <p className="mb-2 text-xs font-medium text-muted-foreground">Where it went</p>
      <ul className="space-y-2">
        {s.services.map((x) => (
          <li key={x.service}>
            <div className="mb-1 flex justify-between text-sm"><span className="truncate text-body">{x.service}</span><span className="text-foreground">{x.count}</span></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-elevated"><div className="h-full rounded-full bg-brand-500" style={{ width: `${(x.count / max) * 100}%` }} /></div>
          </li>
        ))}
      </ul>
      {s.types.length > 0 && (
        <>
          <p className="mb-2 mt-4 text-xs font-medium text-muted-foreground">What kind of data</p>
          <div className="flex flex-wrap gap-1.5">
            {s.types.map((t) => <span key={t.label} className="rounded-[4px] border border-border px-2.5 py-0.5 text-xs text-body">{t.label} · {t.count}</span>)}
          </div>
        </>
      )}
      <p className="mt-4 text-xs text-subtle">Monitoring only — nothing was stopped. Share personal or company data only through channels your company approves.</p>
    </Card>
  );
}

function WorkTime({ o, singleDay }: { o: Overview; singleDay: boolean }) {
  const w = o.work;
  const days = w.by_day ?? [];
  const max = Math.max(1, ...days.map((d) => d.tracked_seconds));
  return (
    <Card title="Your work time" subtitle="The same figures your company sees">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Tracked" value={duration(w.tracked_seconds)} />
        <Stat label="Active" value={`${w.active_percent ?? 0}%`} />
        <Stat label={singleDay ? "Sessions" : "Avg per day"} value={singleDay ? String(w.sessions ?? 0) : duration(w.avg_per_day_seconds)} />
      </div>
      {singleDay ? (
        (w.recent_sessions ?? []).length > 0 ? (
          <ul className="mt-4 space-y-1.5">
            {(w.recent_sessions ?? []).map((s) => (
              <li key={s.started_at} className="flex justify-between text-sm">
                <span className="text-body">
                  {new Date(s.started_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                  {" – "}{s.ended_at ? new Date(s.ended_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "now"}
                </span>
                <span className="text-muted-foreground">{duration(s.tracked_seconds)} · {s.avg_activity}% active</span>
              </li>
            ))}
          </ul>
        ) : <p className="mt-4 text-sm text-muted-foreground">No tracked time on this day.</p>
      ) : days.length > 0 ? (
        <>
          <div className="mt-4 flex h-20 items-end gap-1">
            {days.map((d) => (
              <div key={d.date} title={`${d.date}: ${duration(d.tracked_seconds)}`} className="flex-1 rounded-t bg-brand-500/70 hover:bg-brand-500"
                style={{ height: `${(d.tracked_seconds / max) * 100}%` }} />
            ))}
          </div>
          <div className="mt-1 flex gap-1">
            {days.map((d, i) => (
              <span key={d.date} className="flex-1 overflow-visible whitespace-nowrap text-center text-[10px] text-subtle">
                {i % Math.max(1, Math.ceil(days.length / 8)) === 0
                  ? new Date(d.date + "T00:00:00").toLocaleDateString("en-GB", days.length <= 7 ? { weekday: "short" } : { day: "numeric", month: "short" })
                  : ""}
              </span>
            ))}
          </div>
        </>
      ) : <p className="mt-4 text-sm text-muted-foreground">No tracked time in this period.</p>}
      <p className="mt-4 text-xs text-subtle">
        {w.days_worked ?? 0} {w.days_worked === 1 ? "day" : "days"} worked · {w.screenshots ?? 0} screenshots
        {w.screenshots_blurred ? " (blurred)" : ""}. Monitoring follows your company&apos;s working hours.
      </p>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-elevated px-3 py-2">
      <p className="text-lg font-semibold text-foreground">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function Devices({ o }: { o: Overview }) {
  return (
    <Card title="Your devices" action={<Link href="/dashboard/devices" className="text-xs font-medium text-brand-500 hover:underline">Manage</Link>}>
      {o.devices.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 py-6 text-center">
          <Laptop className="h-6 w-6 text-subtle" />
          <p className="text-sm text-muted-foreground">No device enrolled yet.</p>
          <Link href="/dashboard/download" className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600">Download the agent</Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {o.devices.map((d) => (
            <li key={d.id} className="rounded-lg border border-border p-3">
              <div className="flex items-center gap-3">
                <span className={cn("h-2 w-2 flex-shrink-0 rounded-full", d.status === "online" ? "bg-green-500" : "bg-subtle")} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{d.hostname}</p>
                  <p className="truncate text-xs text-subtle">
                    {d.os || "Unknown OS"} · {d.status === "online" ? "online" : `last seen ${ago(d.last_seen_at)}`} · {d.ownership === "personal" ? "Personal" : "Company"} device
                  </p>
                </div>
                <span className={cn("rounded-[4px] px-2 py-0.5 text-[11px] font-medium",
                  d.security_score >= 80 ? "bg-green-500/10 text-green-600 dark:text-green-400" : d.security_score >= 50 ? "bg-amber-500/10 text-warning" : "bg-red-500/10 text-danger")}>
                  Score {d.security_score}
                </span>
              </div>
              {d.issues.length > 0 && (
                <ul className="mt-2 space-y-1 border-t border-border pt-2">
                  {d.issues.map((i) => (
                    <li key={i.name} className="text-xs"><span className="font-medium text-danger">{i.name} is off.</span> <span className="text-muted-foreground">{i.fix}.</span></li>
                  ))}
                </ul>
              )}
              {(d.update_available || !d.enforcement.active) && (
                <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                  {d.update_available && <span className="rounded-full bg-brand-500/10 px-2 py-0.5 text-brand-500">Update available: {d.latest_version}</span>}
                  {!d.enforcement.active && <span className="rounded-full bg-elevated px-2 py-0.5 text-muted-foreground">{d.enforcement.reason || "Protection paused"}</span>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Requests({ o }: { o: Overview }) {
  const r = o.access_requests;
  return (
    <Card title="Your access requests" subtitle={r.pending > 0 ? `${r.pending} waiting for a decision` : "Nothing waiting"}
      action={<Link href="/dashboard/activity?view=requests" className="text-xs font-medium text-brand-500 hover:underline">All requests</Link>}>
      {r.recent.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center">
          <Inbox className="h-6 w-6 text-subtle" />
          <p className="text-sm text-muted-foreground">You haven&apos;t asked for access to anything.</p>
          <p className="text-xs text-subtle">If something you need for work is blocked, request it from Activity.</p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {r.recent.map((q) => (
            <li key={q.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-body">{q.label}</p>
                <p className="truncate text-xs text-subtle">{ago(q.created_at)}{q.review_note ? ` · "${q.review_note}"` : ""}</p>
              </div>
              <RequestBadge status={q.status} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Recent({ o }: { o: Overview }) {
  return (
    <Card title="Recent activity" subtitle="Latest blocked or flagged events"
      action={<Link href="/dashboard/activity" className="text-xs font-medium text-brand-500 hover:underline">View all</Link>}>
      {o.recent.length === 0 ? <Empty text="Nothing was blocked or flagged in this period." /> : (
        <ul className="divide-y divide-border">
          {o.recent.map((e, i) => {
            const Meta = CONTROL_META[e.control] ?? CONTROL_META.web;
            return (
              <li key={i} className="flex items-center gap-3 py-2.5">
                <span className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg bg-elevated"><Meta.icon className="h-4 w-4 text-subtle" /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-body">{e.what || e.operation || Meta.label}</p>
                  <p className="truncate text-xs text-subtle">
                    {e.data_types?.length ? e.data_types.join(", ") : e.policy || Meta.label} · {when(e.at)}
                  </p>
                </div>
                <span className={cn("rounded-[4px] px-2 py-0.5 text-[11px] font-medium",
                  e.action === "blocked" ? "bg-red-500/10 text-danger" : "bg-amber-500/10 text-warning")}>
                  {e.action === "blocked" ? "Blocked" : "Flagged"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function Skeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="h-24 animate-pulse rounded-xl bg-card" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-32 animate-pulse rounded-xl bg-card" />)}</div>
      <div className="grid gap-6 lg:grid-cols-3"><div className="h-64 animate-pulse rounded-xl bg-card lg:col-span-2" /><div className="h-64 animate-pulse rounded-xl bg-card" /></div>
    </div>
  );
}

function LoadError({ error }: { error: unknown }) {
  const res = (error as any)?.response;
  const unavailable = res?.status === 503;
  const msg = unavailable
    ? "Your company's activity data can't be reached right now. Your protection is still running — please try again in a few minutes."
    : res?.data?.error || "We couldn't load your dashboard. Please try again.";
  return (
    <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/5 p-5">
      <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-danger" />
      <p className="text-sm text-body">{msg}</p>
    </div>
  );
}
