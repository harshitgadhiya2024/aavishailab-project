"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { superAdminTicketApi } from "@/lib/api";
import { LifeBuoy, X, MessageSquare } from "lucide-react";
import { formatDateTime, cn } from "@/lib/utils";
import { Pagination } from "@/components/ui/Pagination";

const STATUS_STYLE: Record<string, string> = {
  open: "bg-brand-500/10 text-brand-500",
  in_progress: "bg-yellow-500/10 text-yellow-400",
  resolved: "bg-green-500/10 text-green-400",
  closed: "bg-muted text-muted-foreground",
};

export default function TicketsPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [status, setStatus] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [reply, setReply] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["sa-tickets", page, limit, status],
    queryFn: () => superAdminTicketApi.list({ page, limit, status: status || undefined }),
  });
  const { data: detail } = useQuery({
    queryKey: ["sa-ticket", openId],
    queryFn: () => superAdminTicketApi.get(openId as string),
    enabled: !!openId,
  });

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => superAdminTicketApi.updateStatus(id, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sa-tickets"] });
      qc.invalidateQueries({ queryKey: ["sa-ticket", openId] });
    },
  });

  const replyMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => superAdminTicketApi.addMessage(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sa-ticket", openId] });
      qc.invalidateQueries({ queryKey: ["sa-tickets"] });
      setReply("");
    },
  });

  const tickets = data?.data?.tickets ?? [];
  const total = data?.data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);
  const d = detail?.data;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Support Tickets</h2>
        <p className="text-sm text-muted-foreground mt-1">Every ticket raised across all organizations</p>
      </div>

      <div className="bg-card rounded-xl border border-border shadow-sm">
        <div className="p-4 border-b border-border">
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            className="border border-border bg-background rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="">All statuses</option>
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground text-xs uppercase tracking-wide">
                <th className="text-left px-5 py-3 font-medium">Subject</th>
                <th className="text-left px-5 py-3 font-medium">Organization</th>
                <th className="text-left px-5 py-3 font-medium">Priority</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
                <th className="text-left px-5 py-3 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                [...Array(5)].map((_, i) => <tr key={i} className="animate-pulse"><td colSpan={5} className="px-5 py-4"><div className="h-4 bg-muted rounded w-3/4" /></td></tr>)
              ) : tickets.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-12 text-[#6B6B6B]"><LifeBuoy className="w-8 h-8 mx-auto mb-2 opacity-30" />No tickets yet</td></tr>
              ) : tickets.map((t: any) => (
                <tr key={t.id} onClick={() => setOpenId(t.id)} className="hover:bg-muted transition-colors cursor-pointer">
                  <td className="px-5 py-3 text-foreground">{t.subject}</td>
                  <td className="px-5 py-3 text-muted-foreground">{t.org_name || "Platform"}</td>
                  <td className="px-5 py-3 text-muted-foreground capitalize">{t.priority}</td>
                  <td className="px-5 py-3">
                    <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium capitalize", STATUS_STYLE[t.status])}>{t.status?.replace("_", " ")}</span>
                  </td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{formatDateTime(t.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination page={page} totalPages={totalPages} total={total} limit={limit} onPageChange={setPage} onLimitChange={(n) => { setLimit(n); setPage(1); }} />
      </div>

      {openId && d && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setOpenId(null)}>
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div>
                <h3 className="font-semibold text-foreground">{d.subject}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">{d.org_name || "Platform ticket"}</p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={d.status}
                  onChange={(e) => statusMut.mutate({ id: d.id, status: e.target.value })}
                  className="text-xs border border-border bg-background rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="open">Open</option>
                  <option value="in_progress">In Progress</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed</option>
                </select>
                <button onClick={() => setOpenId(null)} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
              </div>
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
              <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply…"
                className="flex-1 border border-border bg-background rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
              <button type="submit" disabled={replyMut.isPending} className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60">
                Send
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
