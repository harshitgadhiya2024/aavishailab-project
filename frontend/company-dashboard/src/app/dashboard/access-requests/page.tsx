"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AppWindow, Check, Download, FileWarning, Globe, Inbox, Loader2, Puzzle, RotateCcw, Search, X, XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Pagination } from "@/components/ui/Pagination";
import { accessRequestApi } from "@/lib/api";
import { cn, formatDateTime } from "@/lib/utils";

type Kind = "website" | "application" | "browser_extension" | "download" | "dlp";
type Status = "pending" | "approved" | "denied" | "revoked";

type AccessRequest = {
  id: string;
  kind: Kind;
  label?: string;
  resource?: string;
  domain?: string;
  reason?: string;
  status: Status;
  created_at?: string;
  reviewed_at?: string;
  review_note?: string;
  employee?: { first_name?: string; last_name?: string; email?: string };
};

// What approving each kind does, so the admin decides knowing the effect.
const KIND: Record<Kind, { noun: string; icon: React.ElementType; approveEffect: string; approveLabel: string }> = {
  website: { noun: "Website", icon: Globe, approveLabel: "Approve",
    approveEffect: "This site opens for this employee only, on all their devices, within about a minute. Everyone else stays blocked." },
  application: { noun: "Application", icon: AppWindow, approveLabel: "Approve",
    approveEffect: "This app stops being blocked for this employee, including its network access. Everyone else stays blocked." },
  browser_extension: { noun: "Extension", icon: Puzzle, approveLabel: "Approve",
    approveEffect: "This extension is no longer flagged for this employee." },
  download: { noun: "Download", icon: Download, approveLabel: "Release file",
    approveEffect: "This exact file (matched by its SHA-256 fingerprint) is let through for this employee. Make sure it is safe: it was flagged as malware." },
  dlp: { noun: "Data sharing", icon: FileWarning, approveLabel: "Mark justified",
    approveEffect: "Nothing was blocked (DLP is monitor-only). Approving records this transfer as a legitimate business need." },
};

const STATUS_TABS: { value: string; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "denied", label: "Denied" },
  { value: "revoked", label: "Revoked" },
  { value: "", label: "All" },
];

const STATUS_BADGE: Record<Status, string> = {
  pending: "bg-yellow-500/10 text-warning",
  approved: "bg-green-500/10 text-success",
  denied: "bg-red-500/10 text-danger",
  revoked: "bg-elevated text-muted-foreground",
};

type Decision = { request: AccessRequest; action: "approve" | "deny" | "revoke" };

function employeeName(r: AccessRequest) {
  const e = r.employee;
  if (!e) return "Unknown employee";
  return `${e.first_name || ""} ${e.last_name || ""}`.trim() || e.email || "Unknown employee";
}

