"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Download, Activity, Monitor, Camera, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { BrandLogo, BrandMark } from "@/components/brand/BrandLogo";

const navItems = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/dashboard/download", icon: Download, label: "Download Agent" },
  { href: "/dashboard/devices", icon: Monitor, label: "My Devices" },
  { href: "/dashboard/activity", icon: Activity, label: "My Activity" },
  { href: "/dashboard/screenshots", icon: Camera, label: "My Screenshots" },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  // Phones always get the compact icon rail so the page keeps its width;
  // `wide` is true only where the full sidebar shows (md and up, not collapsed).
  const wide = !collapsed;

  return (
    <aside
      className={cn(
        "relative flex h-screen flex-shrink-0 flex-col border-r border-border bg-card text-foreground transition-[width] duration-300",
        collapsed ? "w-16" : "w-16 md:w-64"
      )}
    >
      <div className={cn("flex h-16 shrink-0 items-center justify-center border-b border-border", wide && "md:justify-between md:px-4")}>
        <BrandMark className={cn("h-7 w-7", wide && "md:hidden")} />
        {wide && (
          <>
            <span className="hidden md:inline-flex"><BrandLogo className="text-[20px]" /></span>
            <span className="hidden font-mono text-[9.5px] uppercase tracking-[0.12em] text-subtle md:inline">Portal</span>
          </>
        )}
      </div>

      <nav className="sidebar-scroll flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
        {wide && (
          <p className="hidden px-2.5 pb-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-subtle md:block">My protection</p>
        )}
        {navItems.map((item) => {
          const isActive = pathname === item.href ||
            (item.href !== "/dashboard" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              aria-label={item.label}
              className={cn(
                "relative flex h-9 items-center justify-center gap-3 rounded-md text-[13.5px] font-medium transition-colors",
                wide && "md:justify-start md:px-2.5",
                isActive
                  ? "bg-brand-tint text-brand-700 dark:text-brand-300"
                  : "text-muted-foreground hover:bg-elevated hover:text-foreground"
              )}
            >
              {/* The website's pixel marker on the active row. */}
              {isActive && wide && <span aria-hidden className="absolute -left-2 top-1/2 hidden h-4 w-[3px] -translate-y-1/2 bg-brand-500 md:block" />}
              <item.icon className={cn("h-[18px] w-[18px] flex-shrink-0", isActive ? "text-brand-500" : "text-subtle")} />
              {wide && <span className="hidden truncate md:inline">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Footer: collapse control, in the website's mono label style (desktop only). */}
      <div className="hidden border-t border-border p-2 md:block">
        <button
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : undefined}
          className={cn(
            "flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-subtle transition-colors hover:bg-elevated hover:text-foreground",
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
