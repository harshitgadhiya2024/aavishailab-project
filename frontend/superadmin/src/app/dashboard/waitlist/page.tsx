"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { waitlistApi } from "@/lib/api";
import {
  Hourglass, Search, X, Loader2, Mail, Building2, Users, Briefcase, Globe, Send, Download, Trash2, ExternalLink,
} from "lucide-react";
import { cn, formatDateTime } from "@/lib/utils";
import { toast } from "sonner";

const STATUSES = [
  { id: "all", label: "All" },
  { id: "waiting", label: "Waiting" },
  { id: "invited", label: "Invited" },
  { id: "onboarded", label: "Onboarded" },
  { id: "declined", label: "Declined" },
] as const;

const STATUS_STYLE: Record<string, string> = {
  waiting: "bg-brand-500/10 text-brand-700",
  invited: "bg-blue-500/10 text-blue-700",
  onboarded: "bg-green-500/10 text-green-700",
  declined: "bg-muted text-muted-foreground",
};

const WEBSITE_URL = process.env.NEXT_PUBLIC_WEBSITE_URL ?? "https://website.aavishield.com";

type Entry = {
  id: string;
  name: string;
  email: string;
  company: string;
  team_size: string;
  role: string;
  source: string;
  ip_address: string;
  user_agent: string;
  status: string;
  notes: string;
  invited_at: string | null;
  created_at: string;
  updated_at: string;
};

const confirmInvite = (e: Entry) =>
  window.confirm(`Invite ${e.name}? They'll get an email with a link to create their organization.`);

