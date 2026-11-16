"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { reportApi } from "@/lib/api";
import {
  AppWindow, ArrowRight, CheckCircle2, CircleAlert, Clock, FileText, Globe, Minus, Monitor, Plus,
  ShieldCheck, TrendingDown, TrendingUp, TriangleAlert, Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CONTROLS, type ControlId } from "@/lib/controls";
import { periodFor, periodParams, periodText, type Period } from "@/lib/report-period";
import { PeriodPicker } from "@/components/reports/PeriodPicker";
import { ControlTrend } from "@/components/reports/ControlTrend";
import { SetupSteps } from "@/components/onboarding/SetupSteps";
import { MetricCard, MetricRow } from "@/components/ui/MetricCard";
import { EmptyBox, RankedList } from "@/components/dashboard/RankedList";
import { groupAttention, joinPhrases, type ApiAttention } from "@/components/dashboard/attention";

/*
 * Security overview. Reads top to bottom as: what needs you (headline), am I
 * protected (status), what happened (incidents + trend, beside the things to
 * act on), then the detail lists. Every number is a MetricCard or a ranked
 * row, so the page has one visual language.
 */

type Health = {
  devices: number; online: number; stale: number; posture_issues: number;
  employees: number; employees_without_agent: number; pending_requests: number;
  policies: number; policies_enabled: number;
  settings_issues?: { device: string; employee: string; off?: string[]; summary: string; fix: string[] }[];
};

const n = (v: number | undefined) => (v ?? 0).toLocaleString();