export default function AccessRequestsPage() {
  const [status, setStatus] = useState("pending");
  const [kind, setKind] = useState("");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [decision, setDecision] = useState<Decision | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading } = useQuery({
    queryKey: ["access-requests", status, kind, debounced, page, limit],
    queryFn: () => accessRequestApi.list({
      status: status || undefined, kind: kind || undefined, search: debounced || undefined, page, limit,
    }),
    refetchInterval: 15_000,
  });

  const requests: AccessRequest[] = data?.data?.data || [];
  const total: number = data?.data?.total ?? 0;
  const counts: Record<string, number> = data?.data?.counts ?? {};
  const allCount = Object.values(counts).reduce((a, b) => a + b, 0);
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Access Requests</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Employees ask for an exception from the activity that stopped them. Approving opens exactly that one thing for that one person, and you can revoke it at any time.
        </p>
      </div>

      <div className="bg-card rounded-xl border border-border shadow-sm">
        <div className="border-b border-border overflow-x-auto">
          <div className="flex min-w-max">
            {STATUS_TABS.map(t => {
              const n = t.value ? counts[t.value] ?? 0 : allCount;
              return (
                <button key={t.value} onClick={() => { setStatus(t.value); setPage(1); }}
                  className={cn("px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors flex items-center gap-2",
                    status === t.value ? "border-brand-500 text-brand-500" : "border-transparent text-muted-foreground hover:text-foreground")}>
                  {t.label}
                  {n > 0 && (
                    <span className={cn("text-[11px] px-1.5 rounded-full",
                      t.value === "pending" ? "bg-yellow-500/15 text-warning" : "bg-elevated text-muted-foreground")}>{n}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="p-4 border-b border-border flex flex-col md:flex-row gap-3 md:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle" />
            <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search employee, site, app, file or reason"
              className="pl-9 pr-3 py-2 bg-background border border-border rounded-lg text-sm w-full text-foreground placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </div>
          <select value={kind} onChange={e => { setKind(e.target.value); setPage(1); }}
            className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground">
            <option value="">All types</option>
            {(Object.keys(KIND) as Kind[]).map(k => <option key={k} value={k}>{KIND[k].noun}</option>)}
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3 text-left font-medium">Requested</th>
                <th className="px-5 py-3 text-left font-medium">Employee</th>
                <th className="px-5 py-3 text-left font-medium">Reason</th>
                <th className="px-5 py-3 text-left font-medium">Status</th>
                <th className="px-5 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-elevated">
              {isLoading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {[...Array(5)].map((__, j) => <td key={j} className="px-5 py-4"><div className="h-4 bg-elevated rounded w-3/4" /></td>)}
                  </tr>
                ))
              ) : requests.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-14 text-center text-muted-foreground">
                    <Inbox className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    {status === "pending" ? "No requests waiting. You're all caught up." : "No access requests found."}
                  </td>
                </tr>
              ) : requests.map(r => {
                const k = KIND[r.kind] ?? KIND.website;
                return (
                  <tr key={r.id} className="hover:bg-elevated align-top">
                    <td className="px-5 py-4">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <span className="w-8 h-8 rounded-lg bg-elevated grid place-items-center shrink-0">
                          <k.icon className="w-4 h-4 text-muted-foreground" />
                        </span>
                        <div className="min-w-0">
                          <p className="font-medium text-foreground [overflow-wrap:anywhere] max-w-[280px]">{r.label || r.domain || r.resource}</p>
                          <p className="text-[11px] text-subtle">{k.noun} · {r.created_at ? formatDateTime(r.created_at) : ""}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <p className="text-body">{employeeName(r)}</p>
                      {r.employee?.email && <p className="text-[11px] text-subtle">{r.employee.email}</p>}
                    </td>
                    <td className="px-5 py-4 text-muted-foreground max-w-sm">
                      <p className="line-clamp-3" title={r.reason}>{r.reason || "No reason provided"}</p>
                      {r.review_note && <p className="text-[11px] text-subtle mt-1">Note: {r.review_note}</p>}
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      <span className={cn("px-2.5 py-1 rounded-full text-xs font-medium capitalize", STATUS_BADGE[r.status] ?? "bg-elevated text-body")}>
                        {r.kind === "dlp" && r.status === "approved" ? "justified" : r.status}
                      </span>
                      {r.reviewed_at && <p className="text-[11px] text-subtle mt-1">{formatDateTime(r.reviewed_at)}</p>}
                    </td>
                    <td className="px-5 py-4 text-right whitespace-nowrap">
                      {r.status === "pending" ? (
                        <div className="flex justify-end gap-2">
                          <button onClick={() => setDecision({ request: r, action: "approve" })}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-green-500/10 text-success hover:bg-green-500/20">
                            <Check className="w-3.5 h-3.5" /> {k.approveLabel}
                          </button>
                          <button onClick={() => setDecision({ request: r, action: "deny" })}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 text-danger hover:bg-red-500/20">
                            <XCircle className="w-3.5 h-3.5" /> Deny
                          </button>
                        </div>
                      ) : r.status === "approved" && r.kind !== "dlp" ? (
                        <button onClick={() => setDecision({ request: r, action: "revoke" })}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-border text-body hover:bg-elevated">
                          <RotateCcw className="w-3.5 h-3.5" /> Revoke
                        </button>
                      ) : (
                        <span className="text-xs text-subtle">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <Pagination page={page} totalPages={totalPages} total={total} limit={limit} onPageChange={setPage} onLimitChange={n => { setLimit(n); setPage(1); }} />
      </div>

      {decision && <DecisionDialog decision={decision} onClose={() => setDecision(null)} />}
    </div>
  );
}

function DecisionDialog({ decision, onClose }: { decision: Decision; onClose: () => void }) {
  const qc = useQueryClient();
  const { request: r, action } = decision;
  const k = KIND[r.kind] ?? KIND.website;
  const [note, setNote] = useState("");

  const mutate = useMutation({
    mutationFn: () => {
      const n = note.trim() || undefined;
      if (action === "approve") return accessRequestApi.approve(r.id, n);
      if (action === "deny") return accessRequestApi.deny(r.id, n);
      return accessRequestApi.revoke(r.id, n);
    },
    onSuccess: () => {
      toast.success(action === "approve" ? `${employeeName(r)} has been granted access` : action === "deny" ? "Request denied" : "Access revoked");
      qc.invalidateQueries({ queryKey: ["access-requests"] });
      qc.invalidateQueries({ queryKey: ["notif-requests"] });
      onClose();
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Could not update the request"),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const title = action === "approve" ? `${k.approveLabel}?` : action === "deny" ? "Deny this request?" : "Revoke access?";
  const effect = action === "approve" ? k.approveEffect
    : action === "deny" ? "Nothing changes on the employee's device. They are told the request was declined, with your note."
    : "The block applies to this employee again within about a minute. They are told it was revoked.";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="bg-card rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <h3 className="font-semibold text-foreground">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="text-subtle hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>
        <dl className="mt-4 rounded-xl border border-border bg-background p-3 text-sm space-y-2">
          <div className="flex gap-3"><dt className="w-20 shrink-0 text-muted-foreground">Employee</dt><dd className="text-foreground">{employeeName(r)}</dd></div>
          <div className="flex gap-3"><dt className="w-20 shrink-0 text-muted-foreground">{k.noun}</dt><dd className="font-medium text-foreground [overflow-wrap:anywhere]">{r.label || r.domain || r.resource}</dd></div>
          <div className="flex gap-3"><dt className="w-20 shrink-0 text-muted-foreground">Reason</dt><dd className="text-body">{r.reason || "No reason provided"}</dd></div>
        </dl>
        <p className={cn("text-xs mt-4 leading-relaxed", r.kind === "download" && action === "approve" ? "text-warning" : "text-muted-foreground")}>{effect}</p>
        <label className="block text-sm font-medium text-foreground mt-4 mb-1.5">Note to the employee <span className="text-subtle font-normal">(optional)</span></label>
        <textarea value={note} onChange={e => setNote(e.target.value.slice(0, 500))} rows={3}
          placeholder={action === "deny" ? "e.g. Please use the approved payroll tool instead" : "e.g. Approved for the Q4 audit"}
          className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500" />
        <div className="flex gap-3 mt-5">
          <button onClick={onClose} className="flex-1 border border-border text-body py-2 rounded-lg text-sm hover:bg-elevated">Cancel</button>
          <button onClick={() => mutate.mutate()} disabled={mutate.isPending}
            className={cn("flex-1 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60 text-white",
              action === "approve" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700")}>
            {mutate.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            {action === "approve" ? k.approveLabel : action === "deny" ? "Deny" : "Revoke"}
          </button>
        </div>
      </div>
    </div>
  );
}
