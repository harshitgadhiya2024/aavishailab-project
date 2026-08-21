"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { orgApi, seatAlertApi } from "@/lib/api";
import { Building2, Users, Shield, Activity, TrendingUp, AlertCircle, Gauge, ChevronRight } from "lucide-react";
import { formatNumber, formatDate } from "@/lib/utils";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend
} from "recharts";

const PLAN_COLORS = ["#FF7000", "#FF8B33", "#FFA366", "#FFC299"];

export default function DashboardPage() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ["org-stats"],
    queryFn: orgApi.stats,
    refetchInterval: 30_000,
  });

  const { data: seatAlerts } = useQuery({
    queryKey: ["seat-alerts"],
    queryFn: seatAlertApi.list,
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-28 bg-card rounded-xl border border-border" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-72 bg-card rounded-xl border border-border" />
          <div className="h-72 bg-card rounded-xl border border-border" />
        </div>
      </div>
    );
  }

  const s = stats?.data ?? {};

  const metricCards = [
    {
      label: "Total Organizations",
      value: formatNumber(s.total_orgs ?? 0),
      sub: `${s.active_orgs ?? 0} active`,
      icon: Building2,
      color: "bg-brand-500/10 text-brand-500",
    },
    {
      label: "Total Users",
      value: formatNumber(s.total_users ?? 0),
      sub: "across all orgs",
      icon: Users,
      color: "bg-green-500/10 text-green-400",
    },
    {
      label: "Total Employees",
      value: formatNumber(s.total_employees ?? 0),
      sub: "managed endpoints",
      icon: Shield,
      color: "bg-purple-500/10 text-purple-400",
    },
    {
      label: "Activity Events",
      value: formatNumber(s.total_events ?? 0),
      sub: "last 30 days",
      icon: Activity,
      color: "bg-brand-500/10 text-brand-500",
    },
  ];

  const planData = Object.entries(s.by_plan ?? {}).map(([name, count]) => ({
    name: name.charAt(0).toUpperCase() + name.slice(1),
    value: count as number,
  }));

  const trendData = (s.trend_by_day ?? []).map((d: any) => ({
    date: formatDate(d.date),
    events: d.count,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Platform Overview</h2>
        <p className="text-sm text-muted-foreground mt-1">Real-time metrics across all organizations</p>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {metricCards.map((c) => (
          <div key={c.label} className="bg-card rounded-xl p-5 border border-border shadow-sm">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{c.label}</p>
                <p className="text-3xl font-bold text-foreground mt-1">{c.value}</p>
                <p className="text-xs text-[#6B6B6B] mt-1">{c.sub}</p>
              </div>
              <div className={`p-2.5 rounded-lg ${c.color}`}>
                <c.icon className="w-5 h-5" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Activity trend */}
        <div className="bg-card rounded-xl p-5 border border-border shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-foreground">Activity Trend (30d)</h3>
            <TrendingUp className="w-4 h-4 text-muted-foreground" />
          </div>
          {trendData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={trendData}>
                <defs>
                  <linearGradient id="eventGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#FF7000" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#FF7000" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#A3A3A3" }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#A3A3A3" }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: "#141414", border: "1px solid #262626", color: "#F5F5F5" }} />
                <Area
                  type="monotone"
                  dataKey="events"
                  stroke="#FF7000"
                  strokeWidth={2}
                  fill="url(#eventGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-[#6B6B6B] text-sm">
              No activity data yet
            </div>
          )}
        </div>

        {/* Plan distribution */}
        <div className="bg-card rounded-xl p-5 border border-border shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-foreground">Organizations by Plan</h3>
            <AlertCircle className="w-4 h-4 text-muted-foreground" />
          </div>
          {planData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={planData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {planData.map((_, i) => (
                    <Cell key={i} fill={PLAN_COLORS[i % PLAN_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ background: "#141414", border: "1px solid #262626", color: "#F5F5F5" }} />
                <Legend iconType="circle" iconSize={10} wrapperStyle={{ color: "#A3A3A3" }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-[#6B6B6B] text-sm">
              No organizations yet
            </div>
          )}
        </div>
      </div>

      {/* Seat-limit alerts */}
      {(seatAlerts?.data?.alerts ?? []).length > 0 && (
        <div className="bg-card rounded-xl border border-yellow-500/20 shadow-sm">
          <div className="px-5 py-4 border-b border-border flex items-center gap-2">
            <Gauge className="w-4 h-4 text-yellow-400" />
            <h3 className="font-semibold text-foreground">Orgs Near Seat Limit</h3>
            <span className="text-xs text-muted-foreground">({seatAlerts?.data?.threshold_pct}%+ used)</span>
          </div>
          <div className="divide-y divide-border">
            {(seatAlerts?.data?.alerts ?? []).map((a: any) => (
              <Link
                key={a.org_id}
                href={`/dashboard/organizations/${a.org_id}`}
                className="px-5 py-3 flex items-center justify-between text-sm hover:bg-muted transition-colors"
              >
                <span className="text-foreground">{a.org_name}</span>
                <span className="flex items-center gap-3">
                  <span className="text-muted-foreground tabular-nums">{a.user_count}/{a.max_users} seats ({a.percent_used}%)</span>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
