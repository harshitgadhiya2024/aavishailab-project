"use client";

import { useQuery } from "@tanstack/react-query";
import { portalApi } from "@/lib/api";
import { Shield, ShieldAlert, Monitor, Download, ArrowRight } from "lucide-react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { format, subDays } from "date-fns";

type DayCount = { date: string; blocked: number; allowed: number };
type DomainCount = { domain: string; count: number; reason: string };

export default function DashboardPage() {
  const { data: session } = useSession();
  const user = session?.user;

  const { data: meData, isLoading } = useQuery({
    queryKey: ["portal-me"],
    queryFn: () => portalApi.me(),
  });

  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ["portal-activity-stats-7d"],
    queryFn: () => portalApi.activityStats({ days: 7 }),
    refetchInterval: 30_000,
  });

  const stats = meData?.data?.stats_7d ?? { blocked: 0, allowed: 0 };
  const devices = meData?.data?.devices ?? [];
  const onlineDevices = devices.filter((d: { status: string }) => d.status === "online").length;

  const byDay: DayCount[] = statsData?.data?.by_day ?? [];
  const topBlocked: DomainCount[] = (statsData?.data?.top_blocked ?? []).slice(0, 5);

  const byDayMap = new Map(byDay.map((d) => [d.date.slice(0, 10), d.blocked]));
  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const date = subDays(new Date(), 6 - i);
    const key = format(date, "yyyy-MM-dd");
    return { key, label: format(date, "EEE"), blocked: byDayMap.get(key) ?? 0 };
  });
  const maxBlocked = Math.max(...last7Days.map((d) => d.blocked), 1);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">
          Welcome, {user?.first_name || "there"}
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Your company security protection overview
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          icon={ShieldAlert}
          label="Blocked (7 days)"
          value={isLoading ? "—" : String(stats.blocked)}
          color="text-danger"
          bg="bg-red-500/10"
        />
        <StatCard
          icon={Monitor}
          label="Devices enrolled"
          value={isLoading ? "—" : String(devices.length)}
          color="text-brand-500"
          bg="bg-brand-500/10"
        />
        <StatCard
          icon={Shield}
          label="Devices online"
          value={isLoading ? "—" : String(onlineDevices)}
          color="text-brand-500"
          bg="bg-brand-500/10"
        />
      </div>

      {devices.length === 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-6 flex items-start gap-4">
          <Download className="w-6 h-6 text-warning flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-semibold text-warning">Install the security agent</h3>
            <p className="text-sm text-warning/80 mt-1">
              No devices are enrolled yet. Download and run the installer for your device
              to enable web protection and policy enforcement.
            </p>
            <Link
              href="/dashboard/download"
              className="inline-flex items-center gap-1.5 mt-3 text-sm font-medium text-warning hover:text-warning"
            >
              Go to Download <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card rounded-xl border border-border shadow-sm p-6 flex flex-col">
          <h3 className="font-semibold text-foreground mb-4">Blocked sites — last 7 days</h3>
          {statsLoading ? (
            <div className="flex-1 min-h-[160px] flex items-center justify-center text-sm text-subtle">Loading…</div>
          ) : (
            <div className="flex-1 min-h-[160px] flex items-end justify-between gap-2 border-b border-border">
              {last7Days.map((d) => (
                <div key={d.key} className="flex-1 flex flex-col items-center gap-2 group relative">
                  <div className="w-full flex items-end justify-center h-32">
                    <div
                      className="relative w-full max-w-[28px] rounded-t bg-red-400/70 group-hover:bg-red-400 transition-colors"
                      style={{ height: `${(d.blocked / maxBlocked) * 100}%` }}
                    >
                      <div className="absolute -top-9 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-elevated border border-border text-xs text-foreground px-2 py-1 rounded-md whitespace-nowrap pointer-events-none z-10">
                        <span className="font-semibold">{d.blocked}</span> blocked
                      </div>
                    </div>
                  </div>
                  <span className="text-[11px] text-subtle pb-1">{d.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-card rounded-xl border border-border shadow-sm p-6 flex flex-col">
          <h3 className="font-semibold text-foreground mb-4">Top blocked domains (7 days)</h3>
          {statsLoading ? (
            <div className="flex-1 min-h-[160px] flex items-center justify-center text-sm text-subtle">Loading…</div>
          ) : topBlocked.length === 0 ? (
            <div className="flex-1 min-h-[160px] flex items-center justify-center text-sm text-subtle text-center px-4">
              No blocked sites in the last 7 days.
            </div>
          ) : (
            <div className="space-y-3">
              {topBlocked.map((d, i) => (
                <div key={d.domain} className="flex items-center gap-3">
                  <span className="text-xs font-mono text-subtle w-4 flex-shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-body truncate">{d.domain}</p>
                    {d.reason && <p className="text-xs text-subtle truncate">{d.reason}</p>}
                  </div>
                  <span className="text-xs font-medium text-danger bg-red-500/10 px-2 py-0.5 rounded-full flex-shrink-0">
                    {d.count}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card rounded-xl border border-border shadow-sm p-6">
          <h3 className="font-semibold text-foreground mb-4">Quick actions</h3>
          <div className="space-y-3">
            <QuickLink href="/dashboard/download" title="Download security agent" desc="One-click installer for your device" />
            <QuickLink href="/dashboard/activity?action=blocked" title="View blocked sites" desc="See why websites were blocked" />
            <QuickLink href="/dashboard/devices" title="Manage devices" desc="Check enrolled device status" />
          </div>
        </div>

        <div className="bg-card rounded-xl border border-border shadow-sm p-6">
          <h3 className="font-semibold text-foreground mb-4">How protection works</h3>
          <ol className="space-y-3 text-sm text-body list-decimal list-inside">
            <li>Download the agent for your operating system</li>
            <li>Run the installer — it sets up automatically</li>
            <li>Your browser traffic is routed through company policy</li>
            <li>Blocked sites show a reason page in your browser</li>
            <li>View your activity history here anytime</li>
          </ol>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color, bg }: {
  icon: React.ElementType; label: string; value: string; color: string; bg: string;
}) {
  return (
    <div className="bg-card rounded-xl border border-border shadow-sm p-5">
      <div className={`w-10 h-10 rounded-lg ${bg} flex items-center justify-center mb-3`}>
        <Icon className={`w-5 h-5 ${color}`} />
      </div>
      <p className="text-2xl font-bold text-foreground">{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
    </div>
  );
}

function QuickLink({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link href={href} className="flex items-center justify-between p-3 rounded-lg hover:bg-elevated border border-border transition-colors">
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
      <ArrowRight className="w-4 h-4 text-subtle" />
    </Link>
  );
}
