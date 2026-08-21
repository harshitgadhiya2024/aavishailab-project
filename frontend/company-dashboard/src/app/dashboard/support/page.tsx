"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ticketApi } from "@/lib/api";
import { LifeBuoy, Plus, X, Loader2, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<string, string> = {
  open: "bg-brand-500/10 text-brand-500",
  in_progress: "bg-yellow-500/10 text-yellow-400",
  resolved: "bg-green-500/10 text-green-400",
  closed: "bg-muted text-muted-foreground",
};

function formatDateTime(d: string) {
  return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function SupportPage() {
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [openTicketId, setOpenTicketId] = useState<string | null>(null);
  const [form, setForm] = useState({ subject: "", body: "", priority: "normal" });
  const [reply, setReply] = useState("");

  const { data, isLoading } = useQuery({ queryKey: ["tickets"], queryFn: ticketApi.list });
  const { data: detail } = useQuery({
    queryKey: ["ticket", openTicketId],
    queryFn: () => ticketApi.get(openTicketId as string),
    enabled: !!openTicketId,
  });

  const createMut = useMutation({
    mutationFn: ticketApi.create,
    onSuccess: () => {
      toast.success("Ticket created");
      qc.invalidateQueries({ queryKey: ["tickets"] });
      setShowNew(false);
      setForm({ subject: "", body: "", priority: "normal" });
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Failed to create ticket"),
  });

  const replyMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => ticketApi.addMessage(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ticket", openTicketId] });
      qc.invalidateQueries({ queryKey: ["tickets"] });
      setReply("");
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Failed to send"),
  });

  const tickets = data?.data?.tickets ?? [];
  const d = detail?.data;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Support</h2>
          <p className="text-sm text-muted-foreground mt-1">Raise an issue or follow up on an existing one</p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="flex items-center gap-2 bg-primary hover:bg-brand-600 text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Ticket
        </button>
      </div>

      <div className="bg-card rounded-xl border border-border shadow-sm divide-y divide-border">
        {isLoading ? (
          [...Array(3)].map((_, i) => <div key={i} className="h-16 animate-pulse bg-muted/40" />)
        ) : tickets.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <LifeBuoy className="w-8 h-8 mx-auto mb-2 opacity-30" />
            No tickets yet
          </div>
        ) : tickets.map((t: any) => (
          <button
            key={t.id}
            onClick={() => setOpenTicketId(t.id)}
            className="w-full text-left px-5 py-4 hover:bg-muted transition-colors flex items-center justify-between gap-4"
          >
            <div className="min-w-0">
              <p className="font-medium text-foreground truncate">{t.subject}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t.message_count} message{t.message_count === 1 ? "" : "s"} · updated {formatDateTime(t.updated_at)}
              </p>
            </div>
            <span className={cn("flex-shrink-0 text-xs font-medium px-2.5 py-1 rounded-full capitalize", STATUS_STYLE[t.status] ?? "bg-muted text-muted-foreground")}>
              {t.status?.replace("_", " ")}
            </span>
          </button>
        ))}
      </div>

      {/* New ticket modal */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setShowNew(false)}>
          <div className="bg-card rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="font-semibold text-foreground">New Support Ticket</h3>
              <button onClick={() => setShowNew(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form
              onSubmit={(e) => { e.preventDefault(); createMut.mutate(form); }}
              className="px-6 py-5 space-y-4"
            >
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Subject *</label>
                <input
                  value={form.subject}
                  onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                  className="w-full border border-border bg-background rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Describe the issue *</label>
                <textarea
                  value={form.body}
                  onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                  rows={4}
                  className="w-full border border-border bg-background rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Priority</label>
                <select
                  value={form.priority}
                  onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
                  className="w-full border border-border bg-background rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
              <button
                type="submit"
                disabled={createMut.isPending}
                className="w-full bg-primary text-primary-foreground py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {createMut.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Submit
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Thread modal */}
      {openTicketId && d && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setOpenTicketId(null)}>
          <div className="bg-card rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div>
                <h3 className="font-semibold text-foreground">{d.subject}</h3>
                <span className={cn("inline-block mt-1 text-xs font-medium px-2 py-0.5 rounded-full capitalize", STATUS_STYLE[d.status])}>
                  {d.status?.replace("_", " ")}
                </span>
              </div>
              <button onClick={() => setOpenTicketId(null)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4 max-h-96 overflow-y-auto">
              {d.messages?.map((m: any) => (
                <div key={m.id} className="flex gap-3">
                  <MessageSquare className="w-4 h-4 text-muted-foreground mt-1 flex-shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">{m.author_email} · {formatDateTime(m.created_at)}</p>
                    <p className="text-sm text-foreground mt-0.5 whitespace-pre-wrap">{m.body}</p>
                  </div>
                </div>
              ))}
            </div>
            <form
              onSubmit={(e) => { e.preventDefault(); if (reply.trim()) replyMut.mutate({ id: d.id, body: reply }); }}
              className="px-6 py-4 border-t border-border flex gap-2"
            >
              <input
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder="Reply…"
                className="flex-1 border border-border bg-background rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              <button
                type="submit"
                disabled={replyMut.isPending}
                className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60"
              >
                Send
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
