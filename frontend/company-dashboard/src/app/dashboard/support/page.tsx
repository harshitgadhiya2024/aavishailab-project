"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { ArrowRight, Inbox, Plus, MessageSquareText, Clock3, ShieldAlert } from "lucide-react";
import { ticketApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { TOPICS, timeAgo, priorityTone } from "@/lib/support";
import { StatusBadge } from "@/components/support/StatusBadge";

const VIEWS = [
  { id: "open", label: "Open" },
  { id: "waiting", label: "Awaiting your reply" },
  { id: "resolved", label: "Resolved" },
  { id: "all", label: "All" },
] as const;

const EMPTY: Record<string, string> = {
  open: "No open requests. If something isn't working, we're here to help.",
  waiting: "Nothing is waiting on you.",
  resolved: "No resolved requests yet.",
  all: "You haven't contacted support yet.",
};

export default function SupportCenterPage() {
  const { data: session } = useSession();
  const first = ((session as any)?.user?.first_name as string) || "";
  const [view, setView] = useState<string>("open");

  const { data, isLoading } = useQuery({
    queryKey: ["tickets", view],
    queryFn: () => ticketApi.list(view),
    refetchInterval: 60_000,
  });
  const tickets: any[] = data?.data?.tickets ?? [];
  const counts: Record<string, number> = data?.data?.counts ?? {};

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl border border-border bg-card px-6 py-8 shadow-sm md:px-10 md:py-10">
        <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-brand-500/15 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-24 right-40 h-56 w-56 rounded-full border border-brand-500/20" />
        <div className="relative flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="max-w-xl">
            <p className="text-sm font-medium text-brand-500">Delsecure Support</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-foreground">
              {first ? `Hi ${first}, how can we help?` : "How can we help?"}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Tell us what's going on and a real person from our team will reply, usually within one business day.
              You'll get every reply by email and here.
            </p>
          </div>
          <Link href="/dashboard/support/new"
            className="inline-flex items-center gap-2 self-start rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-600 md:self-auto">
            <Plus className="h-4 w-4" /> New request
          </Link>
        </div>
      </section>

      {/* Topics */}
      <section>
        <h3 className="mb-3 text-sm font-semibold text-foreground">What do you need help with?</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TOPICS.map((t) => (
            <Link key={t.id} href={`/dashboard/support/new?topic=${t.id}`}
              className="group flex items-start gap-3 rounded-xl border border-border bg-card p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-500/40 hover:shadow-md">
              <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-lg bg-brand-500/10 text-brand-500">
                <t.icon className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1 text-sm font-semibold text-foreground">
                  {t.label}
                  <ArrowRight className="h-3.5 w-3.5 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{t.hint}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        {/* Requests */}
        <section className="rounded-xl border border-border bg-card shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 pt-4">
            <h3 className="pb-3 text-sm font-semibold text-foreground">Your requests</h3>
            <div role="tablist" className="-mb-px flex gap-1 overflow-x-auto">
              {VIEWS.map((v) => (
                <button key={v.id} role="tab" aria-selected={view === v.id} onClick={() => setView(v.id)}
                  className={cn("whitespace-nowrap border-b-2 px-3 pb-3 text-sm transition-colors",
                    view === v.id ? "border-brand-500 font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
                  {v.label}
                  {(counts[v.id] ?? 0) > 0 && (
                    <span className={cn("ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                      v.id === "waiting" ? "bg-brand-500 text-white" : "bg-elevated text-muted-foreground")}>{counts[v.id]}</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {isLoading ? (
            <div className="divide-y divide-border">
              {[0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse bg-muted/30" />)}
            </div>
          ) : tickets.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-14 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-elevated text-subtle"><Inbox className="h-6 w-6" /></span>
              <p className="mt-3 text-sm text-muted-foreground">{EMPTY[view]}</p>
              {view !== "resolved" && (
                <Link href="/dashboard/support/new" className="mt-4 text-sm font-medium text-brand-500 hover:underline">Create a request</Link>
              )}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {tickets.map((t) => (
                <li key={t.id}>
                  <Link href={`/dashboard/support/${t.id}`} className="flex gap-3 px-5 py-4 transition-colors hover:bg-elevated">
                    <span className={cn("mt-2 h-2 w-2 flex-shrink-0 rounded-full", t.unread ? "bg-brand-500" : "bg-transparent")} aria-label={t.unread ? "New reply" : undefined} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <p className={cn("truncate text-sm text-foreground", t.unread ? "font-semibold" : "font-medium")}>{t.subject}</p>
                        <StatusBadge status={t.status} className="flex-shrink-0" />
                      </div>
                      <p className="mt-0.5 text-xs text-subtle">
                        <span className="font-mono">{t.ref}</span> · {t.category_name}
                        {t.priority !== "normal" && <span className={cn("capitalize", priorityTone(t.priority))}> · {t.priority}</span>}
                        {" · "}Updated {timeAgo(t.last_message_at ?? t.created_at)}
                      </p>
                      {t.preview && (
                        <p className="mt-1.5 line-clamp-1 text-sm text-muted-foreground">
                          {t.last_message_side === "support" && <span className="font-medium text-brand-500">Delsecure Support: </span>}
                          {t.preview}
                        </p>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Guidance */}
        <aside className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-foreground">How it works</h3>
            <ol className="mt-3 space-y-3 text-sm text-muted-foreground">
              <li className="flex gap-3"><MessageSquareText className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-500" />Describe the problem and attach screenshots if you can.</li>
              <li className="flex gap-3"><Clock3 className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-500" />We reply here and by email, usually within one business day.</li>
              <li className="flex gap-3"><Inbox className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-500" />Reply here or simply reply to our email. We'll close it once it's fixed.</li>
            </ol>
          </div>
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground"><ShieldAlert className="h-4 w-4 text-danger" /> Something urgent?</h3>
            <p className="mt-2 text-sm text-muted-foreground">If protection is down or sensitive data may be exposed, choose <b className="text-foreground">Urgent</b> priority. Urgent requests go to the top of our queue.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
