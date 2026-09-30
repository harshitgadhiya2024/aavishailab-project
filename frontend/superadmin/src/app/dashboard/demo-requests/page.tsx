"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { demoRequestApi } from "@/lib/api";
import { Inbox, Search, X, Loader2, Mail, Building2, Monitor, Globe, Reply } from "lucide-react";
import { cn, formatDateTime } from "@/lib/utils";
import { toast } from "sonner";

const STATUSES = [
  { id: "all", label: "All" },
  { id: "new", label: "New" },
  { id: "contacted", label: "Contacted" },
  { id: "qualified", label: "Qualified" },
  { id: "closed", label: "Closed" },
] as const;

const STATUS_STYLE: Record<string, string> = {
  new: "bg-brand-500/10 text-brand-500",
  contacted: "bg-blue-500/10 text-blue-400",
  qualified: "bg-green-500/10 text-green-400",
  closed: "bg-muted text-muted-foreground",
};

type DemoRequest = {
  id: string;
  name: string;
  email: string;
  company: string;
  devices: string;
  message: string;
  source: string;
  ip_address: string;
  user_agent: string;
  status: string;
  notes: string;
  created_at: string;
  updated_at: string;
};

export default function DemoRequestsPage() {
  const [status, setStatus] = useState<string>("all");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  // Debounce the search box so typing doesn't fire a request per key.
  useEffect(() => {
    const t = setTimeout(() => setSearch(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const { data, isLoading } = useQuery({
    queryKey: ["demo-requests", status, search],
    queryFn: () => demoRequestApi.list({ status, q: search || undefined }),
    refetchInterval: 60_000,
  });

  const items: DemoRequest[] = data?.data?.demo_requests ?? [];
  const counts: Record<string, number> = data?.data?.counts ?? {};
  const open = items.find((i) => i.id === openId) ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Demo Requests</h2>
        <p className="text-sm text-muted-foreground mt-1">&quot;Book a demo&quot; submissions from the DelSecure website</p>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1">
          {STATUSES.map((s) => (
            <button
              key={s.id}
              onClick={() => setStatus(s.id)}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                status === s.id ? "bg-brand-500/10 text-brand-500" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {s.label}
              <span className="text-xs opacity-70">{counts[s.id] ?? 0}</span>
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

      <div className="bg-card rounded-xl border border-border shadow-sm divide-y divide-border">
        {isLoading ? (
          [...Array(4)].map((_, i) => <div key={i} className="h-16 animate-pulse bg-muted/40" />)
        ) : items.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Inbox className="w-8 h-8 mx-auto mb-2 opacity-30" />
            {search || status !== "all" ? "No demo requests match this filter" : "No demo requests yet. They appear here as soon as someone books a demo on the website."}
          </div>
        ) : (
          items.map((d) => (
            <button
              key={d.id}
              onClick={() => setOpenId(d.id)}
              className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-muted/40"
            >
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-brand-500/10 text-sm font-semibold text-brand-500">
                {d.name.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">
                  {d.name} <span className="font-normal text-muted-foreground">at {d.company}</span>
                </p>
                <p className="truncate text-sm text-muted-foreground">
                  {d.email}
                  {d.devices ? ` · ${d.devices} devices` : ""}
                </p>
              </div>
              <span className="hidden text-xs text-muted-foreground sm:block">{formatDateTime(d.created_at)}</span>
              <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium capitalize", STATUS_STYLE[d.status])}>{d.status}</span>
            </button>
          ))
        )}
      </div>

      {open && <DemoDrawer item={open} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function DemoDrawer({ item, onClose }: { item: DemoRequest; onClose: () => void }) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState(item.notes ?? "");

  const mut = useMutation({
    mutationFn: (data: { status?: string; notes?: string }) => demoRequestApi.update(item.id, data),
    onSuccess: (_, vars) => {
      toast.success(vars.notes !== undefined ? "Notes saved" : "Status updated");
      qc.invalidateQueries({ queryKey: ["demo-requests"] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Update failed"),
  });

  const replyHref = `mailto:${item.email}?subject=${encodeURIComponent("Your DelSecure demo")}&body=${encodeURIComponent(`Hi ${item.name.split(" ")[0]},\n\nThanks for booking a DelSecure demo. `)}`;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <aside className="h-full w-full max-w-lg overflow-y-auto border-l border-border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-card px-6 py-4">
          <div className="min-w-0">
            <h3 className="truncate font-semibold text-foreground">{item.name}</h3>
            <p className="text-xs text-muted-foreground">Received {formatDateTime(item.created_at)}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-6 px-6 py-5">
          <dl className="grid gap-3 text-sm">
            <Row icon={Mail} label="Email">
              <a href={`mailto:${item.email}`} className="text-brand-500 hover:underline">{item.email}</a>
            </Row>
            <Row icon={Building2} label="Company">{item.company}</Row>
            <Row icon={Monitor} label="Devices">{item.devices || "Not given"}</Row>
            <Row icon={Globe} label="Source">{item.source || "/contact"}</Row>
          </dl>

          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">What they want to see</p>
            <p className="whitespace-pre-wrap rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
              {item.message || "No message"}
            </p>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Status</p>
            <div className="flex flex-wrap gap-2">
              {STATUSES.filter((s) => s.id !== "all").map((s) => (
                <button
                  key={s.id}
                  disabled={mut.isPending}
                  onClick={() => mut.mutate({ status: s.id })}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    item.status === s.id ? cn("border-transparent", STATUS_STYLE[s.id]) : "border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="demo-notes" className="mb-1 block text-xs font-medium text-muted-foreground">Internal notes</label>
            <textarea
              id="demo-notes"
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Call scheduled, follow-ups, deal size..."
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <button
              disabled={mut.isPending || notes === (item.notes ?? "")}
              onClick={() => mut.mutate({ notes })}
              className="mt-2 flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {mut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Save notes
            </button>
          </div>

          <a
            href={replyHref}
            onClick={() => item.status === "new" && mut.mutate({ status: "contacted" })}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted"
          >
            <Reply className="h-4 w-4" /> Reply by email
          </a>

          <p className="text-xs text-muted-foreground">
            IP {item.ip_address || "unknown"}
            {item.user_agent ? ` · ${item.user_agent.slice(0, 80)}` : ""}
          </p>
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
