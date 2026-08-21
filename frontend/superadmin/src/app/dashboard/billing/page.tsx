"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { billingApi, revenueApi } from "@/lib/api";
import { CreditCard, TrendingUp, Clock, AlertTriangle, RefreshCw } from "lucide-react";
import { formatDate, cn } from "@/lib/utils";
import { Pagination } from "@/components/ui/Pagination";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

const BILLING_STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/10 text-yellow-400",
  paid: "bg-green-500/10 text-green-400",
  cancelled: "bg-muted text-muted-foreground",
  expired: "bg-red-500/10 text-red-400",
};

function formatMoney(paise: number) {
  return "₹" + (paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export default function BillingPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [status, setStatus] = useState("");

  const { data: revenue } = useQuery({ queryKey: ["revenue-analytics"], queryFn: revenueApi.get });
  const { data, isLoading } = useQuery({
    queryKey: ["billing-list", page, limit, status],
    queryFn: () => billingApi.list({ page, limit, status: status || undefined }),
  });

  const refreshMut = useMutation({
    mutationFn: (id: string) => billingApi.refresh(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["billing-list"] }),
  });

  const r = revenue?.data;
  const records = data?.data?.records ?? [];
  const total = data?.data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  const trend = (r?.monthly_revenue_trend ?? []).map((t: any) => ({ month: t.month, amount: t.amount_paise / 100 }));

  const cards = [
    { label: "MRR Estimate", value: formatMoney(r?.mrr_paise ?? 0), icon: TrendingUp, color: "bg-green-500/10 text-green-400" },
    { label: "Collected", value: formatMoney(r?.total_collected_paise ?? 0), icon: CreditCard, color: "bg-brand-500/10 text-brand-500" },
    { label: "Pending", value: formatMoney(r?.total_pending_paise ?? 0), icon: Clock, color: "bg-yellow-500/10 text-yellow-400" },
    { label: "Overdue Invoices", value: r?.overdue_invoices ?? 0, icon: AlertTriangle, color: "bg-red-500/10 text-red-400" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Billing & Revenue</h2>
        <p className="text-sm text-muted-foreground mt-1">Real Razorpay-backed invoices across every organization</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="bg-card rounded-xl p-5 border border-border shadow-sm">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{c.label}</p>
                <p className="text-2xl font-bold text-foreground mt-1">{c.value}</p>
              </div>
              <div className={`p-2.5 rounded-lg ${c.color}`}>
                <c.icon className="w-5 h-5" />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-card rounded-xl p-5 border border-border shadow-sm">
        <h3 className="font-semibold text-foreground mb-4">Monthly Revenue (Paid Invoices)</h3>
        {trend.length > 0 ? (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={trend}>
              <defs>
                <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#FF7000" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#FF7000" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#A3A3A3" }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#A3A3A3" }} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{ background: "#141414", border: "1px solid #262626", color: "#F5F5F5" }}
                formatter={(v: number) => [`₹${v.toLocaleString("en-IN")}`, "Revenue"]}
              />
              <Area type="monotone" dataKey="amount" stroke="#FF7000" strokeWidth={2} fill="url(#revGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[220px] flex items-center justify-center text-[#6B6B6B] text-sm">No paid invoices yet</div>
        )}
      </div>

      <div className="bg-card rounded-xl border border-border shadow-sm">
        <div className="p-4 border-b border-border">
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            className="border border-border bg-background rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="paid">Paid</option>
            <option value="cancelled">Cancelled</option>
            <option value="expired">Expired</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground text-xs uppercase tracking-wide">
                <th className="text-left px-5 py-3 font-medium">Organization</th>
                <th className="text-left px-5 py-3 font-medium">Description</th>
                <th className="text-left px-5 py-3 font-medium">Amount</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
                <th className="text-left px-5 py-3 font-medium">Created</th>
                <th className="text-right px-5 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {[...Array(6)].map((__, j) => <td key={j} className="px-5 py-4"><div className="h-4 bg-muted rounded w-3/4" /></td>)}
                  </tr>
                ))
              ) : records.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-12 text-[#6B6B6B]">No invoices yet</td></tr>
              ) : records.map((b: any) => (
                <tr key={b.id} className="hover:bg-muted transition-colors">
                  <td className="px-5 py-3">
                    <Link href={`/dashboard/organizations/${b.org_id}`} className="text-brand-500 hover:underline">
                      {b.org?.name ?? b.org_id?.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-foreground max-w-xs truncate">{b.description}</td>
                  <td className="px-5 py-3 font-mono text-foreground">{formatMoney(b.amount_paise)}</td>
                  <td className="px-5 py-3">
                    <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium capitalize", BILLING_STATUS_COLORS[b.status])}>
                      {b.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{formatDate(b.created_at)}</td>
                  <td className="px-5 py-3 text-right">
                    {b.status === "pending" && (
                      <button onClick={() => refreshMut.mutate(b.id)} className="text-muted-foreground hover:text-foreground" title="Refresh status">
                        <RefreshCw className={cn("w-4 h-4", refreshMut.isPending && "animate-spin")} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination page={page} totalPages={totalPages} total={total} limit={limit} onPageChange={setPage} onLimitChange={(n) => { setLimit(n); setPage(1); }} />
      </div>
    </div>
  );
}
