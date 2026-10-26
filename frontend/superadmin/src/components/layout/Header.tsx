"use client";

import { useSession, signOut } from "next-auth/react";
import { usePathname } from "next/navigation";
import { Bell, User, LogOut, Settings, ChevronDown, AlertOctagon, AlertTriangle, Info, CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { overviewApi } from "@/lib/api";
import { NAV } from "./Sidebar";
import Link from "next/link";

// The page title comes from the same list the sidebar draws, so the two can
// never disagree.
function titleFor(pathname: string): string {
  if (pathname === "/dashboard/profile") return "Profile";
  if (/^\/dashboard\/organizations\/[^/]+/.test(pathname)) return "Organization";
  let best = { len: 0, label: "Command Center" };
  for (const g of NAV) for (const i of g.items) {
    const hit = pathname === i.href || (i.href !== "/dashboard" && pathname.startsWith(i.href));
    if (hit && i.href.length > best.len) best = { len: i.href.length, label: i.label };
  }
  return best.label;
}

const SEVERITY = {
  critical: { icon: AlertOctagon, tone: "text-red-600 bg-red-500/10" },
  warning: { icon: AlertTriangle, tone: "text-yellow-700 bg-yellow-500/10" },
  info: { icon: Info, tone: "text-sky-700 bg-sky-500/10" },
} as const;

function AttentionBell() {
  const [open, setOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ["sa-overview"],
    queryFn: () => overviewApi.get().then((r) => r.data),
    refetchInterval: 60_000,
  });
  const items: any[] = data?.attention ?? [];
  const urgent = items.filter((i) => i.severity !== "info").length;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-label={urgent > 0 ? `Needs attention (${urgent})` : "Needs attention"}
        className="relative rounded-lg p-2 transition-colors hover:bg-muted"
      >
        <Bell className="h-5 w-5 text-muted-foreground" />
        {urgent > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {urgent > 9 ? "9+" : urgent}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 flex max-h-[70vh] w-[380px] flex-col rounded-lg border border-border bg-card shadow-xl">
            <div className="border-b border-border px-4 py-3 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-foreground">Needs attention</div>
            <div className="flex-1 divide-y divide-border overflow-y-auto">
              {items.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  <CheckCircle2 className="mx-auto mb-2 h-7 w-7 text-green-500/60" />
                  Nothing needs you right now
                </div>
              ) : (
                items.map((it, idx) => {
                  const sev = SEVERITY[it.severity as keyof typeof SEVERITY] ?? SEVERITY.info;
                  return (
                    <Link key={idx} href={it.href} onClick={() => setOpen(false)} className="flex gap-3 px-4 py-3 hover:bg-muted">
                      <span className={cn("flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg", sev.tone)}>
                        <sev.icon className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-foreground">{it.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">{it.detail}</span>
                      </span>
                    </Link>
                  );
                })
              )}
            </div>
            <Link href="/dashboard" onClick={() => setOpen(false)} className="border-t border-border px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-brand-600 hover:text-brand-700">
              Open Command Center
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

export function Header({ title }: { title?: string }) {
  const { data: session } = useSession();
  const pathname = usePathname();
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const handleLogout = async () => {
    await signOut({ callbackUrl: "/login" });
  };

  const user = (session as any)?.user;

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between border-b border-border bg-card px-6">
      {/* Title */}
      <div className="min-w-0">
        <h1 className="truncate text-[19px] font-medium tracking-[-0.02em] text-foreground">{title || titleFor(pathname)}</h1>
      </div>

      {/* Right */}
      <div className="flex items-center gap-2">
        {/* Platform badge, in the website's mono style. */}
        <span className="mr-1 hidden rounded-md border border-brand-500/20 bg-brand-tint px-2.5 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-brand-700 sm:inline-flex">
          Platform admin
        </span>
        <AttentionBell />

        {/* Profile dropdown */}
        <div className="relative">
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="ml-1 flex items-center gap-2.5 rounded-md border border-transparent py-1.5 pl-1.5 pr-2.5 transition-colors hover:border-border hover:bg-elevated"
          >
            <div className="grid h-8 w-8 place-items-center rounded-md bg-brand-500 font-mono text-[12px] font-medium text-white">
              {user?.first_name?.[0] || user?.name?.[0] || "S"}
            </div>
            <div className="text-left hidden sm:block">
              <p className="text-sm font-medium text-foreground leading-none">
                {user?.full_name || user?.name || "Super Admin"}
              </p>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.08em] text-subtle">Superadmin</p>
            </div>
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          </button>

          {dropdownOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setDropdownOpen(false)}
              />
              <div className="absolute right-0 z-50 mt-2 w-60 rounded-lg border border-border bg-card py-1 shadow-xl">
                <div className="px-4 py-3 border-b border-border">
                  <p className="text-sm font-medium text-foreground">
                    {user?.full_name || "Super Admin"}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{user?.email || session?.user?.email}</p>
                </div>

                <Link
                  href="/dashboard/profile"
                  onClick={() => setDropdownOpen(false)}
                  className="flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <User className="w-4 h-4" /> Profile
                </Link>
                <Link
                  href="/dashboard/settings"
                  onClick={() => setDropdownOpen(false)}
                  className="flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Settings className="w-4 h-4" /> Settings
                </Link>

                <div className="border-t border-border mt-1 pt-1">
                  <button
                    onClick={handleLogout}
                    className="flex items-center gap-2 w-full px-4 py-2 text-sm text-red-600 hover:bg-red-500/10"
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
