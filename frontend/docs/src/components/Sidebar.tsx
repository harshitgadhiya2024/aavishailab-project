"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Shield, ChevronLeft, ChevronRight } from "lucide-react";
import { navGroups } from "@/lib/nav";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        "h-screen sticky top-0 bg-[#0A0A0A] text-foreground flex flex-col transition-all duration-300 border-r border-border flex-shrink-0",
        collapsed ? "w-16" : "w-72"
      )}
    >
      <Link href="/" className="flex items-center gap-3 px-5 py-5 border-b border-border">
        <div className="w-8 h-8 bg-brand-500 rounded-lg flex items-center justify-center flex-shrink-0">
          <Shield className="w-5 h-5 text-[#0A0A0A]" />
        </div>
        {!collapsed && (
          <div>
            <span className="font-bold text-lg text-foreground">Aavishield</span>
            <p className="text-xs text-muted-foreground">Documentation</p>
          </div>
        )}
      </Link>

      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-6">
        {navGroups.map((group) => (
          <div key={group.id}>
            {!collapsed && (
              <p className="px-2 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                {group.label}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm transition-colors border-l-2",
                      active
                        ? "bg-brand-500/10 text-brand-500 border-brand-500 font-medium"
                        : "text-muted-foreground border-transparent hover:bg-muted hover:text-foreground"
                    )}
                    title={item.label}
                  >
                    <item.icon className="w-4 h-4 flex-shrink-0" />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center justify-center gap-2 border-t border-border py-3 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      >
        {collapsed ? <ChevronRight className="w-4 h-4" /> : <><ChevronLeft className="w-4 h-4" /> Collapse</>}
      </button>
    </aside>
  );
}
