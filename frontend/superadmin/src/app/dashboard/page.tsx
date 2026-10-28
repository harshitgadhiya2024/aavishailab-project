"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertOctagon, AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, Building2, CheckCircle2, CircleDollarSign,
  HeartPulse, Info, Laptop, RefreshCw, ShieldCheck,
} from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { healthApi, overviewApi } from "@/lib/api";
import { cn, formatINR, formatNumber, PLAN_LABELS, STATUS_STYLES, timeAgo } from "@/lib/utils";

const AXIS = { fontSize: 11, fill: "#71717A" };
const TOOLTIP = { background: "#FFFFFF", border: "1px solid #E7E7E8", borderRadius: 6, color: "#0B0B0D", fontSize: 12, boxShadow: "0 16px 40px -20px rgb(24 24 27 / 0.2)" };

const SEVERITY = {
  critical: { icon: AlertOctagon, tone: "text-red-600 bg-red-500/10", ring: "border-red-500/30" },
  warning: { icon: AlertTriangle, tone: "text-yellow-700 bg-yellow-500/10", ring: "border-yellow-500/20" },
  info: { icon: Info, tone: "text-sky-700 bg-sky-500/10", ring: "border-border" },
} as const;

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function CommandCenter() {
  const qc = useQueryClient();
  const { data: session } = useSession();
  const name = (session as any)?.user?.first_name || (session as any)?.user?.name?.split(" ")[0] || "";

  const { data, isLoading, isError, isFetching } = useQuery({
    queryKey: ["sa-overview"],
    queryFn: () => overviewApi.get().then((r) => r.data),
    refetchInterval: 60_000,
  });
  const { data: health } = useQuery({
    queryKey: ["sa-health"],
    queryFn: () => healthApi.get().then((r) => r.data),
    refetchInterval: 60_000,
  });

  if (isLoading) return <Skeleton />;
  if (isError || !data) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/5 p-5 text-sm text-foreground">
        <AlertTriangle className="h-5 w-5 flex-shrink-0 text-red-600" />
        The overview couldn&apos;t load. Check System Health, then try again.
      </div>
    );
  }

  const b = data.business ?? {};
  const cu = data.customers ?? {};
  const fl = data.fleet ?? {};
  const us = data.usage ?? {};
  const attention: any[] = data.attention ?? [];
  const growth = (cu.new_30d ?? 0) - (cu.new_prev_30d ?? 0);
  const blocked14 = (us.events_by_day ?? []).reduce((s: number, d: any) => s + (d.blocked ?? 0), 0);

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="page-eyebrow">Command center</p>
          <h2 className="mt-2 text-[2rem] font-normal leading-[1.1] tracking-[-0.035em] text-foreground">{greeting()}{name ? `, ${name}` : ""}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {attention.length === 0
              ? "Everything is running smoothly."
              : `${attention.length} thing${attention.length === 1 ? "" : "s"} could use your attention today.`}
          </p>
        </div>
        <button
          onClick={() => {
            overviewApi.get(true).then((r) => qc.setQueryData(["sa-overview"], r.data));
            qc.invalidateQueries({ queryKey: ["sa-health"] });
          }}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.06em] text-muted-foreground hover:bg-elevated hover:text-foreground"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
          Updated {timeAgo(data.generated_at)}
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          icon={CircleDollarSign}
          label="Monthly recurring revenue"
          value={formatINR(b.mrr_paise ?? 0, true)}
          sub={`${formatINR(b.arr_paise ?? 0, true)} ARR · ${b.paying_orgs ?? 0} paying`}
          href="/dashboard/billing"
        />
        <Kpi
          icon={Building2}
          label="Customers"
          value={formatNumber(cu.total ?? 0)}
          sub={`${cu.by_status?.active ?? 0} active · ${cu.by_status?.trial ?? 0} on trial`}
          trend={{ value: `${cu.new_30d ?? 0} new in 30d`, up: growth >= 0, show: (cu.new_30d ?? 0) > 0 || (cu.new_prev_30d ?? 0) > 0 }}
          href="/dashboard/organizations"
        />
        <Kpi
          icon={Laptop}
          label="Protected devices"
          value={formatNumber(fl.devices ?? 0)}
          sub={`${fl.online ?? 0} online now · ${fl.seen_24h ?? 0} seen in 24h`}
          href="/dashboard/agent-versions"
        />
        <Kpi
          icon={ShieldCheck}
          label="Security events (14 days)"
          value={formatNumber(us.events_14d ?? 0)}
          sub={`${formatNumber(blocked14)} blocked · ${cu.employees ?? 0} employees covered`}
          href="/dashboard/activity"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* Attention */}
        <Card className="xl:col-span-2" title="Needs attention" action={attention.length > 0 ? `${attention.length}` : undefined}>
          {attention.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <CheckCircle2 className="mb-2 h-8 w-8 text-green-500/70" />
              <p className="text-sm text-foreground">You&apos;re all caught up</p>
              <p className="mt-1 text-xs text-muted-foreground">No urgent tickets, new leads, overdue invoices or stuck customers.</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {attention.slice(0, 8).map((it, i) => {
                const sev = SEVERITY[it.severity as keyof typeof SEVERITY] ?? SEVERITY.info;
                return (
                  <li key={i}>
                    <Link href={it.href} className={cn("group flex items-center gap-3 rounded-lg border bg-background/40 px-3 py-2.5 transition-colors hover:bg-muted", sev.ring)}>
                      <span className={cn("flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg", sev.tone)}>
                        <sev.icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">{it.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">{it.detail}</span>
                      </span>
                      <ArrowRight className="h-4 w-4 flex-shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Platform */}
        <Card title="Platform" href="/dashboard/system-health">
          <HealthSummary health={health} />
          <div className="mt-5 border-t border-border pt-4">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="font-medium text-muted-foreground">Agent versions in the field</span>
              {fl.latest_versions && Object.keys(fl.latest_versions).length > 0 ? (
                <span className="text-subtle">
                  latest{" "}
                  {(["macos", "windows", "linux"] as const)
                    .filter((p) => fl.latest_versions[p])
                    .map((p) => `${{ macos: "macOS", windows: "Windows", linux: "Linux" }[p]} ${fl.latest_versions[p]}`)
                    .join(" · ")}
                </span>
              ) : (
                fl.latest_version && <span className="text-subtle">latest {fl.latest_version}</span>
              )}
            </div>
            {(fl.versions ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">No devices yet.</p>
            ) : (
              <div className="space-y-1.5">
                {(fl.versions as any[]).slice(0, 5).map((v) => (
                  <div key={v.version} className="flex items-center gap-2 text-xs">
                    <span className={cn("w-16 font-mono", v.latest ? "text-green-700" : "text-muted-foreground")}>{v.version}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className={cn("h-full rounded-full", v.latest ? "bg-green-500" : "bg-brand-500/70")} style={{ width: `${(v.count / Math.max(1, fl.devices)) * 100}%` }} />
                    </div>
                    <span className="w-6 text-right tabular-nums text-muted-foreground">{v.count}</span>
                  </div>
                ))}
              </div>
            )}
            {(fl.outdated ?? 0) > 0 && (
              <p className="mt-2 text-xs text-yellow-700">{fl.outdated} device{fl.outdated === 1 ? "" : "s"} not on the latest agent</p>
            )}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Security events" subtitle="Per day, last 14 days · data Aavishield stores">
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={(us.events_by_day ?? []).map((d: any) => ({ ...d, label: d.date.slice(5) }))} margin={{ left: -16, right: 8 }}>
              <defs>
                <linearGradient id="ev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#FF7000" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#FF7000" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#EEEEEF" vertical={false} />
              <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval={1} />
              <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP} />
              <Area type="monotone" dataKey="events" name="Events" stroke="#FF7000" strokeWidth={2} fill="url(#ev)" />
              <Area type="monotone" dataKey="blocked" name="Blocked" stroke="#ef4444" strokeWidth={1.5} fill="transparent" />
            </AreaChart>
          </ResponsiveContainer>
          {(us.orgs_on_own_storage ?? 0) > 0 && (
            <p className="mt-2 text-[11px] text-subtle">
              {us.orgs_on_own_storage} organization{us.orgs_on_own_storage === 1 ? " keeps" : "s keep"} data in their own database and {us.orgs_on_own_storage === 1 ? "is" : "are"} not counted.
            </p>
          )}
        </Card>

        <Card title="New organizations" subtitle="Per week, last 12 weeks">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={(cu.signups_by_week ?? []).map((w: any) => ({ ...w, label: new Date(w.week).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) }))} margin={{ left: -16, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#EEEEEF" vertical={false} />
              <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval={1} />
              <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP} cursor={{ fill: "#0b0b0d08" }} />
              <Bar dataKey="count" name="New organizations" fill="#FF7000" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card title="Customer mix">
          <Breakdown title="By status" data={cu.by_status ?? {}} labels={Object.fromEntries(Object.entries(STATUS_STYLES).map(([k, v]) => [k, v.label]))} />
          <div className="mt-4" />
          <Breakdown title="By plan" data={cu.by_plan ?? {}} labels={PLAN_LABELS} />
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4 text-xs">
            <Mini label="Collected this month" value={formatINR(b.collected_this_month_paise ?? 0, true)} />
            <Mini label="Pending invoices" value={formatINR(b.pending_paise ?? 0, true)} warn={(b.overdue_invoices ?? 0) > 0} />
          </div>
        </Card>

        <Card title="Latest signups" href="/dashboard/organizations">
          {(data.recent_orgs ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No organizations yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {(data.recent_orgs as any[]).map((o) => {
                const st = STATUS_STYLES[o.status] ?? STATUS_STYLES.inactive;
                return (
                  <li key={o.id}>
                    <Link href={`/dashboard/organizations/${o.id}`} className="flex items-center gap-3 py-2.5 hover:opacity-80">
                      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-xs font-semibold text-brand-500">
                        {o.name?.[0]?.toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-foreground">{o.name}</span>
                        <span className="text-xs text-muted-foreground">{PLAN_LABELS[o.plan] ?? o.plan} · {timeAgo(o.created_at)}</span>
                      </span>
                      <span className={cn("inline-flex items-center gap-1.5 text-xs", st.text)}>
                        <span className={cn("h-1.5 w-1.5 rounded-full", st.dot)} />{st.label}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title="Recent changes" href="/dashboard/audit-log">
          {(data.recent_audit ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
          ) : (
            <ul className="space-y-3">
              {(data.recent_audit as any[]).map((a) => (
                <li key={a.id} className="flex gap-3 text-sm">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-brand-500/70" />
                  <span className="min-w-0">
                    <span className="block truncate text-foreground">
                      <span className="text-muted-foreground">{a.actor || "System"}</span> {humanAction(a.action)} {a.resource?.replace(/_/g, " ")}
                    </span>
                    <span className="text-xs text-subtle">{a.org ? `${a.org} · ` : ""}{timeAgo(a.created_at)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function humanAction(a: string) {
  const map: Record<string, string> = { create: "created", update: "updated", delete: "deleted", approved: "approved", denied: "denied", revoked: "revoked" };
  return map[a] ?? a?.replace(/_/g, " ");
}

function Card({ title, subtitle, href, action, className, children }: {
  title: string; subtitle?: string; href?: string; action?: string; className?: string; children: React.ReactNode;
}) {
  return (
    // The website's UI card: a mono title bar over a hairline, then the content.
    <section className={cn("rounded-lg border border-border bg-card", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <h3 className="font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-foreground">{title}</h3>
        {action && <span className="rounded-[4px] bg-brand-tint px-1.5 py-0.5 font-mono text-[10.5px] text-brand-700">{action}</span>}
        {href && (
          <Link href={href} className="inline-flex items-center gap-1 font-mono text-[10.5px] uppercase tracking-[0.08em] text-brand-600 hover:text-brand-700">
            View all <ArrowUpRight className="h-3 w-3" />
          </Link>
        )}
      </div>
      <div className="p-5">
        {subtitle && <p className="-mt-1 mb-4 text-[13px] text-muted-foreground">{subtitle}</p>}
        {children}
      </div>
    </section>
  );
}

function Kpi({ icon: Icon, label, value, sub, href, trend }: {
  icon: React.ElementType; label: string; value: string; sub: string; href: string;
  trend?: { value: string; up: boolean; show: boolean };
}) {
  return (
    <Link href={href} className="group rounded-lg border border-border bg-card p-5 transition-colors hover:border-border-strong">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">{label}</span>
        <Icon className="h-4 w-4 text-subtle transition-colors group-hover:text-brand-500" />
      </div>
      <p className="mt-3 [font-family:Satoshi,var(--font-inter),sans-serif] text-[2rem] font-medium leading-none tracking-[-0.03em] tabular-nums text-foreground">{value}</p>
      <div className="mt-2.5 flex items-center gap-2 text-[12px] text-muted-foreground">
        {trend?.show && (
          <span className={cn("inline-flex items-center gap-0.5 font-medium", trend.up ? "text-green-700" : "text-red-600")}>
            {trend.up ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
            {trend.value}
          </span>
        )}
        <span className="truncate">{sub}</span>
      </div>
    </Link>
  );
}

function Breakdown({ title, data, labels }: { title: string; data: Record<string, number>; labels: Record<string, string> }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  const colors = ["bg-brand-500", "bg-sky-500", "bg-green-500", "bg-purple-400", "bg-zinc-500"];
  return (
    <div>
      <p className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">{title}</p>
      {total === 0 ? (
        <p className="text-xs text-subtle">No data yet.</p>
      ) : (
        <>
          <div className="flex h-2 gap-px overflow-hidden bg-muted">
            {entries.map(([k, n], i) => <div key={k} className={colors[i % colors.length]} style={{ width: `${(n / total) * 100}%` }} />)}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {entries.map(([k, n], i) => (
              <span key={k} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className={cn("h-2 w-2 rounded-sm", colors[i % colors.length])} />
                {labels[k] ?? k} <span className="tabular-nums text-foreground">{n}</span>
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Mini({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <p className="text-subtle">{label}</p>
      <p className={cn("mt-0.5 [font-family:Satoshi,var(--font-inter),sans-serif] text-[1.05rem] font-medium tabular-nums", warn ? "text-yellow-700" : "text-foreground")}>{value}</p>
    </div>
  );
}

function HealthSummary({ health }: { health: any }) {
  if (!health) return <div className="h-16 animate-pulse rounded-lg bg-muted" />;
  if (!health.reachable) {
    return (
      <div className="flex items-start gap-2 text-sm text-yellow-700">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
        Monitoring isn&apos;t reachable, so service status is unknown.
      </div>
    );
  }
  const services: any[] = health.services ?? [];
  const down = services.filter((s) => !s.up);
  return (
    <div>
      <div className="flex items-center gap-3">
        <span className={cn("flex h-10 w-10 items-center justify-center rounded-xl", down.length ? "bg-red-500/10 text-red-600" : "bg-green-500/10 text-green-700")}>
          <HeartPulse className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm font-medium text-foreground">{down.length ? `${down.length} service${down.length === 1 ? "" : "s"} down` : "All services operational"}</p>
          <p className="text-xs text-muted-foreground">{health.up_count}/{health.total} up</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1" aria-label="Service status">
        {services.map((s) => (
          <span key={s.job} title={`${s.job}: ${s.up ? "up" : "down"}`} className={cn("h-2.5 w-2.5 rounded-sm", s.up ? "bg-green-500/80" : "bg-red-500")} />
        ))}
      </div>
      {down.length > 0 && <p className="mt-2 truncate text-xs text-red-600">{down.map((s) => s.job).join(", ")}</p>}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="mx-auto max-w-[1400px] animate-pulse space-y-6">
      <div className="h-12 w-72 rounded-lg bg-card" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-28 rounded-xl bg-card" />)}</div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3"><div className="h-72 rounded-xl bg-card xl:col-span-2" /><div className="h-72 rounded-xl bg-card" /></div>
    </div>
  );
}
