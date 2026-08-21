"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { orgApi } from "@/lib/api";
import {
  Plus, Search, MoreHorizontal, Building2, Users, Shield, Trash2,
  Edit, Eye, X, Loader2, Check
} from "lucide-react";
import { formatDate, formatNumber, cn } from "@/lib/utils";
import { toast } from "sonner";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";

const PLAN_LABELS: Record<string, string> = {
  starter: "Starter",
  professional: "Professional",
  enterprise: "Enterprise",
};
const PLAN_COLORS: Record<string, string> = {
  starter: "bg-muted text-muted-foreground",
  professional: "bg-brand-500/10 text-brand-500",
  enterprise: "bg-purple-500/10 text-purple-400",
};

type OrgFormData = {
  name: string;
  domain: string;
  plan: string;
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
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [showModal, setShowModal] = useState(false);
  const [editOrg, setEditOrg] = useState<any>(null);
  const [form, setForm] = useState<OrgFormData>(DEFAULT_FORM);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["orgs", page, limit, search],
    queryFn: () => orgApi.list({ page, limit, search }),
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
      updateMut.mutate({ id: editOrg.id, data: { name: form.name, domain: form.domain, plan: form.plan, max_users: form.max_users } });
    } else {
      createMut.mutate(form);
    }
  };

  const isPending = createMut.isPending || updateMut.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Organizations</h2>
          <p className="text-sm text-muted-foreground mt-1">Manage all tenant organizations</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 bg-primary hover:bg-brand-600 text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Organization
        </button>
      </div>

      {/* Search */}
      <div className="bg-card rounded-xl border border-border shadow-sm">
        <div className="p-4 border-b border-border">
          <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search organizations..."
              className="pl-9 pr-4 py-2 border border-border bg-background rounded-lg text-sm w-full focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground text-xs uppercase tracking-wide">
                <th className="text-left px-5 py-3 font-medium">Organization</th>
                <th className="text-left px-5 py-3 font-medium">Domain</th>
                <th className="text-left px-5 py-3 font-medium">Plan</th>
                <th className="text-left px-5 py-3 font-medium">Users</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
                <th className="text-left px-5 py-3 font-medium">Created</th>
                <th className="text-right px-5 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {[...Array(7)].map((__, j) => (
                      <td key={j} className="px-5 py-4">
                        <div className="h-4 bg-muted rounded w-3/4" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : orgs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-[#6B6B6B]">
                    <Building2 className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No organizations found
                  </td>
                </tr>
              ) : (
                orgs.map((org: any) => (
                  <tr key={org.id} className="hover:bg-muted transition-colors">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-brand-500/10 rounded-lg flex items-center justify-center">
                          <Building2 className="w-4 h-4 text-brand-500" />
                        </div>
                        <div>
                          <p className="font-medium text-foreground">{org.name}</p>
                          <p className="text-xs text-[#6B6B6B]">{org.id?.slice(0, 8)}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-muted-foreground">{org.domain}</td>
                    <td className="px-5 py-4">
                      <span className={cn("px-2.5 py-1 rounded-full text-xs font-medium", PLAN_COLORS[org.plan] ?? "bg-muted text-muted-foreground")}>
                        {PLAN_LABELS[org.plan] ?? org.plan}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <span className="text-muted-foreground">{formatNumber(org.user_count ?? 0)}</span>
                      <span className="text-[#6B6B6B]">/{formatNumber(org.max_users)}</span>
                    </td>
                    <td className="px-5 py-4">
                      <span className={cn(
                        "flex items-center gap-1.5 text-xs font-medium",
                        org.is_active ? "text-green-400" : "text-red-400"
                      )}>
                        <span className={cn("w-1.5 h-1.5 rounded-full", org.is_active ? "bg-green-500" : "bg-red-400")} />
                        {org.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-muted-foreground text-xs">{formatDate(org.created_at)}</td>
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => router.push(`/dashboard/organizations/${org.id}`)}
                          className="p-1.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground"
                          title="View details"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => openEdit(org)}
                          className="p-1.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground"
                          title="Edit"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeleteId(org.id)}
                          className="p-1.5 hover:bg-red-500/10 rounded text-muted-foreground hover:text-red-400"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
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
                    <option value="starter">Starter</option>
                    <option value="professional">Professional</option>
                    <option value="enterprise">Enterprise</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Max Users</label>
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
