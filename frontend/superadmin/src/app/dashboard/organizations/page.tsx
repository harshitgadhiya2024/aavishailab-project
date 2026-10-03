"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { orgApi } from "@/lib/api";
import {
  Plus, Search, Building2, Trash2, Edit, X, Loader2, ChevronRight, Laptop,
} from "lucide-react";
import { formatDate, cn, PLAN_LABELS, STATUS_STYLES, timeAgo } from "@/lib/utils";
import { toast } from "sonner";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";

const PLAN_COLORS: Record<string, string> = {
  trial: "bg-sky-500/10 text-sky-400",
  starter: "bg-muted text-muted-foreground",
  professional: "bg-brand-500/10 text-brand-500",
  enterprise: "bg-purple-500/10 text-purple-400",
};

const STATUS_FILTERS = [
  { value: "", label: "All" },
  { value: "active", label: "Active" },
  { value: "trial", label: "Trial" },
  { value: "suspended", label: "Suspended" },
  { value: "inactive", label: "Inactive" },
];

type OrgFormData = {
  name: string;
  domain: string;
  plan: string;
  status: string;
  trial_ends_at: string;
  max_users: number;
  admin_email: string;
  admin_password: string;
  admin_first_name: string;
  admin_last_name: string;
};

const DEFAULT_FORM: OrgFormData = {
  name: "",
  domain: "",
  plan: "starter",
  status: "",
  trial_ends_at: "",
  max_users: 50,
  admin_email: "",
  admin_password: "",
  admin_first_name: "",
  admin_last_name: "",
};

