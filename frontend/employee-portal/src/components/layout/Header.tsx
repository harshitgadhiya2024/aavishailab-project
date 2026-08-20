"use client";

import { useSession, signOut } from "next-auth/react";
import { Bell, LogOut, ChevronDown, Building2 } from "lucide-react";
import { useState } from "react";
import { getInitials } from "@/lib/utils";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

export function Header({ title }: { title?: string }) {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const user = session?.user;

  return (
    <header className="h-16 bg-card border-b border-border flex items-center justify-between px-6 sticky top-0 z-30">
      <div>
        <h1 className="text-lg font-semibold text-foreground">{title || "Dashboard"}</h1>
      </div>

      <div className="flex items-center gap-3">
        {(user as any)?.org_name && (
          <div className="hidden sm:flex items-center gap-1.5 bg-brand-500/10 text-brand-500 px-3 py-1.5 rounded-lg text-xs font-medium">
            <Building2 className="w-3.5 h-3.5" />
            <span className="max-w-[120px] truncate">{(user as any).org_name}</span>
          </div>
        )}

        <ThemeToggle />

        <button className="relative p-2 rounded-lg hover:bg-muted transition-colors">
          <Bell className="w-5 h-5 text-muted-foreground" />
        </button>

        <div className="relative">
          <button
            onClick={() => setOpen(!open)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-muted transition-colors"
          >
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-sm font-medium">
              {getInitials(user?.full_name || user?.email || "E")}
            </div>
            <div className="text-left hidden sm:block">
              <p className="text-sm font-medium text-foreground leading-none">
                {user?.full_name || "Employee"}
              </p>
              <p className="text-xs text-subtle mt-0.5">{user?.department || user?.email}</p>
            </div>
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          </button>

          {open && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
              <div className="absolute right-0 mt-2 w-56 bg-card rounded-xl shadow-lg border border-border py-1 z-50">
                <div className="px-4 py-3 border-b border-border">
                  <p className="text-sm font-medium text-foreground truncate">{user?.full_name}</p>
                  <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                </div>
                <button
                  onClick={() => signOut({ callbackUrl: "/login" })}
                  className="flex items-center gap-2 w-full px-4 py-2 text-sm text-danger hover:bg-red-500/10"
                >
                  <LogOut className="w-4 h-4" /> Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
