"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { LifeBuoy } from "lucide-react";
import { ticketApi } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Header entry to Support, with a badge when the team has replied. */
export function SupportButton() {
  const pathname = usePathname();
  const { data } = useQuery({
    queryKey: ["tickets-unread"],
    queryFn: ticketApi.unread,
    refetchInterval: 60_000,
  });
  const unread: number = data?.data?.unread ?? 0;
  const active = pathname.startsWith("/dashboard/support");

  return (
    <Link
      href="/dashboard/support"
      aria-label={unread ? `Support, ${unread} new ${unread === 1 ? "reply" : "replies"}` : "Support"}
      className={cn(
        "relative flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        active ? "bg-brand-500/10 text-brand-500" : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      <LifeBuoy className="w-4 h-4" />
      <span className="hidden lg:inline">Support</span>
      {unread > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-brand-500 text-[10px] font-semibold text-white grid place-items-center">
          {unread}
        </span>
      )}
    </Link>
  );
}
