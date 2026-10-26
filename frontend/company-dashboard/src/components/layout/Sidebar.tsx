"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Users, UsersRound,
  Activity, Globe, Monitor, ChevronDown, PanelLeftClose, PanelLeftOpen,
  BarChart3, FileWarning, Inbox, Tags, UserCog, AppWindow, Camera,
} from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { PERMISSIONS, usePermissions } from "@/lib/permissions";
import { BrandLogo, BrandMark } from "@/components/brand/BrandLogo";

type NavItem = { href: string; icon: React.ElementType; label: string; permission?: string };
type NavGroup = { id: string; label: string; items: NavItem[] };

// Dashboard sits above the groups — it's the landing page, not part of any
// workflow, and burying it under a heading only adds a click.
const overview: NavItem = { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" };

const navGroups: NavGroup[] = [
  {
    id: "organization",
    label: "Organization",
    items: [
      { href: "/dashboard/employees", icon: Users, label: "Employees", permission: PERMISSIONS.employeesRead },
      { href: "/dashboard/teams", icon: UsersRound, label: "Teams", permission: PERMISSIONS.teamsRead },
      { href: "/dashboard/devices", icon: Monitor, label: "Devices", permission: PERMISSIONS.devicesRead },
      { href: "/dashboard/users", icon: UserCog, label: "Team & Access", permission: PERMISSIONS.usersRead },
    ],
  },
  {
    id: "policies",
    label: "Policy Management",
    items: [
      { href: "/dashboard/categories", icon: Tags, label: "Policy Categories", permission: PERMISSIONS.categoriesRead },
      { href: "/dashboard/swg", icon: Globe, label: "Web Gateway", permission: PERMISSIONS.swgRead },
      { href: "/dashboard/applications", icon: AppWindow, label: "Application Control", permission: PERMISSIONS.policiesRead },
      // DLP has no policies of its own any more — it is on for every org, and
      // this tab is purely the log of what it saw. It sits here because that
      // is where the requirement's sidebar order puts it, not because there is
      // anything to configure.
      { href: "/dashboard/dlp", icon: FileWarning, label: "Data Loss Prevention", permission: PERMISSIONS.policiesRead },
    ],
  },
  {
    id: "insights",
    label: "Monitoring",
    items: [
      { href: "/dashboard/activity", icon: Activity, label: "Activity", permission: PERMISSIONS.activityRead },
      { href: "/dashboard/screenshots", icon: Camera, label: "Screenshots", permission: PERMISSIONS.monitoringRead },
      { href: "/dashboard/access-requests", icon: Inbox, label: "Access Requests", permission: PERMISSIONS.accessRequestsRead },
      { href: "/dashboard/reports", icon: BarChart3, label: "Reports", permission: PERMISSIONS.reportsRead },
    ],
  },
];

const STORAGE_KEY = "aavishield-sidebar-groups";

function isItemActive(pathname: string, href: string) {
  return pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
}

export function Sidebar() {
  const pathname = usePathname();
  const { can } = usePermissions();
  const [collapsed, setCollapsed] = useState(false);
  // Every group starts open; a collapsed group is remembered per browser so the
  // sidebar looks the same on the next visit.
  const [closedGroups, setClosedGroups] = useState<string[]>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setClosedGroups(JSON.parse(stored));
    } catch {
      /* corrupt value — fall back to all groups open */
    }
  }, []);

  // The section you are currently in is always open, so the active page can
  // never be hidden behind a collapsed heading. This runs on navigation only —
  // collapsing the group you're looking at still sticks until you move away.
  useEffect(() => {
    const activeGroup = navGroups.find(g => g.items.some(item => isItemActive(pathname, item.href)));
    if (!activeGroup) return;
    setClosedGroups(prev => {
      if (!prev.includes(activeGroup.id)) return prev;
      const next = prev.filter(g => g !== activeGroup.id);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable — state still applies for this session */
      }
      return next;
    });
  }, [pathname]);

  const toggleGroup = (id: string) => {
    setClosedGroups(prev => {
      const next = prev.includes(id) ? prev.filter(g => g !== id) : [...prev, id];
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable (private mode) — state still works for this session */
      }
      return next;
    });
  };

  const renderItem = (item: NavItem) => {
    const active = isItemActive(pathname, item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        title={collapsed ? item.label : undefined}
        className={cn(
          "relative flex h-9 items-center gap-3 rounded-md px-2.5 text-[13.5px] font-medium transition-colors",
          collapsed && "justify-center px-0",
          active
            ? "bg-brand-tint text-brand-700 dark:text-brand-300"
            : "text-muted-foreground hover:bg-elevated hover:text-foreground"
        )}
      >
        {/* The website's pixel marker on the active row. */}
        {active && !collapsed && <span aria-hidden className="absolute -left-2 top-1/2 h-4 w-[3px] -translate-y-1/2 bg-brand-500" />}
        <item.icon className={cn("h-[18px] w-[18px] flex-shrink-0", active ? "text-brand-500" : "text-subtle")} />
        {!collapsed && <span className="truncate">{item.label}</span>}
      </Link>
    );
  };

  return (
    <aside
      className={cn(
        "h-screen bg-card text-foreground flex flex-col transition-[width] duration-300 relative border-r border-border",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {/* Logo */}
      <div className={cn("flex h-16 shrink-0 items-center border-b border-border", collapsed ? "justify-center" : "justify-between px-4")}>
        {collapsed ? (
          <BrandMark className="h-7 w-7" />
        ) : (
          <>
            <BrandLogo className="text-[20px]" />
            <span className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-subtle">Admin</span>
          </>
        )}
      </div>

      {/* Nav */}
      <nav className="sidebar-scroll flex-1 overflow-y-auto px-3 py-4">
        <div className="space-y-0.5">{renderItem(overview)}</div>

        {navGroups
          .map(group => ({ ...group, items: group.items.filter(i => !i.permission || can(i.permission)) }))
          // A group whose every destination is off-limits would otherwise render
          // as an empty heading.
          .filter(group => group.items.length > 0)
          .map(group => {
          const hasActive = group.items.some(item => isItemActive(pathname, item.href));
          // A collapsed rail has no room for headings, so groups become icon
          // runs separated by a divider and everything stays reachable.
          const open = collapsed || !closedGroups.includes(group.id);

          return (
            <div key={group.id} className={cn("mt-5", collapsed && "mt-3 pt-3 border-t border-border")}>
              {!collapsed && (
                <button
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  aria-expanded={open}
                  className="group flex w-full items-center justify-between px-2.5 pb-1.5"
                >
                  <span
                    className={cn(
                      "font-mono text-[10.5px] uppercase tracking-[0.12em] transition-colors",
                      hasActive ? "text-brand-600 dark:text-brand-400" : "text-subtle group-hover:text-foreground"
                    )}
                  >
                    {group.label}
                  </span>
                  <ChevronDown
                    className={cn(
                      "w-3.5 h-3.5 text-faint transition-transform",
                      open ? "rotate-0" : "-rotate-90"
                    )}
                  />
                </button>
              )}

              {open && <div className="space-y-0.5">{group.items.map(renderItem)}</div>}
            </div>
          );
        })}
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
          {!collapsed && <span className="ml-auto text-faint">v1.0 · MVP</span>}
        </button>
      </div>
    </aside>
  );
}
