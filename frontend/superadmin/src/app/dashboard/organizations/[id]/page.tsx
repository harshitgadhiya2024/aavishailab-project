"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { orgApi, billingApi } from "@/lib/api";
import {
  ArrowLeft, Building2, Users, Shield, Laptop, Activity, Mail, Globe,
  UserCog, Download, Trash2, Plus, X, Loader2, RefreshCw, CreditCard,
} from "lucide-react";
import { formatDate, formatDateTime, formatNumber, cn } from "@/lib/utils";
import { toast } from "sonner";

const PLAN_LABELS: Record<string, string> = {
  trial: "Trial", starter: "Starter", professional: "Professional", enterprise: "Enterprise",
};

const ACTION_COLORS: Record<string, string> = {
  blocked: "bg-red-500/10 text-red-400",
  alerted: "bg-yellow-500/10 text-yellow-400",
  allowed: "bg-green-500/10 text-green-400",
  monitored: "bg-brand-500/10 text-brand-500",
};

const BILLING_STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/10 text-yellow-400",
  paid: "bg-green-500/10 text-green-400",
  cancelled: "bg-muted text-muted-foreground",
  expired: "bg-red-500/10 text-red-400",
};

function formatMoney(paise: number, currency = "INR") {
  const symbol = currency === "INR" ? "₹" : currency + " ";
  return symbol + (paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function OrganizationDetailPage() {
  const params = useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const id = params.id as string;
  const { data: session } = useSession();
  const canManage = (session?.user?.superadmin_level ?? "full") === "full";

  const [showPurge, setShowPurge] = useState(false);
  const [purgeConfirm, setPurgeConfirm] = useState("");
  const [showInvoice, setShowInvoice] = useState(false);
  const [invoiceForm, setInvoiceForm] = useState({ amount_rupees: "", description: "", billing_cycle: "one_time" });

  const { data, isLoading, error } = useQuery({
    queryKey: ["org-detail", id],
    queryFn: () => orgApi.get(id),
    enabled: !!id,
  });

  const { data: billingData } = useQuery({
    queryKey: ["org-billing", id],
    queryFn: () => billingApi.listForOrg(id),
    enabled: !!id,
  });

  const impersonateMut = useMutation({
    mutationFn: () => orgApi.impersonate(id),
    onSuccess: (res) => {
      const base = process.env.NEXT_PUBLIC_COMPANY_URL || "";
      if (!base) {
        toast.error("Company dashboard URL isn't configured (NEXT_PUBLIC_COMPANY_URL)");
        return;
      }
      window.open(`${base}/impersonate?code=${res.data.code}`, "_blank", "noopener,noreferrer");
      toast.success(`Opening as ${res.data.target_email}`);
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Failed to start impersonation"),
  });

  const exportMut = useMutation({
    mutationFn: () => orgApi.export(id),
    onSuccess: (res) => {
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${org?.slug ?? "org"}-export.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Export downloaded");
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Export failed"),
  });

  const purgeMut = useMutation({
    mutationFn: () => orgApi.purge(id, purgeConfirm),
    onSuccess: () => {
      toast.success("Organization permanently purged");
      router.push("/dashboard/organizations");
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Purge failed"),
  });

  const createInvoiceMut = useMutation({
    mutationFn: () => billingApi.create(id, {
      amount_rupees: Number(invoiceForm.amount_rupees),
      description: invoiceForm.description,
      billing_cycle: invoiceForm.billing_cycle,
    }),
    onSuccess: () => {
      toast.success("Invoice created");
      qc.invalidateQueries({ queryKey: ["org-billing", id] });
      setShowInvoice(false);
      setInvoiceForm({ amount_rupees: "", description: "", billing_cycle: "one_time" });
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Failed to create invoice"),
  });

  const refreshBillingMut = useMutation({
    mutationFn: (billingId: string) => billingApi.refresh(billingId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["org-billing", id] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Failed to refresh"),
  });

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 w-64 bg-card rounded" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-card rounded-xl border border-border" />)}
        </div>
        <div className="h-64 bg-card rounded-xl border border-border" />
      </div>
    );
  }

  if (error || !data?.data) {
    return (
      <div className="space-y-4">
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="bg-card rounded-xl border border-border p-12 text-center text-muted-foreground">
          Organization not found
        </div>
      </div>
    );
  }

  const d = data.data;
  const org = d.org;
  const isInactive = org.status !== "active";
  const billingRecords = billingData?.data?.records ?? [];

  const stats = [
    { label: "Users", value: formatNumber(d.user_count ?? 0), icon: Users, color: "bg-green-500/10 text-green-400" },
    { label: "Employees", value: formatNumber(d.employee_count ?? 0), icon: Shield, color: "bg-purple-500/10 text-purple-400" },
    { label: "Devices", value: formatNumber(d.device_count ?? 0), icon: Laptop, color: "bg-brand-500/10 text-brand-500" },
    { label: "Policies", value: formatNumber(d.policy_count ?? 0), icon: Shield, color: "bg-brand-500/10 text-brand-500" },
  ];

  return (
    <div className="space-y-6">
      <button onClick={() => router.push("/dashboard/organizations")} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4" /> Back to Organizations
      </button>

      <div className="flex items-start justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-brand-500/10 rounded-xl flex items-center justify-center">
            <Building2 className="w-7 h-7 text-brand-500" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-foreground">{org.name}</h2>
            <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
              <span className="flex items-center gap-1"><Globe className="w-3.5 h-3.5" /> {org.domain || "—"}</span>
              <span>·</span>
              <span>{org.slug}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="px-3 py-1.5 rounded-full text-xs font-medium bg-brand-500/10 text-brand-500">
            {PLAN_LABELS[org.plan] ?? org.plan}
          </span>
          <span className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium",
            org.status === "active" ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"
          )}>
            <span className={cn("w-1.5 h-1.5 rounded-full", org.status === "active" ? "bg-green-500" : "bg-red-400")} />
            {org.status}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => impersonateMut.mutate()}
          disabled={!canManage || impersonateMut.isPending}
          title={canManage ? "Sign in as this org's admin" : "Requires full superadmin access"}
          className="flex items-center gap-2 border border-border text-foreground px-3 py-2 rounded-lg text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          {impersonateMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCog className="w-4 h-4" />}
          View as Org
        </button>
        <button
          onClick={() => exportMut.mutate()}
          disabled={exportMut.isPending}
          className="flex items-center gap-2 border border-border text-foreground px-3 py-2 rounded-lg text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          {exportMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          Export Data
        </button>
        {canManage && (
          <button
            onClick={() => setShowPurge(true)}
            disabled={!isInactive}
            title={isInactive ? "Permanently delete all data" : "Deactivate the organization first"}
            className="flex items-center gap-2 border border-red-500/30 text-red-400 px-3 py-2 rounded-lg text-sm font-medium hover:bg-red-500/10 disabled:opacity-40"
          >
            <Trash2 className="w-4 h-4" />
            Purge Data
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="bg-card rounded-xl p-5 border border-border shadow-sm">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{s.label}</p>
                <p className="text-3xl font-bold text-foreground mt-1">{s.value}</p>
                {s.label === "Users" && (
                  <p className="text-xs text-[#6B6B6B] mt-1">of {org.max_users} seats</p>
                )}
              </div>
              <div className={`p-2.5 rounded-lg ${s.color}`}>
                <s.icon className="w-5 h-5" />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Devices */}
        <div className="bg-card rounded-xl border border-border shadow-sm">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <h3 className="font-semibold text-foreground flex items-center gap-2"><Laptop className="w-4 h-4" /> Devices</h3>
            <span className="text-xs text-muted-foreground">{d.devices?.length ?? 0} shown</span>
          </div>
          <div className="max-h-80 overflow-y-auto divide-y divide-border">
            {(d.devices ?? []).length === 0 ? (
              <p className="text-center text-sm text-[#6B6B6B] py-10">No devices enrolled yet</p>
            ) : d.devices.map((dev: any) => (
              <div key={dev.id} className="px-5 py-3 flex items-center justify-between text-sm">
                <div>
                  <p className="font-medium text-foreground">{dev.hostname}</p>
                  <p className="text-xs text-muted-foreground">{dev.os_type} · v{dev.agent_version || "?"}</p>
                </div>
                <span className={cn(
                  "text-xs font-medium px-2 py-0.5 rounded-full",
                  dev.status === "online" ? "bg-green-500/10 text-green-400" : "bg-muted text-muted-foreground"
                )}>
                  {dev.status}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Users */}
        <div className="bg-card rounded-xl border border-border shadow-sm">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <h3 className="font-semibold text-foreground flex items-center gap-2"><Users className="w-4 h-4" /> Dashboard Users</h3>
            <span className="text-xs text-muted-foreground">{d.users?.length ?? 0} shown</span>
          </div>
          <div className="max-h-80 overflow-y-auto divide-y divide-border">
            {(d.users ?? []).length === 0 ? (
              <p className="text-center text-sm text-[#6B6B6B] py-10">No dashboard users yet</p>
            ) : d.users.map((u: any) => (
              <div key={u.id} className="px-5 py-3 flex items-center justify-between text-sm">
                <div>
                  <p className="font-medium text-foreground">{u.full_name || u.email}</p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1"><Mail className="w-3 h-3" /> {u.email}</p>
                </div>
                <span className="text-xs text-muted-foreground capitalize">{u.role?.replace("_", " ")}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Billing */}
      <div className="bg-card rounded-xl border border-border shadow-sm">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h3 className="font-semibold text-foreground flex items-center gap-2"><CreditCard className="w-4 h-4" /> Billing</h3>
          {canManage && (
            <button
              onClick={() => setShowInvoice(true)}
              className="flex items-center gap-1.5 text-xs font-medium text-brand-500 hover:text-brand-600"
            >
              <Plus className="w-3.5 h-3.5" /> New Invoice
            </button>
          )}
        </div>
        <div className="divide-y divide-border">
          {billingRecords.length === 0 ? (
            <p className="text-center text-sm text-[#6B6B6B] py-10">No invoices yet</p>
          ) : billingRecords.map((b: any) => (
            <div key={b.id} className="px-5 py-3 flex items-center justify-between text-sm gap-3">
              <div className="min-w-0">
                <p className="font-medium text-foreground truncate">{b.description}</p>
                <p className="text-xs text-muted-foreground">{formatDate(b.created_at)} · {b.billing_cycle}</p>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <span className="font-mono text-foreground">{formatMoney(b.amount_paise, b.currency)}</span>
                <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium capitalize", BILLING_STATUS_COLORS[b.status])}>
                  {b.status}
                </span>
                {b.status === "pending" && b.short_url && (
                  <a href={b.short_url} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-500 hover:underline">
                    Pay link
                  </a>
                )}
                {b.status === "pending" && (
                  <button onClick={() => refreshBillingMut.mutate(b.id)} title="Check status" className="text-muted-foreground hover:text-foreground">
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent activity */}
      <div className="bg-card rounded-xl border border-border shadow-sm">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h3 className="font-semibold text-foreground flex items-center gap-2"><Activity className="w-4 h-4" /> Recent Activity</h3>
          <span className="text-xs text-muted-foreground">Last {d.recent_activity?.length ?? 0} events</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground text-xs uppercase tracking-wide">
                <th className="text-left px-5 py-2.5 font-medium">Type</th>
                <th className="text-left px-5 py-2.5 font-medium">Target</th>
                <th className="text-left px-5 py-2.5 font-medium">Action</th>
                <th className="text-left px-5 py-2.5 font-medium">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(d.recent_activity ?? []).length === 0 ? (
                <tr><td colSpan={4} className="text-center py-10 text-[#6B6B6B]">No activity recorded yet</td></tr>
              ) : d.recent_activity.map((ev: any) => (
                <tr key={ev.id}>
                  <td className="px-5 py-3 text-muted-foreground">{ev.event_type}</td>
                  <td className="px-5 py-3 text-foreground max-w-xs truncate">{ev.target_domain || ev.target || "—"}</td>
                  <td className="px-5 py-3">
                    <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium", ACTION_COLORS[ev.action] ?? "bg-muted text-muted-foreground")}>
                      {ev.action}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{formatDateTime(ev.timestamp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-[#6B6B6B]">Created {formatDate(org.created_at)}</p>

      {/* New invoice modal */}
      {showInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setShowInvoice(false)}>
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="font-semibold text-foreground">New Invoice</h3>
              <button onClick={() => setShowInvoice(false)} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); createInvoiceMut.mutate(); }} className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Amount (₹) *</label>
                <input
                  type="number" min={1} step="0.01" required
                  value={invoiceForm.amount_rupees}
                  onChange={(e) => setInvoiceForm((f) => ({ ...f, amount_rupees: e.target.value }))}
                  className="w-full border border-border bg-background rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Description *</label>
                <input
                  required
                  value={invoiceForm.description}
                  onChange={(e) => setInvoiceForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="e.g. Professional plan — Q1 2026"
                  className="w-full border border-border bg-background rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Billing Cycle</label>
                <select
                  value={invoiceForm.billing_cycle}
                  onChange={(e) => setInvoiceForm((f) => ({ ...f, billing_cycle: e.target.value }))}
                  className="w-full border border-border bg-background rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="one_time">One-time</option>
                  <option value="monthly">Monthly</option>
                  <option value="annual">Annual</option>
                </select>
              </div>
              <p className="text-xs text-[#6B6B6B]">Creates a real Razorpay payment link the org's finance contact can pay directly.</p>
              <button
                type="submit"
                disabled={createInvoiceMut.isPending}
                className="w-full bg-primary text-primary-foreground py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {createInvoiceMut.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Create Invoice
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Purge confirm modal */}
      {showPurge && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setShowPurge(false)}>
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <div className="w-12 h-12 bg-red-500/10 rounded-xl flex items-center justify-center mx-auto mb-4">
              <Trash2 className="w-5 h-5 text-red-400" />
            </div>
            <h3 className="text-center font-semibold text-foreground mb-2">Permanently Purge Data?</h3>
            <p className="text-center text-sm text-muted-foreground mb-4">
              This deletes every user, device, policy, and activity record for <strong>{org.name}</strong>. This cannot be undone.
            </p>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Type <span className="font-mono text-foreground">{org.slug}</span> to confirm
            </label>
            <input
              value={purgeConfirm}
              onChange={(e) => setPurgeConfirm(e.target.value)}
              className="w-full border border-border bg-background rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-red-500"
            />
            <div className="flex gap-3">
              <button onClick={() => setShowPurge(false)} className="flex-1 border border-border text-muted-foreground py-2 rounded-lg text-sm">
                Cancel
              </button>
              <button
                onClick={() => purgeMut.mutate()}
                disabled={purgeConfirm !== org.slug || purgeMut.isPending}
                className="flex-1 bg-destructive text-destructive-foreground py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-40"
              >
                {purgeMut.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Purge
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
