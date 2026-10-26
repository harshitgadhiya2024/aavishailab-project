"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Inbox, Search, LifeBuoy, ThumbsUp, ThumbsDown, Building2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { superAdminTicketApi, teamApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { STATUS, fullTime, priorityTone, timeAgo } from "@/lib/support";
import { StatusBadge } from "@/components/support/StatusBadge";
import { Thread, type ThreadMessage } from "@/components/support/Thread";
import { Composer, type SendOptions } from "@/components/support/Composer";

const VIEWS = [
  { id: "needs_reply", label: "Needs reply" },
  { id: "mine", label: "Assigned to me" },
  { id: "open", label: "Open" },
  { id: "resolved", label: "Resolved" },
  { id: "all", label: "All" },
];

const select = "rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500/30";

function TicketPane({ id, onChanged }: { id: string; onChanged: () => void }) {
  const qc = useQueryClient();
  const [sending, setSending] = useState(false);
  const { data: team } = useQuery({ queryKey: ["sa-team"], queryFn: teamApi.list, staleTime: 300_000 });
  const { data, isLoading } = useQuery({
    queryKey: ["sa-ticket", id],
    queryFn: async () => {
      const r = await superAdminTicketApi.get(id);
      onChanged(); // opening marks it read
      return r;
    },
    refetchInterval: 30_000,
  });
  const t = data?.data?.ticket;
  const messages: ThreadMessage[] = data?.data?.messages ?? [];
  const members: any[] = team?.data?.team ?? [];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["sa-ticket", id] });
    onChanged();
  };

  const update = async (patch: { status?: string; priority?: string; assigned_to_id?: string }) => {
    try {
      await superAdminTicketApi.update(id, patch);
      refresh();
    } catch (e: any) {
      toast.error(e.response?.data?.error ?? "Update failed");
    }
  };

  const send = async (body: string, files: File[], opts: SendOptions) => {
    setSending(true);
    const form = new FormData();
    form.append("body", body);
    if (opts.internal) form.append("internal", "true");
    if (opts.resolve) form.append("status", "resolved");
    files.forEach((f) => form.append("files", f));
    try {
      await superAdminTicketApi.reply(id, form);
      refresh();
      toast.success(opts.internal ? "Note added" : opts.resolve ? "Reply sent and request resolved" : "Reply sent to the customer");
      return true;
    } catch (e: any) {
      toast.error(e.response?.data?.error ?? "Could not send");
      return false;
    } finally {
      setSending(false);
    }
  };

  if (isLoading || !t) {
    return <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="flex flex-col">
      <header className="border-b border-border p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-foreground">{t.subject}</h3>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
              <span className="font-mono">{t.ref}</span>
              <span>·</span>
              <span className="flex items-center gap-1"><Building2 className="h-3.5 w-3.5" />{t.org_name || "Internal"}</span>
              <span>·</span>
              <span>{t.created_by} ({t.created_by_email})</span>
              <span>·</span>
              <span>{t.category_name}</span>
            </p>
          </div>
          <StatusBadge status={t.status} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">Status
            <select value={t.status} onChange={(e) => update({ status: e.target.value })} className={select}>
              {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">Priority
            <select value={t.priority} onChange={(e) => update({ priority: e.target.value })} className={select}>
              {["low", "normal", "high", "urgent"].map((p) => <option key={p} value={p} className="capitalize">{p[0].toUpperCase() + p.slice(1)}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">Assignee
            <select value={t.assigned_to_id ?? ""} onChange={(e) => update({ assigned_to_id: e.target.value })} className={select}>
              <option value="">Unassigned</option>
              {members.map((m) => <option key={m.id} value={m.id}>{`${m.first_name ?? ""} ${m.last_name ?? ""}`.trim() || m.email}</option>)}
            </select>
          </label>
          {t.rating != null && (
            <span className={cn("flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium",
              t.rating === 1 ? "bg-green-500/10 text-green-600 dark:text-green-700" : "bg-red-500/10 text-red-500")}
              title={t.rating_comment || undefined}>
              {t.rating === 1 ? <ThumbsUp className="h-3.5 w-3.5" /> : <ThumbsDown className="h-3.5 w-3.5" />}
              {t.rating === 1 ? "Customer says solved" : "Customer says not solved"}
              {t.rating_comment && `: "${t.rating_comment.slice(0, 60)}"`}
            </span>
          )}
        </div>
      </header>
      <div className="space-y-4 bg-muted/20 p-5">
        <Thread messages={messages} openAttachment={async (aid) => (await superAdminTicketApi.attachment(id, aid)).data.url} />
      </div>
      <div className="sticky bottom-0 border-t border-border bg-card p-4">
        <Composer onSend={send} sending={sending} customerName={t.created_by?.split(" ")[0] || "the customer"} />
        <p className="mt-2 text-[11px] text-muted-foreground">Opened {fullTime(t.created_at)}. Replies are emailed to everyone from {t.org_name || "the org"} on this request.</p>
      </div>
    </div>
  );
}

function Inbox_() {
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const [view, setView] = useState("needs_reply");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState("");
  const selected = params.get("id");

  useEffect(() => {
    const t = setTimeout(() => setSearch(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  // A link from an email lands on a ticket that may not be in the default view.
  useEffect(() => {
    if (params.get("id")) setView((v) => (v === "needs_reply" ? "all" : v));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["sa-tickets", view, search, priority],
    queryFn: () => superAdminTicketApi.list({ view, q: search || undefined, priority: priority || undefined }),
    refetchInterval: 30_000,
  });
  const tickets: any[] = data?.data?.tickets ?? [];
  const counts: Record<string, number> = data?.data?.counts ?? {};

  const open = (id: string) => router.replace(`/dashboard/tickets?id=${id}`, { scroll: false });
  const changed = () => qc.invalidateQueries({ queryKey: ["sa-tickets"] });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="page-eyebrow">Customers</p>
          <h2 className="mt-2 text-[2rem] font-normal leading-[1.1] tracking-[-0.035em] text-foreground">Support Tickets</h2>
          <p className="mt-1 text-sm text-muted-foreground">Every company's requests. Replies are emailed to the customer; internal notes are not.</p>
        </div>
      </div>

      <div className="grid items-start rounded-xl border border-border bg-card shadow-sm lg:grid-cols-[380px_1fr]">
        {/* List */}
        <div className={cn("flex flex-col border-border lg:sticky lg:top-0 lg:max-h-[calc(100vh-150px)] lg:border-r", selected && "hidden lg:flex")}>
          <div className="space-y-3 border-b border-border p-3">
            <div className="flex flex-wrap gap-1">
              {VIEWS.map((v) => (
                <button key={v.id} onClick={() => setView(v.id)}
                  className={cn("rounded-md px-2.5 py-1 text-xs font-medium", view === v.id ? "bg-brand-500/10 text-brand-500" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
                  {v.label}{counts[v.id] ? <span className="ml-1 opacity-70">{counts[v.id]}</span> : null}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Subject, company or DS-1234"
                  className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
              </div>
              <select value={priority} onChange={(e) => setPriority(e.target.value)} className={select} aria-label="Priority">
                <option value="">Any priority</option>
                <option value="urgent">Urgent</option>
                <option value="high">High</option>
                <option value="normal">Normal</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>
          <ul className="flex-1 divide-y divide-border overflow-y-auto">
            {isLoading ? (
              [0, 1, 2, 3].map((i) => <li key={i} className="h-20 animate-pulse bg-muted/30" />)
            ) : tickets.length === 0 ? (
              <li className="flex flex-col items-center px-6 py-16 text-center text-sm text-muted-foreground">
                <Inbox className="mb-2 h-8 w-8 opacity-30" /> Nothing here.
              </li>
            ) : (
              tickets.map((t) => (
                <li key={t.id}>
                  <button onClick={() => open(t.id)}
                    className={cn("flex w-full gap-2.5 px-4 py-3 text-left transition-colors hover:bg-muted/50", selected === t.id && "bg-brand-500/5")}>
                    <span className={cn("mt-1.5 h-2 w-2 flex-shrink-0 rounded-full", t.unread ? "bg-brand-500" : "bg-transparent")} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-medium text-muted-foreground">{t.org_name || "Internal"}</span>
                        <span className="flex-shrink-0 text-[11px] text-muted-foreground">{timeAgo(t.last_message_at ?? t.created_at)}</span>
                      </span>
                      <span className={cn("mt-0.5 block truncate text-sm text-foreground", t.unread && "font-semibold")}>{t.subject}</span>
                      <span className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="font-mono">{t.ref}</span>
                        <StatusBadge status={t.status} className="px-1.5 py-0 text-[10px]" />
                        {t.priority !== "normal" && <span className={cn("font-semibold uppercase", priorityTone(t.priority))}>{t.priority}</span>}
                        {t.assigned_to && <span className="truncate">· {t.assigned_to.split(" ")[0]}</span>}
                      </span>
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>

        {/* Conversation */}
        <div className={cn("min-w-0", !selected && "hidden lg:block")}>
          {selected ? (
            <div className="flex h-full flex-col">
              <button onClick={() => router.replace("/dashboard/tickets")} className="border-b border-border px-4 py-2 text-left text-sm text-brand-500 lg:hidden">Back to list</button>
              <TicketPane key={selected} id={selected} onChanged={changed} />
            </div>
          ) : (
            <div className="flex min-h-[420px] flex-col items-center justify-center text-center text-sm text-muted-foreground">
              <LifeBuoy className="mb-3 h-10 w-10 opacity-30" />
              Pick a request to read and reply.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function TicketsPage() {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-card" />}>
      <Inbox_ />
    </Suspense>
  );
}
