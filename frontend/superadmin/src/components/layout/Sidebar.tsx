"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Building2, Activity, Settings, ChevronLeft, ChevronRight, Download, AppWindow,
  HeartPulse, ClipboardList, Users2, CreditCard, ShieldAlert, Megaphone, Flag, LifeBuoy, Inbox,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { overviewApi } from "@/lib/api";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { BrandLogo, BrandMark } from "@/components/brand/BrandLogo";

type Item = { href: string; icon: React.ElementType; label: string; badge?: "tickets" | "demos" };

// Grouped by the job being done, in the order a day usually goes: look at the
// state of things, talk to customers, check money, ship product, keep the
// platform running, manage our own team.
export const NAV: { section: string; items: Item[] }[] = [
  { section: "", items: [{ href: "/dashboard", icon: LayoutDashboard, label: "Command Center" }] },
  {
    section: "Customers",
    items: [
      { href: "/dashboard/organizations", icon: Building2, label: "Organizations" },
      { href: "/dashboard/demo-requests", icon: Inbox, label: "Leads", badge: "demos" },
      { href: "/dashboard/tickets", icon: LifeBuoy, label: "Support", badge: "tickets" },
    ],
  },
  { section: "Revenue", items: [{ href: "/dashboard/billing", icon: CreditCard, label: "Billing & Revenue" }] },
  {
    section: "Product",
    items: [
      { href: "/dashboard/agent-versions", icon: Download, label: "Agent Releases" },
      { href: "/dashboard/applications", icon: AppWindow, label: "Application Catalog" },
      { href: "/dashboard/threat-intel", icon: ShieldAlert, label: "Threat Intel" },
      { href: "/dashboard/feature-flags", icon: Flag, label: "Feature Flags" },
      { href: "/dashboard/announcements", icon: Megaphone, label: "Announcements" },
    ],
  },
  {
    section: "Platform",
    items: [
      { href: "/dashboard/system-health", icon: HeartPulse, label: "System Health" },
      { href: "/dashboard/activity", icon: Activity, label: "Global Activity" },
      { href: "/dashboard/audit-log", icon: ClipboardList, label: "Audit Log" },
    ],
  },
  {
    section: "Admin",
    items: [
      { href: "/dashboard/team", icon: Users2, label: "Team" },
      { href: "/dashboard/settings", icon: Settings, label: "Settings" },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const { data } = useQuery({
    queryKey: ["sa-overview"],
    queryFn: () => overviewApi.get().then((r) => r.data),
    refetchInterval: 60_000,
  });
  const badges: Record<string, number> = {
    tickets: data?.badges?.tickets_open ?? 0,
    demos: data?.badges?.demo_requests_new ?? 0,
  };

  return (
    <aside
      className={cn(
        "relative flex h-screen flex-shrink-0 flex-col border-r border-border bg-[#0A0A0A] text-foreground transition-all duration-300",
        collapsed ? "w-16" : "w-64",
      )}
    >
      <div className="flex items-center gap-3 border-b border-border px-4 py-5">
        {collapsed ? (
          <BrandMark className="h-8 w-8" />
        ) : (
          <div className="min-w-0">
            <BrandLogo className="h-[72px]" priority />
            <p className="mt-1 text-xs text-muted-foreground">Superadmin</p>
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {NAV.map((group) => (
          <div key={group.section || "home"} className="mb-3">
            {group.section && !collapsed && (
              <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-[#6B6B6B]">{group.section}</p>
            )}
            {group.section && collapsed && <div className="mx-3 my-2 border-t border-border" />}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
                const count = item.badge ? badges[item.badge] : 0;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      "relative flex items-center gap-3 rounded-lg border-l-2 px-3 py-2 text-sm font-medium transition-colors",
                      active
                        ? "border-brand-500 bg-brand-500/10 text-brand-500"
                        : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <item.icon className="h-[18px] w-[18px] flex-shrink-0" />
                    {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                    {count > 0 && (
                      <span
                        className={cn(
                          "rounded-full bg-brand-500 text-center text-[11px] font-semibold text-[#0A0A0A]",
                          collapsed ? "absolute right-1 top-1 h-2 w-2 p-0 text-[0px]" : "min-w-5 px-1.5 py-0.5",
                        )}
                      >
                        {count > 99 ? "99+" : count}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <button
        onClick={() => setCollapsed(!collapsed)}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className="absolute -right-3 top-20 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card shadow-md transition-colors hover:bg-muted"
      >
        {collapsed ? <ChevronRight className="h-3 w-3 text-muted-foreground" /> : <ChevronLeft className="h-3 w-3 text-muted-foreground" />}
      </button>
    </aside>
  );
}
