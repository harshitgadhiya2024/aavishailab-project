"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Building2, Activity, Settings, PanelLeftClose, PanelLeftOpen, Download, AppWindow,
  HeartPulse, ClipboardList, Users2, CreditCard, ShieldAlert, Megaphone, Flag, LifeBuoy, Inbox, Newspaper, BookOpen, Hourglass,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { overviewApi } from "@/lib/api";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { BrandLogo, BrandMark } from "@/components/brand/BrandLogo";

type Item = { href: string; icon: React.ElementType; label: string; badge?: "tickets" | "demos" | "waitlist" };

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
      { href: "/dashboard/waitlist", icon: Hourglass, label: "Waitlist", badge: "waitlist" },
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
    section: "Website",
    items: [
      { href: "/dashboard/content/blog", icon: Newspaper, label: "Blog" },
      { href: "/dashboard/content/knowledge-hub", icon: BookOpen, label: "Knowledge Hub" },
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
    waitlist: data?.badges?.waitlist_waiting ?? 0,
  };

  return (
    <aside
      className={cn(
        "relative flex h-screen flex-shrink-0 flex-col border-r border-border bg-card text-foreground transition-[width] duration-300",
        collapsed ? "w-16" : "w-64",
      )}
    >
      <div className={cn("flex h-16 shrink-0 items-center border-b border-border", collapsed ? "justify-center" : "justify-between px-4")}>
        {collapsed ? (
          <BrandMark className="h-7 w-7" />
        ) : (
          <>
            <BrandLogo className="text-[20px]" />
            <span className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-subtle">Superadmin</span>
          </>
        )}
      </div>

      <nav className="sidebar-scroll flex-1 overflow-y-auto px-3 py-4">
        {NAV.map((group) => (
          <div key={group.section || "home"} className="mb-4">
            {group.section && !collapsed && (
              <p className="px-2.5 pb-1.5 pt-1 font-mono text-[10.5px] uppercase tracking-[0.12em] text-subtle">{group.section}</p>
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
                      "relative flex h-9 items-center gap-3 rounded-md px-2.5 text-[13.5px] font-medium transition-colors",
                      collapsed && "justify-center px-0",
                      active
                        ? "bg-brand-tint text-brand-700"
                        : "text-muted-foreground hover:bg-elevated hover:text-foreground",
                    )}
                  >
                    {/* The website's pixel marker on the active row. */}
                    {active && !collapsed && <span aria-hidden className="absolute -left-2 top-1/2 h-4 w-[3px] -translate-y-1/2 bg-brand-500" />}
                    <item.icon className={cn("h-[18px] w-[18px] flex-shrink-0", active ? "text-brand-500" : "text-subtle")} />
                    {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                    {count > 0 && (
                      <span
                        className={cn(
                          "rounded-[4px] bg-brand-500 text-center font-mono text-[10.5px] font-medium text-white",
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

      {/* Footer: collapse control, in the website's mono label style. */}
      <div className="border-t border-border p-2">
        <button
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : undefined}
          className={cn(
            "group flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-subtle transition-colors hover:bg-elevated hover:text-foreground",
            collapsed && "justify-center px-0",
          )}
        >
          {collapsed
            ? <PanelLeftOpen className="h-[18px] w-[18px]" />
            : <PanelLeftClose className="h-[18px] w-[18px]" />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