export default function OrganizationsPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [plan, setPlan] = useState("");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [showModal, setShowModal] = useState(false);
  const [editOrg, setEditOrg] = useState<any>(null);
  const [form, setForm] = useState<OrgFormData>(DEFAULT_FORM);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["orgs", page, limit, search, status, plan, sort],
    queryFn: () => orgApi.list({ page, limit, search, status, plan, sort }),
    staleTime: 10_000,
  });

  const createMut = useMutation({
    mutationFn: orgApi.create,
    onSuccess: () => {
      toast.success("Organization created");
      qc.invalidateQueries({ queryKey: ["orgs"] });
      setShowModal(false);
      setForm(DEFAULT_FORM);
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Failed to create"),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => orgApi.update(id, data),
    onSuccess: () => {
      toast.success("Organization updated");
      qc.invalidateQueries({ queryKey: ["orgs"] });
      setShowModal(false);
      setEditOrg(null);
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Failed to update"),
  });

  const deleteMut = useMutation({
    mutationFn: orgApi.delete,
    onSuccess: () => {
      toast.success("Organization deleted");
      qc.invalidateQueries({ queryKey: ["orgs"] });
      setDeleteId(null);
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Failed to delete"),
  });

  const orgs = data?.data?.organizations ?? [];
  const total = data?.data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  const openCreate = () => {
    setEditOrg(null);
    setForm(DEFAULT_FORM);
    setShowModal(true);
  };

  const openEdit = (org: any) => {
    setEditOrg(org);
    setForm({
      name: org.name,
      domain: org.domain,
      plan: org.plan,
      status: org.status,
      trial_ends_at: org.trial_ends_at ? new Date(org.trial_ends_at).toLocaleDateString("en-CA") : "",
      max_users: org.max_users,
      admin_email: "",
      admin_password: "",
      admin_first_name: "",
      admin_last_name: "",
    });
    setShowModal(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editOrg) {
      updateMut.mutate({
        id: editOrg.id,
        data: {
          name: form.name, domain: form.domain, plan: form.plan, status: form.status, max_users: form.max_users,
          ...(form.status === "trial" && form.trial_ends_at ? { trial_ends_at: form.trial_ends_at } : {}),
        },
      });
    } else {
      createMut.mutate(form);
    }
  };

  const isPending = createMut.isPending || updateMut.isPending;

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">Organizations</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {total} customer{total === 1 ? "" : "s"} · seats, devices and activity at a glance
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-brand-600"
        >
          <Plus className="h-4 w-4" />
          New organization
        </button>
      </div>

      <div className="rounded-xl border border-border bg-card">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
          <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search name, domain or email"
              className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div className="flex rounded-lg border border-border p-0.5 text-xs">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => { setStatus(f.value); setPage(1); }}
                className={cn("rounded-md px-3 py-1.5 font-medium", status === f.value ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {f.label}
              </button>
            ))}
          </div>
          <select
            value={plan}
            onChange={(e) => { setPlan(e.target.value); setPage(1); }}
            className="rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500"
            aria-label="Plan"
          >
            <option value="">All plans</option>
            {Object.entries(PLAN_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select
            value={sort}
            onChange={(e) => { setSort(e.target.value); setPage(1); }}
            className="ml-auto rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500"
            aria-label="Sort"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="name">Name A–Z</option>
            <option value="trial_ending">Trial ending soonest</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3 font-medium">Organization</th>
                <th className="px-5 py-3 font-medium">Plan & status</th>
                <th className="px-5 py-3 font-medium">Seats</th>
                <th className="px-5 py-3 font-medium">Devices</th>
                <th className="px-5 py-3 font-medium">Last active</th>
                <th className="px-5 py-3 font-medium">Created</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {[...Array(7)].map((__, j) => (
                      <td key={j} className="px-5 py-4"><div className="h-4 w-3/4 rounded bg-muted" /></td>
                    ))}
                  </tr>
                ))
              ) : orgs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-14 text-center text-muted-foreground">
                    <Building2 className="mx-auto mb-2 h-8 w-8 opacity-30" />
                    {search || status || plan ? "No organizations match these filters" : "No organizations yet"}
                  </td>
                </tr>
              ) : (
                orgs.map((org: any) => {
                  const st = STATUS_STYLES[org.status] ?? STATUS_STYLES.inactive;
                  const seatsPct = org.max_users > 0 ? Math.min(100, Math.round(((org.employee_count ?? 0) / org.max_users) * 100)) : 0;
                  const trialDays = org.status === "trial" && org.trial_ends_at
                    ? Math.ceil((new Date(org.trial_ends_at).getTime() - Date.now()) / 86_400_000) : null;
                  return (
                    <tr
                      key={org.id}
                      onClick={() => router.push(`/dashboard/organizations/${org.id}`)}
                      className="group cursor-pointer transition-colors hover:bg-muted/60"
                    >
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-sm font-semibold text-brand-500">
                            {org.name?.[0]?.toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-medium text-foreground">{org.name}</p>
                            <p className="truncate text-xs text-muted-foreground">{org.domain || org.contact_email || org.slug}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex flex-col items-start gap-1">
                          <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", PLAN_COLORS[org.plan] ?? "bg-muted text-muted-foreground")}>
                            {PLAN_LABELS[org.plan] ?? org.plan}
                          </span>
                          <span className={cn("inline-flex items-center gap-1.5 text-xs", st.text)}>
                            <span className={cn("h-1.5 w-1.5 rounded-full", st.dot)} />
                            {st.label}
                            {trialDays !== null && (
                              <span className={cn("ml-1", trialDays <= 3 ? "text-yellow-400" : "text-muted-foreground")}>
                                · {trialDays > 0 ? `${trialDays}d left` : "ended"}
                              </span>
                            )}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="w-28">
                          <div className="flex justify-between text-xs">
                            <span className="tabular-nums text-foreground">{org.employee_count ?? 0}</span>
                            <span className="tabular-nums text-muted-foreground">/ {org.max_users}</span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                            <div
                              className={cn("h-full rounded-full", seatsPct >= 100 ? "bg-red-500" : seatsPct >= 80 ? "bg-yellow-500" : "bg-brand-500")}
                              style={{ width: `${seatsPct}%` }}
                            />
                          </div>
                          <p className="mt-1 text-[11px] text-muted-foreground">{org.user_count ?? 0} admin{org.user_count === 1 ? "" : "s"}</p>
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        {(org.device_count ?? 0) === 0 ? (
                          <span className="text-xs text-yellow-400">None connected</span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs">
                            <Laptop className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="tabular-nums text-foreground">{org.device_count}</span>
                            <span className={cn("tabular-nums", org.online_count > 0 ? "text-green-400" : "text-muted-foreground")}>
                              · {org.online_count ?? 0} online
                            </span>
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-xs text-muted-foreground">{timeAgo(org.last_seen_at)}</td>
                      <td className="px-5 py-3.5 text-xs text-muted-foreground">{formatDate(org.created_at)}</td>
                      <td className="px-5 py-3.5" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => openEdit(org)} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="Edit" aria-label={`Edit ${org.name}`}>
                            <Edit className="h-4 w-4" />
                          </button>
                          <button onClick={() => setDeleteId(org.id)} className="rounded p-1.5 text-muted-foreground hover:bg-red-500/10 hover:text-red-400" title="Delete" aria-label={`Delete ${org.name}`}>
                            <Trash2 className="h-4 w-4" />
                          </button>
                          <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <Pagination page={page} totalPages={totalPages} total={total} limit={limit} onPageChange={setPage} onLimitChange={n => { setLimit(n); setPage(1); }} />
      </div>

      {/* Create/Edit Modal */}
      <Modal open={showModal} onClose={() => setShowModal(false)}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="font-semibold text-foreground">
                {editOrg ? "Edit Organization" : "New Organization"}
              </h3>
              <button onClick={() => setShowModal(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Organization Name *</label>
                  <input
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full border border-border bg-background rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Domain *</label>
                  <input
                    value={form.domain}
                    onChange={e => setForm(f => ({ ...f, domain: e.target.value }))}
                    placeholder="acme.com"
                    className="w-full border border-border bg-background rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Plan</label>
                  <select
                    value={form.plan}
                    onChange={e => setForm(f => ({ ...f, plan: e.target.value }))}
                    className="w-full border border-border bg-background rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    <option value="trial">Trial</option>
                    <option value="starter">Starter</option>
                    <option value="professional">Professional</option>
                    <option value="enterprise">Enterprise</option>
                  </select>
                </div>
                {editOrg && (
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Status</label>
                    <select
                      value={form.status}
                      onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                      className="w-full border border-border bg-background rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    >
                      {Object.entries(STATUS_STYLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                  </div>
                )}
                {editOrg && form.status === "trial" && (
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Trial ends on</label>
                    <input
                      type="date"
                      value={form.trial_ends_at}
                      onChange={e => setForm(f => ({ ...f, trial_ends_at: e.target.value }))}
                      className="w-full border border-border bg-background rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Seat limit (employees)</label>
                  <input
                    type="number"
                    value={form.max_users}
                    onChange={e => setForm(f => ({ ...f, max_users: Number(e.target.value) }))}
                    className="w-full border border-border bg-background rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    min={1}
                  />
                </div>
              </div>

              {!editOrg && (
                <>
                  <div className="border-t border-border pt-4">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Admin Account</p>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1">First Name *</label>
                        <input
                          value={form.admin_first_name}
                          onChange={e => setForm(f => ({ ...f, admin_first_name: e.target.value }))}
                          className="w-full border border-border bg-background rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1">Last Name *</label>
                        <input
                          value={form.admin_last_name}
                          onChange={e => setForm(f => ({ ...f, admin_last_name: e.target.value }))}
                          className="w-full border border-border bg-background rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1">Admin Email *</label>
                        <input
                          type="email"
                          value={form.admin_email}
                          onChange={e => setForm(f => ({ ...f, admin_email: e.target.value }))}
                          className="w-full border border-border bg-background rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1">Password *</label>
                        <input
                          type="password"
                          value={form.admin_password}
                          onChange={e => setForm(f => ({ ...f, admin_password: e.target.value }))}
                          className="w-full border border-border bg-background rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                          required
                          minLength={8}
                        />
                      </div>
                    </div>
                  </div>
                </>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 border border-border text-muted-foreground py-2 rounded-lg text-sm hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="flex-1 bg-primary text-primary-foreground py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  {editOrg ? "Save Changes" : "Create"}
                </button>
              </div>
            </form>
      </Modal>

      {/* Delete confirm */}
      <Modal open={!!deleteId} onClose={() => setDeleteId(null)} className="max-w-sm">
          <div className="p-6">
            <div className="w-12 h-12 bg-red-500/10 rounded-xl flex items-center justify-center mx-auto mb-4">
              <Trash2 className="w-5 h-5 text-red-400" />
            </div>
            <h3 className="text-center font-semibold text-foreground mb-2">Delete Organization?</h3>
            <p className="text-center text-sm text-muted-foreground mb-6">
              This will deactivate the organization. All data will be retained but access will be revoked.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteId(null)}
                className="flex-1 border border-border text-muted-foreground py-2 rounded-lg text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteId && deleteMut.mutate(deleteId)}
                disabled={deleteMut.isPending}
                className="flex-1 bg-destructive text-destructive-foreground py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {deleteMut.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Delete
              </button>
            </div>
          </div>
      </Modal>
    </div>
  );
}
