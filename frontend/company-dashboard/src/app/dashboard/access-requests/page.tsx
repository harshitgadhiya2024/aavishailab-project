"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Search, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Pagination } from "@/components/ui/Pagination";

import { accessRequestApi } from "@/lib/api";

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-yellow-500/10 text-warning",
  approved: "bg-green-500/10 text-success",
  denied: "bg-red-500/10 text-danger",
};

type AccessRequest = {
  id: string;
  domain: string;
  reason?: string;
  status: string;
  created_at?: string;
  decided_note?: string;
  employee?: { first_name?: string; last_name?: string; email?: string };
  policy?: { name?: string };
};

export default function AccessRequestsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("pending");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);

  const { data, isLoading } = useQuery({
    queryKey: ["access-requests", status],
    queryFn: () => accessRequestApi.list({ status: status || undefined, limit: 200 }),
  });

  const requests: AccessRequest[] = data?.data?.data || [];
  const matching = requests.filter((r) => {
    const haystack = `${r.domain} ${r.employee?.email || ""} ${r.employee?.first_name || ""} ${r.employee?.last_name || ""} ${r.policy?.name || ""}`.toLowerCase();
    return haystack.includes(search.toLowerCase());
  });

  // The endpoint returns the whole queue in one call, so page it here.
  const total = matching.length;
  const totalPages = Math.ceil(total / limit);
  const filtered = matching.slice((page - 1) * limit, page * limit);

  const approve = useMutation({
    mutationFn: (id: string) => accessRequestApi.approve(id),
    onSuccess: () => {
      toast.success("Access request approved");
      qc.invalidateQueries({ queryKey: ["access-requests"] });
    },
    onError: () => toast.error("Could not approve request"),
  });

  const deny = useMutation({
    mutationFn: (id: string) => accessRequestApi.deny(id),
    onSuccess: () => {
      toast.success("Access request denied");
      qc.invalidateQueries({ queryKey: ["access-requests"] });
    },
    onError: () => toast.error("Could not deny request"),
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Access Requests</h2>
        <p className="text-sm text-muted-foreground mt-1">Review employee requests for blocked domains across all policies</p>
      </div>

      <div className="bg-card rounded-xl border border-border p-4 flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
        <div className="flex items-center gap-2 bg-background border border-border rounded-lg px-3 py-2 md:w-96">
          <Search className="w-4 h-4 text-subtle" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search domain, employee, or policy"
            className="bg-transparent outline-none text-sm text-foreground w-full"
          />
        </div>
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground"
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="denied">Denied</option>
        </select>
      </div>

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-5 py-3 text-left font-medium">Domain</th>
              <th className="px-5 py-3 text-left font-medium">Employee</th>
              <th className="px-5 py-3 text-left font-medium">Policy</th>
              <th className="px-5 py-3 text-left font-medium">Reason</th>
              <th className="px-5 py-3 text-left font-medium">Status</th>
              <th className="px-5 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-elevated">
            {isLoading && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
                  Loading requests...
                </td>
              </tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-muted-foreground">No access requests found.</td>
              </tr>
            )}
            {filtered.map((request) => {
              const employee = request.employee
                ? `${request.employee.first_name || ""} ${request.employee.last_name || ""}`.trim() || request.employee.email || "Unknown"
                : "Unknown";
              return (
                <tr key={request.id} className="hover:bg-elevated">
                  <td className="px-5 py-4 font-mono text-body">{request.domain}</td>
                  <td className="px-5 py-4 text-body">{employee}</td>
                  <td className="px-5 py-4 text-muted-foreground">{request.policy?.name || "Policy removed"}</td>
                  <td className="px-5 py-4 text-muted-foreground max-w-xs truncate">{request.reason || "No reason provided"}</td>
                  <td className="px-5 py-4">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_BADGE[request.status] || "bg-elevated text-body"}`}>
                      {request.status}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-right">
                    {request.status === "pending" ? (
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => approve.mutate(request.id)}
                          disabled={approve.isPending || deny.isPending}
                          className="inline-flex items-center gap-1 text-xs text-success hover:text-success disabled:opacity-50"
                        >
                          <Check className="w-3 h-3" /> Approve
                        </button>
                        <button
                          onClick={() => deny.mutate(request.id)}
                          disabled={approve.isPending || deny.isPending}
                          className="inline-flex items-center gap-1 text-xs text-danger hover:text-danger disabled:opacity-50"
                        >
                          <XCircle className="w-3 h-3" /> Deny
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-subtle">Resolved</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <Pagination page={page} totalPages={totalPages} total={total} limit={limit} onPageChange={setPage} onLimitChange={n => { setLimit(n); setPage(1); }} />
      </div>
    </div>
  );
}
