"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { reportApi } from "@/lib/api";
import {
  ArrowRight, CheckCircle2, CircleAlert, Clock, Monitor, Users, ShieldCheck, FileText,
  TrendingUp, TrendingDown, Minus, UserPlus, Laptop, ToggleRight,
} from "lucide-react";
import { formatNumber, cn } from "@/lib/utils";
import { CONTROLS, type ControlId } from "@/lib/controls";
import { periodFor, periodParams, periodText, type Period } from "@/lib/report-period";
import { PeriodPicker } from "@/components/reports/PeriodPicker";
import { ControlTrend } from "@/components/reports/ControlTrend";
import { BarList } from "@/components/reports/BarList";

type Health = {
  devices: number; online: number; stale: number; posture_issues: number;
  employees: number; employees_without_agent: number; pending_requests: number;
  policies: number; policies_enabled: number;
  settings_issues?: { device: string; employee: string; summary: string; fix: string[] }[];
};

function Card({ title, subtitle, action, children, className }: {
  title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    // The website's UI card: a mono title bar over a hairline, then the content.
    <section className={cn("rounded-lg border border-border bg-card", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <h3 className="font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-foreground">{title}</h3>
        {action}
      </div>
      <div className="p-5">
        {subtitle && <p className="-mt-1 mb-4 text-[13px] text-muted-foreground">{subtitle}</p>}
        {children}
      </div>
    </section>
  );
}

function Delta({ value }: { value: number | null | undefined }) {
  // More incidents isn't automatically "bad" (a new policy finds more), so the
  // change is stated, not coloured as a verdict.
  const Icon = value == null ? Minus : value > 0 ? TrendingUp : value < 0 ? TrendingDown : Minus;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Icon className="w-3.5 h-3.5" />
      {value == null ? "no earlier data" : `${value > 0 ? "+" : ""}${value}% vs previous`}
    </span>
  );
}

// Card-header links, in the website's mono style.
const HEAD_LINK = "inline-flex items-center gap-1 font-mono text-[10.5px] uppercase tracking-[0.08em] text-brand-600 transition-colors hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300";

type Tone = "good" | "warn" | "bad";
// Square markers, the website's pixel language.
const TONE_DOT: Record<Tone, string> = { good: "bg-green-500", warn: "bg-yellow-500", bad: "bg-red-500" };

function StatusItem({ icon: Icon, label, value, detail, tone, href }: {
  icon: React.ElementType; label: string; value: string; detail: string; tone: Tone; href: string;
}) {
  return (
    <Link href={href} className="group flex items-start gap-3 rounded-md p-3 transition-colors hover:bg-elevated">
      <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-md border border-border bg-background text-subtle transition-colors group-hover:text-brand-500">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">
          <span className={cn("h-1.5 w-1.5", TONE_DOT[tone])} />
          {label}
        </p>
        <p className="mt-1.5 [font-family:Satoshi,var(--font-inter),sans-serif] text-[1.3rem] font-medium leading-tight tracking-[-0.02em] text-foreground tabular-nums">{value}</p>
        <p className="mt-0.5 text-[12px] text-subtle">{detail}</p>
      </div>
      <ArrowRight className="mt-1 h-3.5 w-3.5 text-brand-500 opacity-0 transition-[opacity,transform] group-hover:translate-x-0.5 group-hover:opacity-100" />
    </Link>
  );
}

function Onboarding({ h }: { h: Health }) {
  const steps = [
    { done: h.employees > 0, icon: UserPlus, title: "Add your employees", body: "Import them from a CSV or add them one by one.", href: "/dashboard/employees", cta: "Add employees" },
    { done: h.devices > 0, icon: Laptop, title: "Enroll the first device", body: "Send an employee the enrollment link, or install the agent yourself.", href: "/dashboard/devices", cta: "Enroll a device" },
    { done: h.policies_enabled > 0, icon: ToggleRight, title: "Switch on a policy", body: "Pick what to block or watch: websites, apps, sensitive data.", href: "/dashboard/swg", cta: "Set up policy" },
  ];
  return (
    <Card title="Get protected in three steps" subtitle="Figures appear here as soon as the first device reports in.">
      <ol className="grid gap-3 md:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title} className={cn("rounded-md border p-4", s.done ? "border-green-500/30 bg-green-500/5" : "border-border")}>
            <div className="flex items-center gap-2">
              {s.done ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <span className="grid h-5 w-5 place-items-center rounded-[3px] bg-brand-tint font-mono text-[10.5px] font-medium text-brand-700 dark:text-brand-300">{i + 1}</span>}
              <p className="text-sm font-medium text-foreground">{s.title}</p>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{s.body}</p>
            {!s.done && (
              <Link href={s.href} className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand-500 hover:underline">
                {s.cta} <ArrowRight className="w-3 h-3" />
              </Link>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}

export default function DashboardPage() {
  const [period, setPeriod] = useState<Period>(() => periodFor("7d"));

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-overview", period.start, period.end],
    queryFn: () => reportApi.overview(periodParams(period)),
    refetchInterval: 60_000,
  });

  const d = data?.data ?? {};
  const h: Health = d.health ?? {};
  const controls: any[] = d.controls ?? [];
  const totals = d.totals ?? {};
  const attention: any[] = d.attention ?? [];
  const noDevices = !isLoading && (h.devices ?? 0) === 0;
  const reportLink = (report: string, control?: ControlId) =>
    `/dashboard/reports?report=${report}&period=${period.id}&start=${period.start}&end=${period.end}${control ? `&control=${control}` : ""}`;

  const coveragePct = h.employees ? Math.round(((h.employees - h.employees_without_agent) / h.employees) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-brand-600 dark:text-brand-400">
            <span className="size-1.5 bg-brand-500" />
            {isLoading ? "Loading…" : periodText(period)}
          </p>
          <h2 className="mt-2 text-[2rem] font-normal leading-[1.1] tracking-[-0.035em] text-foreground">Security overview</h2>
        </div>
        <PeriodPicker value={period} onChange={setPeriod} options={["today", "7d", "30d", "this_month", "3m"]} />
      </div>

      {isLoading ? (
        <div className="grid gap-4">
          {[120, 220, 300].map((hgt, i) => <div key={i} style={{ height: hgt }} className="rounded-lg bg-card border border-border animate-pulse" />)}
        </div>
      ) : noDevices ? (
        <Onboarding h={h} />
      ) : (
        <>
          {/* Am I protected? */}
          <Card title="Protection status" subtitle="Right now, across your organization">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-1">
              <StatusItem icon={Monitor} label="Devices online" href="/dashboard/devices"
                value={`${h.online} of ${h.devices}`}
                detail={h.stale ? `${h.stale} not seen for 7+ days` : "All devices checking in"}
                tone={h.stale ? "warn" : "good"} />
              <StatusItem icon={Users} label="Employee coverage" href="/dashboard/employees"
                value={`${coveragePct}%`}
                detail={h.employees_without_agent ? `${h.employees_without_agent} without a protected device` : `All ${h.employees} employees protected`}
                tone={h.employees_without_agent ? "warn" : "good"} />
              <StatusItem icon={ShieldCheck} label="Laptop security settings" href="/dashboard/reports?report=devices"
                value={h.posture_issues ? `${h.posture_issues} ${h.posture_issues === 1 ? "laptop needs" : "laptops need"} a fix` : "All in order"}
                detail={h.settings_issues?.[0]?.summary ?? "Firewall, disk encryption, updates and screen lock are on"}
                tone={h.posture_issues ? "bad" : "good"} />
              <StatusItem icon={FileText} label="Policies on" href="/dashboard/swg"
                value={`${h.policies_enabled} of ${h.policies}`}
                detail={h.policies_enabled ? "Enforcing on every device" : "Nothing is being enforced"}
                tone={h.policies_enabled ? "good" : "bad"} />
            </div>
          </Card>

          <div className="grid gap-4 xl:grid-cols-3">
            {/* What happened, by control */}
            <Card
              className="xl:col-span-2"
              title="Incidents by control"
              subtitle={`${formatNumber(totals.incidents ?? 0)} incidents, ${formatNumber(totals.affected_employees ?? 0)} employees involved`}
              action={<Delta value={totals.delta} />}
            >
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {CONTROLS.map((c) => {
                  const s = controls.find((x) => x.id === c.id) ?? {};
                  const empty = !s.count;
                  return (
                    <Link key={c.id} href={reportLink("incidents", c.id)}
                      className={cn("group rounded-md border border-border p-3.5 transition-colors hover:border-border-strong hover:bg-elevated", empty && "opacity-60")}>
                      <div className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.06em] text-muted-foreground">
                        <c.icon className="h-3.5 w-3.5 text-subtle transition-colors group-hover:text-brand-500" /> {c.label}
                      </div>
                      <p className="mt-2.5 [font-family:Satoshi,var(--font-inter),sans-serif] text-[1.9rem] font-medium leading-none tracking-[-0.03em] tabular-nums text-foreground">{formatNumber(s.count ?? 0)}</p>
                      <p className="mt-2 text-[12px] text-subtle">
                        {empty ? "None in this period" : `${s.blocked} blocked, ${s.alerted} flagged`}
                      </p>
                    </Link>
                  );
                })}
              </div>
            </Card>

            {/* What should I do? */}
            <Card title="Needs attention" subtitle={attention.length ? `${attention.length} open item${attention.length > 1 ? "s" : ""}` : undefined}>
              {attention.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <CheckCircle2 className="w-8 h-8 text-green-500 mb-2" />
                  <p className="text-sm font-medium text-foreground">Nothing needs your attention</p>
                  <p className="text-xs text-muted-foreground mt-1">Devices, checks and requests are all in order.</p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {attention.map((a, i) => (
                    <li key={i}>
                      <Link href={a.href} className="flex gap-3 rounded-lg border border-border p-3 hover:bg-elevated transition-colors">
                        <CircleAlert className={cn("w-4 h-4 flex-shrink-0 mt-0.5", a.severity === "high" ? "text-danger" : "text-warning")} />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">{a.title}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{a.detail}</p>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card
            title="Incidents over time"
            subtitle={d.period?.bucket === "hour" ? "Per hour, by control" : "Per day, by control"}
            action={<Link href={reportLink("incidents")} className={HEAD_LINK}>All incidents <ArrowRight className="h-3 w-3" /></Link>}
          >
            {(totals.incidents ?? 0) === 0 ? (
              <div className="h-[200px] flex flex-col items-center justify-center text-center">
                <CheckCircle2 className="w-8 h-8 text-green-500 mb-2" />
                <p className="text-sm font-medium text-foreground">All quiet</p>
                <p className="text-xs text-muted-foreground mt-1">No blocked or flagged activity in this period.</p>
              </div>
            ) : (
              <ControlTrend data={d.trend ?? []} />
            )}
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Blocked applications" subtitle="Apps stopped from running, including VPN clients"
              action={<Link href={reportLink("apps")} className={HEAD_LINK}>Report <ArrowRight className="h-3 w-3" /></Link>}>
              <BarList
                empty="No application was blocked"
                items={(d.top_apps ?? []).map((a: any) => ({
                  label: a.name,
                  value: a.count,
                  sub: `${a.employees} ${a.employees === 1 ? "person" : "people"}`,
                  tag: a.control === "vpn" ? { text: "VPN", tone: "bg-yellow-500/15 text-warning" } : undefined,
                }))}
              />
            </Card>

            <Card title="Where sensitive data went" subtitle="Data protection findings by destination"
              action={<Link href={reportLink("dlp")} className={HEAD_LINK}>Report <ArrowRight className="h-3 w-3" /></Link>}>
              <BarList
                color="bg-yellow-500/15"
                empty="No sensitive data detected"
                items={(d.dlp_services ?? []).map((s: any) => ({
                  label: s.service,
                  value: s.count,
                  tag: s.high ? { text: `${s.high} high`, tone: "bg-red-500/15 text-danger" } : undefined,
                }))}
              />
              {(d.dlp_types ?? []).length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {(d.dlp_types as any[]).map((t) => (
                    <span key={t.label} className="rounded-[3px] border border-border bg-background px-2 py-1 font-mono text-[10.5px] uppercase tracking-[0.04em] text-body">
                      {t.label} <span className="text-subtle tabular-nums">{t.count}</span>
                    </span>
                  ))}
                </div>
              )}
            </Card>

            <Card title="Blocked websites" subtitle="Most-attempted sites and the rule that stopped them"
              action={<Link href={reportLink("web")} className={HEAD_LINK}>Report <ArrowRight className="h-3 w-3" /></Link>}>
              <BarList
                color="bg-blue-500/15"
                empty="No website was blocked"
                items={(d.top_sites ?? []).map((s: any) => ({ label: s.domain, value: s.count, sub: s.category }))}
              />
            </Card>

            <Card title="People with the most incidents" subtitle="Worth a conversation, not necessarily a warning"
              action={<Link href={reportLink("employee-risk")} className={HEAD_LINK}>Report <ArrowRight className="h-3 w-3" /></Link>}>
              {(d.top_users ?? []).length === 0 ? (
                <p className="py-8 text-center text-sm text-subtle">No employee incidents in this period</p>
              ) : (
                <ul className="divide-y divide-border">
                  {(d.top_users as any[]).map((u) => (
                    <li key={u.employee_id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{u.name?.trim() || u.email}</p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {CONTROLS.filter((c) => u[c.id] > 0).map((c) => (
                            <span key={c.id} className="rounded-[3px] bg-elevated px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.04em] text-body">
                              {c.label} {u[c.id]}
                            </span>
                          ))}
                          {u.high_dlp > 0 && (
                            <span className="rounded-[3px] bg-red-500/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.04em] text-danger">{u.high_dlp} high-severity data</span>
                          )}
                        </div>
                      </div>
                      <span className="[font-family:Satoshi,var(--font-inter),sans-serif] text-[1.35rem] font-medium tracking-[-0.02em] tabular-nums text-foreground">{u.incidents}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}

      <p className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-subtle">
        <Clock className="h-3 w-3" /> Refreshes every minute · Times in your time zone
      </p>
    </div>
  );
}
