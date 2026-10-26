"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { Check, CheckCircle2, ChevronRight, Loader2, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { toast } from "sonner";
import { ticketApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { fullTime, priorityTone, timeAgo } from "@/lib/support";
import { StatusBadge } from "@/components/support/StatusBadge";
import { Thread, type ThreadMessage } from "@/components/support/Thread";
import { Composer } from "@/components/support/Composer";

const STEPS = [
  { id: "open", label: "Submitted" },
  { id: "in_progress", label: "In progress" },
  { id: "resolved", label: "Resolved" },
];

function Stepper({ status }: { status: string }) {
  const at = status === "closed" ? 2 : Math.max(0, STEPS.findIndex((s) => s.id === status));
  return (
    <ol className="flex items-center gap-2">
      {STEPS.map((s, i) => (
        <li key={s.id} className="flex flex-1 items-center gap-2">
          <span className={cn("grid h-6 w-6 flex-shrink-0 place-items-center rounded-full text-[11px] font-semibold",
            i < at || (i === at && i === 2) ? "bg-green-500 text-white" : i === at ? "bg-brand-500 text-white" : "bg-elevated text-subtle")}>
            {i < at || (i === at && i === 2) ? <Check className="h-3.5 w-3.5" /> : i + 1}
          </span>
          <span className={cn("whitespace-nowrap text-xs font-medium", i <= at ? "text-foreground" : "text-subtle")}>{s.label}</span>
          {i < STEPS.length - 1 && <span className={cn("h-px flex-1", i < at ? "bg-green-500" : "bg-border")} />}
        </li>
      ))}
    </ol>
  );
}

const NEXT: Record<string, string> = {
  open: "Your request is in our queue. A member of the team will reply here and by email. You can answer from either.",
  in_progress: "Someone from our team is working on this. Reply any time to add detail.",
  resolved: "We think this is fixed. Reply if it isn't, and the request reopens.",
  closed: "This request is closed. Reply to reopen it.",
};

function TicketView() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: session } = useSession();
  const selfEmail = (session as any)?.user?.email as string | undefined;
  const [showCreated, setShowCreated] = useState(params.get("created") === "1");
  const [sending, setSending] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [comment, setComment] = useState("");

  useEffect(() => {
    if (params.get("created") === "1") router.replace(`/dashboard/support/${id}`, { scroll: false });
  }, [id, params, router]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["ticket", id],
    queryFn: async () => {
      const res = await ticketApi.get(id);
      // Opening the thread marks it read; refresh the header badge.
      qc.invalidateQueries({ queryKey: ["tickets-unread"] });
      return res;
    },
    refetchInterval: 30_000,
  });
  const t = data?.data?.ticket;
  const messages: ThreadMessage[] = data?.data?.messages ?? [];
  const done = t?.status === "resolved" || t?.status === "closed";

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["ticket", id] });
    qc.invalidateQueries({ queryKey: ["tickets"] });
  };

  const reply = async (body: string, files: File[]) => {
    setSending(true);
    const form = new FormData();
    form.append("body", body);
    files.forEach((f) => form.append("files", f));
    try {
      await ticketApi.reply(id, form);
      refresh();
      toast.success(done ? "Reply sent. The request is open again." : "Reply sent");
      return true;
    } catch (e: any) {
      toast.error(e.response?.data?.error ?? "Could not send your reply");
      return false;
    } finally {
      setSending(false);
    }
  };

  const resolve = useMutation({
    mutationFn: () => ticketApi.resolve(id),
    onSuccess: () => { toast.success("Marked as resolved"); refresh(); },
  });
  const feedback = useMutation({
    mutationFn: ({ rating }: { rating: 1 | -1 }) => ticketApi.feedback(id, rating, comment),
    onSuccess: (_, v) => {
      refresh();
      setFeedbackOpen(false);
      toast.success(v.rating === 1 ? "Thanks for letting us know" : "Sorry about that. Reply below and we'll pick it up.");
    },
  });

  if (isLoading) {
    return <div className="mx-auto max-w-6xl space-y-4">{[80, 120, 240].map((h, i) => <div key={i} style={{ height: h }} className="animate-pulse rounded-xl bg-card" />)}</div>;
  }
  if (isError || !t) {
    return (
      <div className="mx-auto max-w-lg py-20 text-center">
        <p className="text-lg font-semibold text-foreground">Request not found</p>
        <p className="mt-1 text-sm text-muted-foreground">It may belong to another organization, or the link is wrong.</p>
        <Link href="/dashboard/support" className="mt-4 inline-block text-sm font-medium text-brand-500 hover:underline">Back to Support</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link href="/dashboard/support" className="hover:text-foreground">Support</Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="font-mono text-foreground">{t.ref}</span>
      </nav>

      {showCreated && (
        <div role="status" className="mb-5 flex items-start justify-between gap-3 rounded-xl border border-green-500/30 bg-green-500/5 p-4">
          <div className="flex gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-500" />
            <div>
              <p className="text-sm font-semibold text-foreground">Request {t.ref} sent</p>
              <p className="mt-0.5 text-sm text-muted-foreground">We've emailed you a copy. You'll hear from us here and by email.</p>
            </div>
          </div>
          <button aria-label="Dismiss" onClick={() => setShowCreated(false)} className="text-subtle hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
      )}

      <header className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-[1.5rem] font-normal leading-[1.15] tracking-[-0.03em] text-foreground">{t.subject}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="font-mono">{t.ref}</span> · {t.category_name}
              {" · "}<span className={cn("capitalize", priorityTone(t.priority))}>{t.priority} priority</span>
              {" · "}Opened {timeAgo(t.created_at)} by {t.created_by}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={t.status} />
            {!done && (
              <button onClick={() => resolve.mutate()} disabled={resolve.isPending}
                className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 font-mono text-[12px] font-medium uppercase tracking-[0.06em] text-body hover:bg-elevated disabled:opacity-60">
                {resolve.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Mark as resolved
              </button>
            )}
          </div>
        </div>
        <div className="mt-5 max-w-xl"><Stepper status={t.status} /></div>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_280px]">
        <div className="min-w-0 space-y-5">
          <Thread messages={messages} selfEmail={selfEmail}
            openAttachment={async (aid) => (await ticketApi.attachment(id, aid)).data.url} />

          {done && t.rating == null && (
            <div className="rounded-xl border border-brand-500/25 bg-brand-500/5 p-5">
              <p className="text-sm font-semibold text-foreground">Did this solve your problem?</p>
              {!feedbackOpen ? (
                <div className="mt-3 flex gap-2">
                  <button onClick={() => feedback.mutate({ rating: 1 })} disabled={feedback.isPending}
                    className="flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 font-mono text-[12px] font-medium uppercase tracking-[0.06em] text-white hover:bg-brand-600">
                    <ThumbsUp className="h-4 w-4" /> Yes, it's fixed
                  </button>
                  <button onClick={() => setFeedbackOpen(true)}
                    className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 font-mono text-[12px] font-medium uppercase tracking-[0.06em] text-body hover:bg-elevated">
                    <ThumbsDown className="h-4 w-4" /> Not yet
                  </button>
                </div>
              ) : (
                <div className="mt-3">
                  <label htmlFor="fb" className="text-xs text-muted-foreground">What's still not working? (optional, only our team sees this)</label>
                  <textarea id="fb" value={comment} onChange={(e) => setComment(e.target.value)} rows={2}
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
                  <button onClick={() => feedback.mutate({ rating: -1 })} disabled={feedback.isPending}
                    className="mt-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-body hover:bg-elevated">Send feedback</button>
                  <p className="mt-2 text-xs text-subtle">To get more help, reply below. Replying reopens the request.</p>
                </div>
              )}
            </div>
          )}
          {done && t.rating != null && (
            <p className="text-center text-xs text-subtle">
              {t.rating === 1 ? "You told us this solved it. Thank you." : "You told us this isn't solved yet. Reply below to reopen it."}
            </p>
          )}

          <Composer onSend={reply} sending={sending}
            placeholder={done ? "Still need help? Reply to reopen this request…" : "Write a reply…"}
            note={done ? "Replying reopens this request" : "We'll email the team your reply"} />
        </div>

        <aside className="h-fit space-y-4 lg:sticky lg:top-4">
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-foreground">Details</h3>
            <dl className="mt-3 space-y-2.5 text-sm">
              {[
                ["Reference", <span key="r" className="font-mono">{t.ref}</span>],
                ["Status", <StatusBadge key="s" status={t.status} />],
                ["Priority", <span key="p" className={cn("capitalize", priorityTone(t.priority))}>{t.priority}</span>],
                ["Topic", t.category_name],
                ["Opened by", t.created_by],
                ["Opened", fullTime(t.created_at)],
                ["Last update", timeAgo(t.last_message_at ?? t.updated_at)],
              ].map(([k, v]) => (
                <div key={k as string} className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="truncate text-right text-foreground">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-foreground">What happens next</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{NEXT[t.status] ?? NEXT.open}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

export default function TicketPage() {
  return (
    <Suspense fallback={<div className="mx-auto h-96 max-w-6xl animate-pulse rounded-xl bg-card" />}>
      <TicketView />
    </Suspense>
  );
}
