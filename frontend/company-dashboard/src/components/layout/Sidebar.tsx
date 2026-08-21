"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Shield, LayoutDashboard, Users, UsersRound, FileText,
  Activity, Globe, Bot, Monitor, ChevronLeft, ChevronRight, ChevronDown,
  BarChart3, FileWarning, Cloud, CloudCog, Inbox, Tags, ShieldCheck, UserCog, AppWindow, Camera,
  LifeBuoy
} from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { PERMISSIONS, usePermissions } from "@/lib/permissions";

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
      { href: "/dashboard/policies", icon: FileText, label: "Policies", permission: PERMISSIONS.policiesRead },
      { href: "/dashboard/categories", icon: Tags, label: "Policy Categories", permission: PERMISSIONS.categoriesRead },
      { href: "/dashboard/applications", icon: AppWindow, label: "Application Control", permission: PERMISSIONS.policiesRead },
      { href: "/dashboard/access-requests", icon: Inbox, label: "Access Requests", permission: PERMISSIONS.accessRequestsRead },
    ],
  },
  {
    id: "protection",
    label: "Protection",
    items: [
      { href: "/dashboard/swg", icon: Globe, label: "Web Gateway", permission: PERMISSIONS.swgRead },
      { href: "/dashboard/dlp", icon: FileWarning, label: "Data Loss Prevention", permission: PERMISSIONS.policiesRead },
      { href: "/dashboard/ssl-inspection", icon: ShieldCheck, label: "SSL Inspection", permission: PERMISSIONS.settingsRead },
    ],
  },
  {
    id: "cloud",
    label: "Cloud & SaaS",
    items: [
      { href: "/dashboard/shadow-it", icon: Cloud, label: "Shadow IT", permission: PERMISSIONS.shadowItRead },
      { href: "/dashboard/casb", icon: CloudCog, label: "CASB", permission: PERMISSIONS.casbRead },
    ],
  },
  {
    id: "insights",
    label: "Monitoring",
    items: [
      { href: "/dashboard/activity", icon: Activity, label: "Activity", permission: PERMISSIONS.activityRead },
      { href: "/dashboard/screenshots", icon: Camera, label: "Screenshots", permission: PERMISSIONS.monitoringRead },
      { href: "/dashboard/reports", icon: BarChart3, label: "Reports", permission: PERMISSIONS.reportsRead },
      { href: "/dashboard/ai-assistant", icon: Bot, label: "AI Assistant", permission: PERMISSIONS.aiUse },
    ],
  },
  {
    id: "support",
    label: "Help",
    items: [
      // No permission gate — every role can ask for help.
      { href: "/dashboard/support", icon: LifeBuoy, label: "Support" },
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
          "flex items-center gap-3 px-3 py-2 rounded-lg transition-all text-sm font-medium border-l-2",
          active
            ? "bg-brand-500/10 text-brand-500 border-brand-500"
            : "text-muted-foreground border-transparent hover:bg-muted hover:text-foreground"
        )}
      >
        <item.icon className="w-5 h-5 flex-shrink-0" />
        {!collapsed && <span className="truncate">{item.label}</span>}
      </Link>
    );
  };

  return (
    <aside
      className={cn(
        "h-screen bg-background text-foreground flex flex-col transition-all duration-300 relative border-r border-border",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-border">
        <div className="w-8 h-8 bg-brand-500 rounded-lg flex items-center justify-center flex-shrink-0">
          <Shield className="w-5 h-5 text-on-brand" />
        </div>
        {!collapsed && (
          <div>
            <span className="font-bold text-lg text-foreground">Delsecure</span>
            <p className="text-xs text-muted-foreground">Company Admin</p>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 px-2 overflow-y-auto">
        <div className="space-y-1">{renderItem(overview)}</div>

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
            <div key={group.id} className={cn("mt-3", collapsed && "pt-3 border-t border-border")}>
              {!collapsed && (
                <button
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  aria-expanded={open}
                  className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg group hover:bg-muted transition-colors"
                >
                  <span
                    className={cn(
                      "text-[11px] font-semibold uppercase tracking-wider",
                      hasActive ? "text-brand-500" : "text-subtle group-hover:text-muted-foreground"
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

              {open && <div className="space-y-1 mt-1">{group.items.map(renderItem)}</div>}
            </div>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className="absolute -right-3 top-20 w-6 h-6 bg-card border border-border rounded-full flex items-center justify-center shadow-md hover:bg-muted transition-colors"
      >
        {collapsed
          ? <ChevronRight className="w-3 h-3 text-muted-foreground" />
          : <ChevronLeft className="w-3 h-3 text-muted-foreground" />}
      </button>

      {/* Footer version */}
      {!collapsed && (
        <div className="px-4 py-3 border-t border-border">
          <p className="text-xs text-muted-foreground">Delsecure v1.0 MVP</p>
        </div>
      )}
    </aside>
  );
}
