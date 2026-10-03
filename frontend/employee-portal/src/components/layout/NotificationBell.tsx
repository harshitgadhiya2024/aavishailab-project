"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import {
  AlertTriangle, Bell, CheckCheck, CheckCircle2, KeyRound, Laptop, MonitorX, Shield, ShieldAlert, Undo2, Wifi, XCircle,
} from "lucide-react";
import { portalApi } from "@/lib/api";
import { cn } from "@/lib/utils";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:6000";

type Item = {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string;
  created_at: string;
  read: boolean;
};

const KINDS: Record<string, { icon: React.ElementType; tone: string }> = {
  access_approved: { icon: CheckCircle2, tone: "bg-green-500/10 text-success" },
  access_denied: { icon: XCircle, tone: "bg-red-500/10 text-danger" },
  access_revoked: { icon: Undo2, tone: "bg-yellow-500/10 text-warning" },
  device_enrolled: { icon: Laptop, tone: "bg-brand-500/10 text-brand-500" },
  device_revoked: { icon: MonitorX, tone: "bg-red-500/10 text-danger" },
  password_changed: { icon: KeyRound, tone: "bg-brand-500/10 text-brand-500" },
  blocked: { icon: Shield, tone: "bg-red-500/10 text-danger" },
  alerted: { icon: AlertTriangle, tone: "bg-yellow-500/10 text-warning" },
};

function timeAgo(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function NotificationBell() {
  const { data: session } = useSession();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["portal-notifications"],
    queryFn: () => portalApi.notifications().then((r) => r.data),
    // The socket makes this near-instant; polling is the fallback.
    refetchInterval: connected ? 120_000 : 30_000,
    refetchOnWindowFocus: true,
  });
  const items: Item[] = data?.items ?? [];
  const unread: number = data?.unread ?? 0;

  // Live: a new notification or a new block/alert of this employee's
  // refreshes the list. The server only sends this connection its own.
  const token = (session as any)?.accessToken as string | undefined;
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      if (cancelled) return;
      const ws = new WebSocket(`${WS_URL}/ws?token=${token}`);
      wsRef.current = ws;
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!cancelled) retry = setTimeout(connect, 5000);
      };
      ws.onerror = () => ws.close();
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          const isIncident = msg.type === "activity_event" && (msg.payload?.action === "blocked" || msg.payload?.action === "alerted");
          if (msg.type === "notification" || isIncident) {
            qc.invalidateQueries({ queryKey: ["portal-notifications"] });
          }
        } catch {
          /* ignore malformed frames */
        }
      };
    };
    connect();
    return () => { cancelled = true; clearTimeout(retry); wsRef.current?.close(); };
  }, [token, qc]);

  const markAll = useMutation({
    mutationFn: () => portalApi.markNotificationsRead(),
    onMutate: () => {
      qc.setQueryData(["portal-notifications"], (old: any) =>
        old ? { ...old, unread: 0, items: old.items.map((i: Item) => ({ ...i, read: true })) } : old);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["portal-notifications"] }),
  });
  const markOne = useMutation({
    mutationFn: (id: string) => portalApi.markNotificationRead(id),
    onSettled: () => qc.invalidateQueries({ queryKey: ["portal-notifications"] }),
  });

  const openItem = (n: Item) => {
    setOpen(false);
    // Stored notifications have uuid ids; activity items ("ev-…") are read
    // by the "seen" mark instead.
    if (!n.read && !n.id.startsWith("ev-")) markOne.mutate(n.id);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
        aria-expanded={open}
        className="relative rounded-lg p-2 transition-colors hover:bg-muted"
      >
        <Bell className="h-5 w-5 text-muted-foreground" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="fixed left-2 right-2 top-16 z-50 flex max-h-[70vh] flex-col rounded-xl border border-border bg-card shadow-lg sm:absolute sm:left-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-[380px]">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-foreground">Notifications</p>
                {connected && (
                  <span title="Live updates connected" className="flex items-center gap-1 text-[10px] text-success">
                    <Wifi className="h-3 w-3" /> live
                  </span>
                )}
              </div>
              {unread > 0 && (
                <button
                  onClick={() => markAll.mutate()}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <CheckCheck className="h-3.5 w-3.5" /> Mark all read
                </button>
              )}
            </div>

            <div className="flex-1 divide-y divide-border overflow-y-auto">
              {isLoading ? (
                <div className="space-y-3 p-4">{[0, 1, 2].map((i) => <div key={i} className="h-10 animate-pulse rounded bg-muted" />)}</div>
              ) : isError ? (
                <div className="py-10 text-center text-sm text-muted-foreground">Couldn&apos;t load notifications. Try again shortly.</div>
              ) : items.length === 0 ? (
                <div className="py-10 text-center text-sm text-subtle">
                  <ShieldAlert className="mx-auto mb-2 h-7 w-7 opacity-30" />
                  You&apos;re all caught up
                </div>
              ) : (
                items.map((n) => {
                  const k = KINDS[n.kind] ?? { icon: Bell, tone: "bg-muted text-muted-foreground" };
                  return (
                    <Link
                      key={n.id}
                      href={n.link || "/dashboard"}
                      onClick={() => openItem(n)}
                      className={cn("flex gap-3 px-4 py-3 transition-colors hover:bg-muted", !n.read && "bg-brand-500/5")}
                    >
                      <div className={cn("flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg", k.tone)}>
                        <k.icon className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className={cn("truncate text-sm text-foreground", !n.read && "font-medium")}>{n.title}</p>
                        {n.body && <p className="line-clamp-2 text-xs text-muted-foreground">{n.body}</p>}
                        <p className="mt-0.5 text-[11px] text-subtle">{timeAgo(n.created_at)}</p>
                      </div>
                      {!n.read && <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-brand-500" aria-label="Unread" />}
                    </Link>
                  );
                })
              )}
            </div>

            {data && data.activity_ok === false && (
              <p className="border-t border-border px-4 py-2 text-[11px] text-warning">
                Your company&apos;s activity store can&apos;t be reached, so recent blocks may be missing.
              </p>
            )}
            <div className="flex items-center justify-between border-t border-border px-4 py-2.5">
              <Link href="/dashboard/activity" onClick={() => setOpen(false)} className="text-xs text-brand-500 hover:text-brand-400">
                View my activity
              </Link>
              <Link href="/dashboard/devices" onClick={() => setOpen(false)} className="text-xs text-muted-foreground hover:text-foreground">
                My devices
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
