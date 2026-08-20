"use client";

import { useSession, signOut } from "next-auth/react";
import { LogOut, Settings, ChevronDown, Building2 } from "lucide-react";
import { useState } from "react";
import Link from "next/link";
import { getInitials } from "@/lib/utils";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { NotificationBell } from "@/components/layout/NotificationBell";

export function Header({ title }: { title?: string }) {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const user = (session as any)?.user;

  return (
    <header className="h-16 bg-card border-b border-border flex items-center justify-between px-6 sticky top-0 z-30">
      <div>
        <h1 className="text-lg font-semibold text-foreground">{title || "Dashboard"}</h1>
      </div>

      <div className="flex items-center gap-3">
        {/* Org badge */}
        <div className="hidden sm:flex items-center gap-1.5 bg-brand-500/10 text-brand-500 px-3 py-1.5 rounded-lg text-xs font-medium">
          <Building2 className="w-3.5 h-3.5" />
          <span className="max-w-[120px] truncate">{user?.org_name || "Organization"}</span>
        </div>

        {/* Theme */}
        <ThemeToggle />

        {/* Notifications */}
        <NotificationBell />

        {/* Profile dropdown */}
        <div className="relative">
          <button
            onClick={() => setOpen(!open)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-muted transition-colors"
          >
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-sm font-medium">
              {getInitials(user?.full_name || user?.name || "CA")}
            </div>
            <div className="text-left hidden sm:block">
              <p className="text-sm font-medium text-foreground leading-none">
                {user?.full_name || user?.name || "Admin"}
              </p>
              <p className="text-xs text-subtle mt-0.5 capitalize">{user?.role?.replace(/_/g, " ") || "Admin"}</p>
            </div>
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          </button>

          {open && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
              <div className="absolute right-0 mt-2 w-56 bg-card rounded-xl shadow-lg border border-border py-1 z-50">
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
