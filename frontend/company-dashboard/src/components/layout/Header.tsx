"use client";

import { useSession, signOut } from "next-auth/react";
import { LogOut, Settings, ChevronDown, Building2, LifeBuoy } from "lucide-react";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { getInitials } from "@/lib/utils";
import { ThemeMenuItem } from "@/components/ui/ThemeToggle";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { SupportButton } from "@/components/support/SupportButton";

// Page title shown in the header, by route prefix (most specific first).
const TITLES: [string, string][] = [
  ["/dashboard/support", "Help & support"],
  ["/dashboard/reports", "Reports"],
  ["/dashboard/employees", "Employees"],
  ["/dashboard/teams", "Teams"],
  ["/dashboard/devices", "Devices"],
  ["/dashboard/users", "Team & access"],
  ["/dashboard/categories", "Policy categories"],
  ["/dashboard/swg", "Web gateway"],
  ["/dashboard/applications", "Application control"],
  ["/dashboard/dlp", "Data loss prevention"],
  ["/dashboard/activity", "Activity"],
  ["/dashboard/screenshots", "Screenshots"],
  ["/dashboard/access-requests", "Access requests"],
  ["/dashboard/profile", "Company profile"],
  ["/dashboard/settings", "Settings"],
];

export function Header({ title }: { title?: string }) {
  const pathname = usePathname();
  const pageTitle = title || TITLES.find(([p]) => pathname.startsWith(p))?.[1] || "Dashboard";
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const user = (session as any)?.user;

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between border-b border-border bg-card px-6">
      <div className="min-w-0">
        <h1 className="truncate text-[19px] font-medium tracking-[-0.02em] text-foreground">{pageTitle}</h1>
      </div>

      <div className="flex items-center gap-2">
        {/* Org badge */}
        <div className="mr-1 hidden items-center gap-1.5 rounded-md border border-brand-500/20 bg-brand-tint px-2.5 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-brand-700 dark:text-brand-300 sm:flex">
          <Building2 className="h-3.5 w-3.5" />
          <span className="max-w-[140px] truncate">{user?.org_name || "Organization"}</span>
        </div>

        {/* Help & support: every role can ask for help, so it lives in the
            header rather than in a permission-gated sidebar group. */}
        <SupportButton />

        {/* Notifications */}
        <NotificationBell />

        {/* Profile dropdown */}
        <div className="relative">
          <button
            onClick={() => setOpen(!open)}
            className="ml-1 flex items-center gap-2.5 rounded-md border border-transparent py-1.5 pl-1.5 pr-2.5 transition-colors hover:border-border hover:bg-elevated"
          >
            <div className="grid h-8 w-8 place-items-center rounded-md bg-brand-500 font-mono text-[12px] font-medium text-white">
              {getInitials(user?.full_name || user?.name || "CA")}
            </div>
            <div className="text-left hidden sm:block">
              <p className="text-sm font-medium text-foreground leading-none">
                {user?.full_name || user?.name || "Admin"}
              </p>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.08em] text-subtle">{user?.role?.replace(/_/g, " ") || "Admin"}</p>
            </div>
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          </button>

          {open && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
              <div className="absolute right-0 z-50 mt-2 w-60 rounded-lg border border-border bg-card py-1 shadow-xl">
                <div className="px-4 py-3 border-b border-border">
                  <p className="text-sm font-medium text-foreground truncate">
                    {user?.full_name || user?.name || "Admin"}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{user?.email || session?.user?.email}</p>
                </div>

                <Link
                  href="/dashboard/profile"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Building2 className="w-4 h-4" /> Company Profile
                </Link>
                <Link
                  href="/dashboard/settings"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Settings className="w-4 h-4" /> Settings
                </Link>
                <Link
                  href="/dashboard/support"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <LifeBuoy className="w-4 h-4" /> Help &amp; support
                </Link>

                {/* Theme lives here rather than in the header bar. */}
                <ThemeMenuItem />

                <div className="border-t border-border mt-1 pt-1">
                  <button
                    onClick={() => signOut({ callbackUrl: "/login" })}
                    className="flex items-center gap-2 w-full px-4 py-2 text-sm text-danger hover:bg-red-500/10"
                  >
                    <LogOut className="w-4 h-4" /> Sign out
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
