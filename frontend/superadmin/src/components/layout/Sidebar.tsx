"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Shield, LayoutDashboard, Building2, Activity,
  Settings, ChevronLeft, ChevronRight, Globe, Download, AppWindow,
  HeartPulse, ClipboardList, Users2, CreditCard, ShieldAlert, Megaphone,
  Flag, LifeBuoy
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/dashboard/organizations", icon: Building2, label: "Organizations" },
  { href: "/dashboard/billing", icon: CreditCard, label: "Billing & Revenue" },
  { href: "/dashboard/agent-versions", icon: Download, label: "Agent Versions" },
  { href: "/dashboard/applications", icon: AppWindow, label: "Application Catalog" },
  { href: "/dashboard/threat-intel", icon: ShieldAlert, label: "Threat Intel" },
  { href: "/dashboard/activity", icon: Activity, label: "Global Activity" },
  { href: "/dashboard/system-health", icon: HeartPulse, label: "System Health" },
  { href: "/dashboard/audit-log", icon: ClipboardList, label: "Audit Log" },
  { href: "/dashboard/announcements", icon: Megaphone, label: "Announcements" },
  { href: "/dashboard/feature-flags", icon: Flag, label: "Feature Flags" },
  { href: "/dashboard/tickets", icon: LifeBuoy, label: "Support Tickets" },
  { href: "/dashboard/team", icon: Users2, label: "Team" },
  { href: "/dashboard/settings", icon: Settings, label: "Settings" },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        "h-screen bg-[#0A0A0A] text-foreground flex flex-col transition-all duration-300 relative border-r border-border",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-border">
        <div className="w-8 h-8 bg-brand-500 rounded-lg flex items-center justify-center flex-shrink-0">
          <Shield className="w-5 h-5 text-[#0A0A0A]" />
        </div>
        {!collapsed && (
          <div>
            <span className="font-bold text-lg text-foreground">Delsecure</span>
            <p className="text-xs text-muted-foreground">Superadmin</p>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = pathname === item.href ||
            (item.href !== "/dashboard" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm font-medium border-l-2",
                isActive
                  ? "bg-brand-500/10 text-brand-500 border-brand-500"
                  : "text-muted-foreground border-transparent hover:bg-muted hover:text-foreground"
              )}
            >
              <item.icon className="w-5 h-5 flex-shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-20 w-6 h-6 bg-card border border-border rounded-full flex items-center justify-center shadow-md hover:bg-muted transition-colors"
      >
        {collapsed
          ? <ChevronRight className="w-3 h-3 text-muted-foreground" />
          : <ChevronLeft className="w-3 h-3 text-muted-foreground" />
        }
      </button>

      {/* Footer */}
      {!collapsed && (
        <div className="px-4 py-3 border-t border-border">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Globe className="w-3 h-3" />
            <span>v1.0.0 — MVP</span>
          </div>
        </div>
      )}
    </aside>
  );
}