function Card({ title, subtitle, action, children, className, bodyClassName }: {
  title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode; className?: string; bodyClassName?: string;
}) {
  return (
    // The website's UI card: a mono title bar over a hairline, then the content.
    <section className={cn("rounded-lg border border-border bg-card", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <h3 className="font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-foreground">{title}</h3>
        {action}
      </div>
      <div className={cn("p-5", bodyClassName)}>
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
      <Icon className="h-3.5 w-3.5" />
      {value == null ? "no earlier data" : `${value > 0 ? "+" : ""}${value}% vs previous`}
    </span>
  );
}

// Card-header links, in the website's mono style.
const HEAD_LINK = "inline-flex items-center gap-1 font-mono text-[10.5px] uppercase tracking-[0.08em] text-brand-600 transition-colors hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300";
// The website's primary button: orange, mono, uppercase.
const PRIMARY_BTN = "inline-flex h-8 items-center gap-1.5 rounded-md bg-brand-500 px-3 font-mono text-[11.5px] font-medium uppercase tracking-[0.06em] text-white transition-colors hover:bg-brand-600";
const SECONDARY_BTN = "inline-flex h-8 items-center rounded-md border border-border bg-card px-3 text-[12.5px] font-medium text-foreground transition-colors hover:bg-elevated";

const SectionLabel = ({ title, note }: { title: string; note?: string }) => (
  <div className="mb-2.5 flex items-baseline justify-between gap-3">
    <h3 className="font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-foreground">{title}</h3>
    {note && <span className="text-[12px] text-subtle">{note}</span>}
  </div>
);

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
  const noDevices = !isLoading && (h.devices ?? 0) === 0;
  const reportLink = (report: string, control?: ControlId) =>
    `/dashboard/reports?report=${report}&period=${period.id}&start=${period.start}&end=${period.end}${control ? `&control=${control}` : ""}`;

  const coveragePct = h.employees ? Math.round(((h.employees - h.employees_without_agent) / h.employees) * 100) : 0;
  const blockedTotal = controls.reduce((s, c) => s + (c.blocked ?? 0), 0);
  const when = period.id === "7d" ? "this week" : period.id === "today" ? "today" : "in this period";

  const attention = useMemo(
    () => groupAttention((d.attention ?? []) as ApiAttention[], h.posture_issues ?? 0, h.settings_issues ?? [], d.dlp_services ?? []),
    [d.attention, d.dlp_services, h.posture_issues, h.settings_issues],
  );
  const urgent = attention.filter(a => a.severity === "high");

  // Ranked by total incidents, the number the row shows.
  const people = useMemo(() => [...(d.top_users ?? [])].sort((a: any, b: any) => b.incidents - a.incidents), [d.top_users]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
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
          {[88, 110, 320].map((hgt, i) => <div key={i} style={{ height: hgt }} className="animate-pulse rounded-lg border border-border bg-card" />)}
        </div>
      ) : noDevices ? (
        <SetupSteps h={h} />
      ) : (
        <>
          {/* 1 · Headline: what needs you, before any card. */}
          <section className="flex flex-wrap items-center gap-x-8 gap-y-4 rounded-lg border border-border bg-card px-5 py-4">
            <div className="flex min-w-[280px] flex-1 items-start gap-3">
              <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-md border",
                urgent.length ? "border-red-500/20 bg-red-500/10 text-danger" : "border-green-500/20 bg-green-500/10 text-success")}>
                {urgent.length ? <CircleAlert className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
              </span>
              <div className="min-w-0">
                <p className="text-[15px] font-medium text-foreground">
                  {urgent.length ? `${urgent.length} ${urgent.length === 1 ? "thing needs" : "things need"} you ${when}` : `Nothing urgent ${when}`}
                </p>
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  {urgent.length
                    ? `${joinPhrases(urgent.slice(0, 3).map(a => a.phrase))}.`.replace(/^./, c => c.toUpperCase())
                    : attention.length ? `${attention.length} smaller ${attention.length === 1 ? "item is" : "items are"} listed under Needs attention.` : "Devices, policies and requests are all in order."}
                </p>
              </div>
            </div>
            <div className="flex items-center divide-x divide-border">
              <div className="pr-6">
                <p className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">Incidents</p>
                <p className="mt-1 [font-family:Satoshi,var(--font-inter),sans-serif] text-[1.3rem] font-medium leading-tight tracking-[-0.02em] tabular-nums text-foreground">
                  {n(totals.incidents)}
                  {totals.delta != null && totals.delta !== 0 && (
                    <span className={cn("ml-1.5 font-sans text-[12px] font-medium", totals.delta > 0 ? "text-danger" : "text-success")}>
                      {totals.delta > 0 ? "↑" : "↓"} {Math.abs(totals.delta)}%
                    </span>
                  )}
                </p>
              </div>
              <div className="px-6">
                <p className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">People involved</p>
                <p className="mt-1 [font-family:Satoshi,var(--font-inter),sans-serif] text-[1.3rem] font-medium leading-tight tracking-[-0.02em] tabular-nums text-foreground">{n(totals.affected_employees)}</p>
              </div>
              <div className="pl-6">
                <p className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">Blocked</p>
                <p className="mt-1 [font-family:Satoshi,var(--font-inter),sans-serif] text-[1.3rem] font-medium leading-tight tracking-[-0.02em] tabular-nums text-foreground">
                  {n(blockedTotal)}
                  <span className="ml-1.5 font-sans text-[12px] font-normal text-subtle">{h.policies_enabled ? "stopped by policy" : "no policy on"}</span>
                </p>
              </div>
            </div>
          </section>

          {/* 2 · Am I protected? The same standalone cards as every other page. */}
          <section>
            <SectionLabel title="Protection status" note="Right now, across your organization" />
            <MetricRow>
              <MetricCard icon={Monitor} label="Devices online" href="/dashboard/devices"
                value={`${h.online} of ${h.devices}`}
                detail={h.stale ? `${h.stale} not seen for 7+ days` : "All devices checking in"}
                tone={h.stale ? "warn" : "good"} />
              <MetricCard icon={Users} label="Employee coverage" href="/dashboard/employees"
                value={`${coveragePct}%`}
                detail={h.employees_without_agent ? `${h.employees_without_agent} ${h.employees_without_agent === 1 ? "person" : "people"} without a protected device` : `All ${h.employees} employees protected`}
                tone={h.employees_without_agent ? "warn" : "good"} />
              <MetricCard icon={ShieldCheck} label="Laptops secured" href="/dashboard/reports?report=devices"
                value={`${Math.max(0, h.devices - h.posture_issues)} of ${h.devices}`}
                detail={h.posture_issues ? "Firewall, updates or screen lock off" : "Firewall, encryption, updates and screen lock on"}
                tone={h.posture_issues ? "bad" : "good"} />
              <MetricCard icon={FileText} label="Policies on" href="/dashboard/swg"
                value={h.policies_enabled ? `${h.policies_enabled} of ${h.policies}` : "None"}
                detail={h.policies_enabled
                  ? (h.policies_enabled < h.policies ? `${h.policies - h.policies_enabled} switched off` : "Enforcing on every device")
                  : <span className="font-medium text-brand-600 dark:text-brand-300">Turn on your first policy →</span>}
                tone={!h.policies_enabled ? "bad" : h.policies_enabled < h.policies ? "warn" : "good"} />
            </MetricRow>
          </section>

          {/* 3–5 · What happened, beside what to do. Both columns end on one line. */}
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="flex flex-col gap-6 lg:col-span-2">
              <Card title="Incidents by control"
                subtitle={`${n(totals.incidents)} incidents, ${n(totals.affected_employees)} employees involved`}
                action={<Delta value={totals.delta} />}>
                <MetricRow>
                  {CONTROLS.map((c) => {
                    const s = controls.find((x) => x.id === c.id) ?? {};
                    const empty = !s.count;
                    return (
                      <MetricCard key={c.id} href={reportLink("incidents", c.id)} icon={c.icon} label={c.label}
                        value={n(s.count)}
                        tone={empty ? "neutral" : s.blocked ? "bad" : "warn"}
                        detail={empty ? "None in this period" : `${n(s.blocked)} blocked · ${n(s.alerted)} flagged`}
                        className={cn(empty && "opacity-70")} />
                    );
                  })}
                </MetricRow>
              </Card>

              <Card title="Incidents over time" className="flex flex-1 flex-col" bodyClassName="flex flex-1 flex-col"
                subtitle={d.period?.bucket === "hour" ? "Per hour, by control" : "Per day, by control"}
                action={<Link href={reportLink("incidents")} className={HEAD_LINK}>All incidents <ArrowRight className="h-3 w-3" /></Link>}>
                {(totals.incidents ?? 0) === 0 ? (
                  <div className="flex min-h-[220px] flex-1 flex-col items-center justify-center text-center">
                    <CheckCircle2 className="mb-2 h-8 w-8 text-green-500" />
                    <p className="text-sm font-medium text-foreground">All quiet</p>
                    <p className="mt-1 text-xs text-muted-foreground">No blocked or flagged activity in this period.</p>
                  </div>
                ) : (
                  // Grows with the column so there's no empty space beside "Needs attention".
                  <div className="relative min-h-[240px] flex-1">
                    <div className="absolute inset-0"><ControlTrend data={d.trend ?? []} height="100%" /></div>
                  </div>
                )}
              </Card>
            </div>

            <Card title="Needs attention" action={attention.length ? <span className="text-[12px] text-subtle">{attention.length} open</span> : undefined}>
              {attention.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <CheckCircle2 className="mb-2 h-8 w-8 text-green-500" />
                  <p className="text-sm font-medium text-foreground">Nothing needs your attention</p>
                  <p className="mt-1 text-xs text-muted-foreground">Devices, checks and requests are all in order.</p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {attention.map((a) => (
                    <li key={a.key} className="flex gap-3 rounded-lg border border-border p-3">
                      <CircleAlert className={cn("mt-0.5 h-4 w-4 shrink-0", a.severity === "high" ? "text-danger" : "text-warning")} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13.5px] font-medium leading-snug text-foreground">{a.title}</p>
                        {a.chips?.length ? (
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {a.chips.map(c => (
                              <span key={c.label} className="rounded-[4px] border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground">{c.label} {c.count}</span>
                            ))}
                          </div>
                        ) : a.detail ? (
                          <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-muted-foreground">{a.detail}</p>
                        ) : null}
                        <Link href={a.href} className={cn("mt-2", a.primary ? PRIMARY_BTN : HEAD_LINK)}>
                          {a.cta}{!a.primary && <ArrowRight className="h-3 w-3" />}
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {/* 6–9 · Detail lists, one ranked-row style. */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Where sensitive data went" subtitle="Data protection findings by destination"
              action={<Link href={reportLink("dlp")} className={HEAD_LINK}>Report <ArrowRight className="h-3 w-3" /></Link>}>
              <RankedList
                rows={(d.dlp_services ?? []).map((s: any) => ({ key: s.service, name: s.service, count: s.count, high: s.high }))}
                empty={<EmptyBox icon={FileText} title="No sensitive data detected" body="Nothing sensitive left through a monitored channel in this period." />}
              />
              {(d.dlp_types ?? []).length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {(d.dlp_types as any[]).map((t) => (
                    <span key={t.label} className="rounded-[4px] border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                      {t.label} <span className="tabular-nums text-subtle">{t.count}</span>
                    </span>
                  ))}
                </div>
              )}
            </Card>

            <Card title="People with the most incidents" subtitle="Worth a conversation, not necessarily a warning"
              action={<Link href={reportLink("employee-risk")} className={HEAD_LINK}>Report <ArrowRight className="h-3 w-3" /></Link>}>
              <RankedList
                total={totals.incidents}
                rows={people.map((u: any) => ({
                  key: u.employee_id,
                  name: u.name?.trim() || u.email,
                  detail: CONTROLS.filter(c => u[c.id] > 0).sort((a, b) => u[b.id] - u[a.id]).slice(0, 2).map(c => `${c.label} ${n(u[c.id])}`).join(" · "),
                  high: u.high_dlp,
                  count: u.incidents,
                }))}
                empty={<EmptyBox icon={Users} title="No employee incidents in this period" />}
              />
            </Card>

            <Card title="Blocked websites" subtitle="Most-attempted sites a policy stopped"
              action={<Link href={reportLink("web")} className={HEAD_LINK}>Report <ArrowRight className="h-3 w-3" /></Link>}>
              <RankedList
                rows={(d.top_sites ?? []).map((s: any) => ({
                  key: s.domain, name: s.domain, detail: s.category, count: s.count,
                  tag: `${s.employees} ${s.employees === 1 ? "person" : "people"}`,
                }))}
                empty={h.policies_enabled
                  ? <EmptyBox icon={Globe} title="No site was blocked in this period" />
                  : <EmptyBox icon={Globe} title="No site was blocked" body="Turn on a web policy to block categories like AI tools or social media."
                      action={<Link href="/dashboard/swg" className={PRIMARY_BTN}><Plus className="h-3.5 w-3.5" />New policy</Link>} />}
              />
              {(d.flagged_sites?.domains ?? 0) > 0 && (
                <div className="mt-3 flex items-center gap-2.5 rounded-md border border-yellow-500/30 bg-yellow-500/[0.07] px-3 py-2 text-[12.5px]">
                  <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-warning" />
                  <span className="flex-1 text-body">
                    {n(d.flagged_sites.domains)} more {d.flagged_sites.domains === 1 ? "site was" : "sites were"} only flagged, not blocked ({n(d.flagged_sites.events)} visits)
                  </span>
                  <Link href={reportLink("web")} className={HEAD_LINK}>View <ArrowRight className="h-3 w-3" /></Link>
                </div>
              )}
            </Card>

            <Card title="Blocked applications" subtitle="Apps stopped from running, including VPN clients"
              action={<Link href={reportLink("apps")} className={HEAD_LINK}>Report <ArrowRight className="h-3 w-3" /></Link>}>
              <RankedList
                rows={(d.top_apps ?? []).map((a: any) => ({
                  key: `${a.name}:${a.control}`, name: a.name,
                  detail: a.control === "vpn" ? "VPN · blocked by default" : "Application control",
                  count: a.count, tag: `${a.employees} ${a.employees === 1 ? "person" : "people"}`,
                }))}
                empty={<EmptyBox icon={AppWindow} title="No app was blocked" body="Apps you block in Application Control show up here when someone tries to open them."
                  action={<Link href="/dashboard/applications" className={SECONDARY_BTN}>Open Application Control</Link>} />}
              />
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
