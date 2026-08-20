"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { Bell, Shield, AlertTriangle, Inbox, CheckCheck, Wifi } from "lucide-react";
import { activityApi, accessRequestApi } from "@/lib/api";
import { cn } from "@/lib/utils";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:6000";
const SEEN_KEY = "aavishield-notifications-seen";

type Notification = {
  id: string;
  kind: "blocked" | "alerted" | "access_request";
  title: string;
  detail: string;
  at: string;
  href: string;
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function employeeName(emp: any) {
  if (!emp) return "Someone";
  return `${emp.first_name ?? ""} ${emp.last_name ?? ""}`.trim() || emp.email || "Someone";
}

const KIND_STYLES: Record<Notification["kind"], { icon: React.ElementType; tone: string }> = {
  blocked: { icon: Shield, tone: "bg-red-500/10 text-danger" },
  alerted: { icon: AlertTriangle, tone: "bg-yellow-500/10 text-warning" },
  access_request: { icon: Inbox, tone: "bg-brand-500/10 text-brand-500" },
};

export function NotificationBell() {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const [live, setLive] = useState<Notification[]>([]);
  const [connected, setConnected] = useState(false);
  // Read once on mount rather than on every render: localStorage isn't
  // available during SSR, and reading it in render would desync hydration.
  const [lastSeen, setLastSeen] = useState<number>(0);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const stored = Number(localStorage.getItem(SEEN_KEY) ?? 0);
    setLastSeen(stored);
  }, []);

  const { data: incidentsData } = useQuery({
    queryKey: ["notif-incidents"],
    queryFn: () => activityApi.list({ action: "blocked,alerted", days: 7, limit: 15 }),
    refetchInterval: 60_000,
  });

  const { data: requestsData } = useQuery({
    queryKey: ["notif-requests"],
    queryFn: () => accessRequestApi.list({ status: "pending", limit: 20 }),
    refetchInterval: 60_000,
  });

  // Live feed, so a block that happens while the dashboard is open shows up
  // without waiting for the next poll.
  useEffect(() => {
    const token = (session as any)?.accessToken;
    if (!token) return;

    let cancelled = false;
    const connect = () => {
      if (cancelled) return;
      const ws = new WebSocket(`${WS_URL}/ws?token=${token}`);
      wsRef.current = ws;
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!cancelled) setTimeout(connect, 5000);
      };
      ws.onerror = () => ws.close();
      ws.onmessage = e => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type !== "activity_event") return;
          const ev = msg.payload;
          if (ev.action !== "blocked" && ev.action !== "alerted") return;
          setLive(prev => [toIncidentNotification(ev), ...prev].slice(0, 20));
        } catch {
          /* ignore malformed frames */
        }
      };
    };

    connect();
    return () => { cancelled = true; wsRef.current?.close(); };
  }, [(session as any)?.accessToken]);

  const notifications = useMemo(() => {
    const events = Array.isArray(incidentsData?.data?.data) ? incidentsData.data.data : [];
    const requests = Array.isArray(requestsData?.data?.data) ? requestsData.data.data : [];

    const fromEvents: Notification[] = events.map(toIncidentNotification);
    const fromRequests: Notification[] = requests.map((r: any) => ({
      id: `req-${r.id}`,
      kind: "access_request" as const,
      title: `${employeeName(r.employee)} requested access`,
      detail: r.domain + (r.reason ? ` — "${r.reason}"` : ""),
      at: r.created_at,
      href: "/dashboard/access-requests",
    }));

    // Live events can duplicate what the poll already returned.
    const merged = [...live, ...fromEvents, ...fromRequests];
    const seen = new Set<string>();
    return merged
      .filter(n => (seen.has(n.id) ? false : (seen.add(n.id), true)))
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 25);
  }, [incidentsData, requestsData, live]);

  const unread = notifications.filter(n => new Date(n.at).getTime() > lastSeen).length;

  const markAllRead = () => {
    const now = Date.now();
    localStorage.setItem(SEEN_KEY, String(now));
    setLastSeen(now);
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    // Opening the panel is what "seeing" them means — mark read on open, not
    // on close, so the badge clears immediately.
    if (next && unread > 0) markAllRead();
  };

  return (
    <div className="relative">
      <button
        onClick={toggle}
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
        className="relative p-2 rounded-lg hover:bg-muted transition-colors"
      >
        <Bell className="w-5 h-5 text-muted-foreground" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-semibold rounded-full flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-[360px] max-h-[70vh] bg-card rounded-xl shadow-lg border border-border z-50 flex flex-col">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-foreground">Notifications</p>
                {connected && (
                  <span title="Live updates connected" className="flex items-center gap-1 text-[10px] text-success">
                    <Wifi className="w-3 h-3" /> live
                  </span>
                )}
              </div>
              {notifications.length > 0 && (
                <button
                  onClick={markAllRead}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <CheckCheck className="w-3.5 h-3.5" /> Mark all read
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-elevated">
              {notifications.length === 0 ? (
                <div className="py-10 text-center text-subtle text-sm">
                  <Bell className="w-7 h-7 mx-auto mb-2 opacity-30" />
                  Nothing needs your attention
                </div>
              ) : (
                notifications.map(n => {
                  const style = KIND_STYLES[n.kind];
                  const isNew = new Date(n.at).getTime() > lastSeen;
                  return (
                    <Link
                      key={n.id}
                      href={n.href}
                      onClick={() => setOpen(false)}
                      className={cn("flex gap-3 px-4 py-3 hover:bg-elevated transition-colors", isNew && "bg-brand-500/5")}
                    >
                      <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0", style.tone)}>
                        <style.icon className="w-3.5 h-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-foreground truncate">{n.title}</p>
                        <p className="text-xs text-muted-foreground truncate">{n.detail}</p>
                        <p className="text-[11px] text-subtle mt-0.5">{timeAgo(n.at)}</p>
                      </div>
                    </Link>
                  );
                })
              )}
            </div>

            <div className="px-4 py-2.5 border-t border-border flex items-center justify-between">
              <Link href="/dashboard/activity" onClick={() => setOpen(false)}
                className="text-xs text-brand-500 hover:text-brand-400">
                View all activity
              </Link>
              <Link href="/dashboard/access-requests" onClick={() => setOpen(false)}
                className="text-xs text-muted-foreground hover:text-foreground">
                Access requests
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function toIncidentNotification(ev: any): Notification {
  const target = ev.target_app || ev.target_domain || ev.target || "an unknown destination";
  const what = ev.operation ? `${ev.operation} · ${target}` : target;
  return {
    id: ev.id,
    kind: ev.action === "blocked" ? "blocked" : "alerted",
    title: `${employeeName(ev.employee)} — ${ev.action === "blocked" ? "blocked" : "alerted"}`,
    detail: `${what}${ev.policy_name ? ` · ${ev.policy_name}` : ""}`,
    at: ev.timestamp || ev.created_at || new Date().toISOString(),
    href: "/dashboard/activity",
  };
}