export default function WaitlistPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<string>("all");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Debounce the search box so typing doesn't fire a request per key.
  useEffect(() => {
    const t = setTimeout(() => setSearch(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const { data, isLoading } = useQuery({
    queryKey: ["waitlist", status, search],
    queryFn: () => waitlistApi.list({ status, q: search || undefined }),
    refetchInterval: 60_000,
  });

  const items: Entry[] = data?.data?.entries ?? [];
  const counts: Record<string, number> = data?.data?.counts ?? {};
  const open = items.find((i) => i.id === openId) ?? null;

  const invite = useMutation({
    mutationFn: (id: string) => waitlistApi.update(id, { status: "invited" }),
    onSuccess: () => {
      toast.success("Invitation sent");
      qc.invalidateQueries({ queryKey: ["waitlist"] });
      qc.invalidateQueries({ queryKey: ["sa-overview"] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Could not send the invitation"),
  });

  const exportCsv = async () => {
    setExporting(true);
    try {
      const res = await waitlistApi.exportCsv({ status, q: search || undefined });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `aavishield-waitlist-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Export failed");
    } finally {
      setExporting(false);
    }
  };

  const total = counts.all ?? 0;
  const stats = [
    { label: "Signed up", value: total },
    { label: "Waiting", value: counts.waiting ?? 0 },
    { label: "Invited", value: counts.invited ?? 0 },
    { label: "Onboarded", value: counts.onboarded ?? 0 },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="page-eyebrow">Customers</p>
          <h2 className="mt-2 text-[2rem] font-normal leading-[1.1] tracking-[-0.035em] text-foreground">Waitlist</h2>
          <p className="mt-1 text-sm text-muted-foreground">Prelaunch sign-ups from the early access page. Invite people in when their spot opens.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={`${WEBSITE_URL}/waitlist`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 font-mono text-[12px] font-medium uppercase tracking-[0.06em] text-foreground hover:bg-muted"
          >
            <ExternalLink className="h-4 w-4" /> View page
          </a>
          <button
            onClick={exportCsv}
            disabled={exporting || total === 0}
            className="flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 font-mono text-[12px] font-medium uppercase tracking-[0.06em] text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Export CSV
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border border-border bg-card p-5">
            <p className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">{s.label}</p>
            <p className="mt-2.5 [font-family:Satoshi,var(--font-inter),sans-serif] text-[2rem] font-medium leading-none tracking-[-0.03em] tabular-nums text-foreground">
              {s.value}
            </p>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1">
          {STATUSES.map((s) => (
            <button
              key={s.id}
              onClick={() => setStatus(s.id)}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                status === s.id ? "bg-brand-tint text-brand-700" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {s.label}
              <span className="font-mono text-[11px] opacity-70">{counts[s.id] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="relative md:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, email or company"
            className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {isLoading ? (
          [...Array(4)].map((_, i) => <div key={i} className="h-16 animate-pulse border-b border-border bg-muted/40 last:border-0" />)
        ) : items.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground">
            <Hourglass className="mx-auto mb-2 h-8 w-8 opacity-30" />
            {search || status !== "all" ? "No sign-ups match this filter" : "No sign-ups yet. They appear here as soon as someone joins on the early access page."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-5 py-3 font-medium">Person</th>
                  <th className="px-5 py-3 font-medium">Company</th>
                  <th className="px-5 py-3 font-medium">Team size</th>
                  <th className="px-5 py-3 font-medium">Role</th>
                  <th className="px-5 py-3 font-medium">Joined</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((e) => (
                  <tr key={e.id} onClick={() => setOpenId(e.id)} className="cursor-pointer transition-colors hover:bg-elevated">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-md bg-brand-500/10 text-sm font-semibold text-brand-600">
                          {e.name.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-foreground">{e.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">{e.email}</span>
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-foreground">{e.company}</td>
                    <td className="px-5 py-3.5 text-muted-foreground">{e.team_size || "—"}</td>
                    <td className="px-5 py-3.5 text-muted-foreground">{e.role || "—"}</td>
                    <td className="whitespace-nowrap px-5 py-3.5 text-xs text-muted-foreground">{formatDateTime(e.created_at)}</td>
                    <td className="px-5 py-3.5">
                      <span className={cn("rounded-[4px] px-2.5 py-1 text-xs font-medium capitalize", STATUS_STYLE[e.status])}>{e.status}</span>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      {e.status === "waiting" && (
                        <button
                          onClick={(ev) => {
                            ev.stopPropagation();
                            if (confirmInvite(e)) invite.mutate(e.id);
                          }}
                          disabled={invite.isPending}
                          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-foreground transition-colors hover:border-brand-500/40 hover:bg-brand-tint hover:text-brand-700 disabled:opacity-50"
                        >
                          <Send className="h-3.5 w-3.5" /> Invite
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {open && <EntryDrawer item={open} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function EntryDrawer({ item, onClose }: { item: Entry; onClose: () => void }) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState(item.notes ?? "");

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["waitlist"] });
    qc.invalidateQueries({ queryKey: ["sa-overview"] });
  };

  const mut = useMutation({
    mutationFn: (data: { status?: string; notes?: string }) => waitlistApi.update(item.id, data),
    onSuccess: (_, vars) => {
      toast.success(vars.notes !== undefined ? "Notes saved" : vars.status === "invited" && !item.invited_at ? "Invitation sent" : "Status updated");
      refresh();
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Update failed"),
  });

  const del = useMutation({
    mutationFn: () => waitlistApi.remove(item.id),
    onSuccess: () => {
      toast.success("Removed from the waitlist");
      refresh();
      onClose();
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Could not remove"),
  });

  const setStatus = (s: string) => {
    if (s === item.status) return;
    if (s === "invited" && !item.invited_at && !confirmInvite(item)) return;
    mut.mutate({ status: s });
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <aside className="h-full w-full max-w-lg overflow-y-auto border-l border-border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-card px-6 py-4">
          <div className="min-w-0">
            <h3 className="truncate font-semibold text-foreground">{item.name}</h3>
            <p className="text-xs text-muted-foreground">Joined {formatDateTime(item.created_at)}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-6 px-6 py-5">
          <dl className="grid gap-3 text-sm">
            <Row icon={Mail} label="Email">
              <a href={`mailto:${item.email}`} className="text-brand-600 hover:underline">{item.email}</a>
            </Row>
            <Row icon={Building2} label="Company">{item.company}</Row>
            <Row icon={Users} label="Team size">{item.team_size || "Not given"}</Row>
            <Row icon={Briefcase} label="Role">{item.role || "Not given"}</Row>
            <Row icon={Globe} label="Source">{item.source || "/waitlist"}</Row>
            {item.invited_at && <Row icon={Send} label="Invited">{formatDateTime(item.invited_at)}</Row>}
          </dl>

          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Status</p>
            <div className="flex flex-wrap gap-2">
              {STATUSES.filter((s) => s.id !== "all").map((s) => (
                <button
                  key={s.id}
                  disabled={mut.isPending}
                  onClick={() => setStatus(s.id)}
                  className={cn(
                    "rounded-[4px] border px-3 py-1 text-xs font-medium transition-colors",
                    item.status === s.id ? cn("border-transparent", STATUS_STYLE[s.id]) : "border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {item.invited_at
                ? "The invitation email has been sent. Changing the status again doesn't resend it."
                : "Moving someone to Invited emails them a link to create their organization."}
            </p>
          </div>

          <div>
            <label htmlFor="wl-notes" className="mb-1 block text-xs font-medium text-muted-foreground">Internal notes</label>
            <textarea
              id="wl-notes"
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Priority, follow-ups, who they spoke to..."
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <button
              disabled={mut.isPending || notes === (item.notes ?? "")}
              onClick={() => mut.mutate({ notes })}
              className="mt-2 flex items-center gap-2 rounded-lg bg-primary px-4 py-2 font-mono text-[12px] font-medium uppercase tracking-[0.06em] text-primary-foreground disabled:opacity-50"
            >
              {mut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Save notes
            </button>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-border pt-5">
            <p className="text-xs text-muted-foreground">
              IP {item.ip_address || "unknown"}
              {item.user_agent ? ` · ${item.user_agent.slice(0, 60)}` : ""}
            </p>
            <button
              onClick={() => window.confirm(`Remove ${item.name} from the waitlist? This can't be undone here.`) && del.mutate()}
              disabled={del.isPending}
              className="flex flex-shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-500/10 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}

function Row({ icon: Icon, label, children }: { icon: any; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
      <dt className="w-20 flex-shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{children}</dd>
    </div>
  );
}
