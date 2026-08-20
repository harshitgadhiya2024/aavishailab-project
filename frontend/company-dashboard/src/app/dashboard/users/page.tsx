"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { orgUserApi, teamApi, mfaApi } from "@/lib/api";
import {
  UserPlus, Search, Trash2, Edit, X, Loader2, ShieldCheck, Users as UsersIcon,
  Copy, Check, KeyRound, UserCog, ShieldOff,
} from "lucide-react";
import { formatDate, cn, getInitials } from "@/lib/utils";
import { Pagination } from "@/components/ui/Pagination";
import { usePermissions, PERMISSIONS, ROLE_LABELS } from "@/lib/permissions";
import { toast } from "sonner";

type OrgUser = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  full_name?: string;
  role: string;
  status: string;
  job_title?: string;
  last_login_at?: string | null;
  created_at: string;
  permissions: string[];
  team_ids: string[];
  team_names: string[];
};

const STATUS_STYLES: Record<string, string> = {
  active: "bg-green-500/10 text-success",
  inactive: "bg-elevated text-body",
  suspended: "bg-red-500/10 text-danger",
};

const ROLE_STYLES: Record<string, string> = {
  org_admin: "bg-brand-500/10 text-brand-500",
  manager: "bg-purple-500/10 text-accent-purple",
  analyst: "bg-blue-500/10 text-info",
  read_only: "bg-elevated text-body",
};

const EMPTY_FORM = {
  email: "", first_name: "", last_name: "", job_title: "",
  role: "analyst", password: "", status: "active", team_ids: [] as string[],
};

export default function UsersPage() {
  const qc = useQueryClient();
  const { data: session } = useSession();
  const { can } = usePermissions();
  const myId = (session as any)?.user?.id;
  const canWrite = can(PERMISSIONS.usersWrite);

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [showForm, setShowForm] = useState(false);
  const [editUser, setEditUser] = useState<OrgUser | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [deleteUser, setDeleteUser] = useState<OrgUser | null>(null);
  const [issuedPassword, setIssuedPassword] = useState<{ email: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["org-users", search],
    queryFn: () => orgUserApi.list({ search: search || undefined }),
  });

  const { data: teamsData } = useQuery({
    queryKey: ["teams-for-access"],
    queryFn: () => teamApi.list({ limit: 200 }),
  });

  const { data: mfaPolicyData } = useQuery({
    queryKey: ["org-mfa-policy"],
    queryFn: () => mfaApi.orgPolicy(),
  });
  const mfaPolicy = mfaPolicyData?.data ?? {};
  const mfaByUser: Record<string, boolean> = Object.fromEntries(
    (mfaPolicy.users ?? []).map((u: any) => [u.id, u.mfa_enabled])
  );

  const mfaPolicyMut = useMutation({
    mutationFn: (required: boolean) => mfaApi.setOrgPolicy(required),
    onSuccess: (_res, required) => {
      toast.success(required
        ? "Two-factor authentication is now required for everyone"
        : "Two-factor requirement removed");
      qc.invalidateQueries({ queryKey: ["org-mfa-policy"] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Could not change the setting"),
  });

  const users: OrgUser[] = data?.data?.data ?? [];
  const roleCatalog = data?.data?.roles ?? [];
  const teams = Array.isArray(teamsData?.data?.data) ? teamsData.data.data : (teamsData?.data?.teams ?? []);

  const paged = useMemo(
    () => users.slice((page - 1) * limit, page * limit),
    [users, page, limit]
  );

  const selectedRole = roleCatalog.find((r: any) => r.role === form.role);
  const teamScoped = !!selectedRole?.team_scoped;

  const invalidate = () => qc.invalidateQueries({ queryKey: ["org-users"] });

  const saveMut = useMutation({
    mutationFn: (payload: any) =>
      editUser ? orgUserApi.update(editUser.id, payload) : orgUserApi.create(payload),
    onSuccess: (res) => {
      const temp = res.data?.temporary_password;
      if (temp) {
        setIssuedPassword({ email: form.email, password: temp });
      } else {
        toast.success(editUser ? "Access updated" : "User added");
      }
      invalidate();
      closeForm();
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Failed to save"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => orgUserApi.delete(id),
    onSuccess: () => { toast.success("User removed"); setDeleteUser(null); invalidate(); },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Failed to remove"),
  });

  const closeForm = () => { setShowForm(false); setEditUser(null); setForm(EMPTY_FORM); };

  const openInvite = () => { setEditUser(null); setForm(EMPTY_FORM); setShowForm(true); };

  const openEdit = (user: OrgUser) => {
    setEditUser(user);
    setForm({
      email: user.email,
      first_name: user.first_name ?? "",
      last_name: user.last_name ?? "",
      job_title: user.job_title ?? "",
      role: user.role,
      password: "",
      status: user.status,
      team_ids: user.team_ids ?? [],
    });
    setShowForm(true);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: any = {
      first_name: form.first_name,
      last_name: form.last_name,
      job_title: form.job_title,
      role: form.role,
      team_ids: teamScoped ? form.team_ids : [],
    };
    if (!editUser) {
      payload.email = form.email;
      if (form.password) payload.password = form.password;
    } else {
      payload.status = form.status;
      if (form.password) payload.password = form.password;
    }
    saveMut.mutate(payload);
  };

  const toggleTeam = (id: string) => {
    setForm(f => ({
      ...f,
      team_ids: f.team_ids.includes(id) ? f.team_ids.filter(t => t !== id) : [...f.team_ids, id],
    }));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Team &amp; Access</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Who can sign in to this dashboard, what they can do, and whose people they can see
          </p>
        </div>
        {canWrite && (
          <button
            onClick={openInvite}
            className="flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-on-brand px-4 py-2 rounded-lg text-sm font-medium"
          >
            <UserPlus className="w-4 h-4" /> Add User
          </button>
        )}
      </div>

      {/* Role reference — an admin choosing a role should see what it grants */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {roleCatalog.map((r: any) => (
          <div key={r.role} className="bg-card rounded-xl border border-border p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className={cn("px-2 py-0.5 rounded-md text-xs font-medium", ROLE_STYLES[r.role] ?? "bg-elevated text-body")}>
                {ROLE_LABELS[r.role] ?? r.role}
              </span>
              {r.team_scoped && (
                <span className="text-[10px] text-subtle flex items-center gap-1">
                  <UsersIcon className="w-3 h-3" /> team-scoped
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{r.description}</p>
            <p className="text-[11px] text-subtle mt-2">{r.permissions.length} permissions</p>
          </div>
        ))}
      </div>

      {/* Org-wide second-factor requirement */}
      <div className="bg-card rounded-xl border border-border shadow-sm p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3">
            <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0",
              mfaPolicy.required ? "bg-green-500/10 text-success" : "bg-elevated text-subtle")}>
              {mfaPolicy.required ? <ShieldCheck className="w-5 h-5" /> : <ShieldOff className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="font-semibold text-foreground">Require two-factor authentication</h3>
              <p className="text-sm text-muted-foreground mt-0.5">
                {mfaPolicy.required
                  ? "Everyone must have a second factor to sign in."
                  : "Users choose for themselves whether to add a second factor."}
              </p>
              <p className="text-xs text-subtle mt-1">
                {mfaPolicy.enrolled_users ?? 0} of {mfaPolicy.total_users ?? 0} users enrolled
              </p>
            </div>
          </div>
          {canWrite && (
            <button
              type="button"
              role="switch"
              aria-checked={!!mfaPolicy.required}
              onClick={() => mfaPolicyMut.mutate(!mfaPolicy.required)}
              disabled={mfaPolicyMut.isPending}
              className={cn(
                "relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-60",
                mfaPolicy.required ? "bg-brand-500" : "bg-border-strong"
              )}
            >
              <span className={cn("inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
                mfaPolicy.required ? "translate-x-5" : "translate-x-0.5")} />
            </button>
          )}
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border shadow-sm">
        <div className="p-4 border-b border-border flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle" />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search by name or email..."
              className="pl-9 pr-3 py-2 bg-background border border-border rounded-lg text-sm w-full text-foreground placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3 text-left font-medium">User</th>
                <th className="px-5 py-3 text-left font-medium">Role</th>
                <th className="px-5 py-3 text-left font-medium">Teams</th>
                <th className="px-5 py-3 text-left font-medium">Status</th>
                <th className="px-5 py-3 text-left font-medium">2FA</th>
                <th className="px-5 py-3 text-left font-medium">Last sign-in</th>
                <th className="px-5 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-elevated">
              {isLoading ? (
                [...Array(4)].map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {[...Array(7)].map((__, j) => (
                      <td key={j} className="px-5 py-4"><div className="h-4 bg-elevated rounded w-3/4" /></td>
                    ))}
                  </tr>
                ))
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-subtle text-sm">
                    <UserCog className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No dashboard users found
                  </td>
                </tr>
              ) : (
                paged.map(user => (
                  <tr key={user.id} className="hover:bg-elevated transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-brand-500/10 flex items-center justify-center text-brand-500 text-xs font-bold flex-shrink-0">
                          {getInitials(`${user.first_name} ${user.last_name}`) || user.email[0]?.toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-foreground">
                            {`${user.first_name} ${user.last_name}`.trim() || user.email}
                            {user.id === myId && <span className="ml-2 text-[10px] text-subtle">(you)</span>}
                          </p>
                          <p className="text-xs text-subtle">{user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <span className={cn("px-2.5 py-1 rounded-full text-xs font-medium", ROLE_STYLES[user.role] ?? "bg-elevated text-body")}>
                        {ROLE_LABELS[user.role] ?? user.role}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-xs text-body">
                      {user.role !== "manager" ? (
                        <span className="text-subtle">Whole organization</span>
                      ) : user.team_names.length === 0 ? (
                        <span className="text-warning">No teams assigned</span>
                      ) : (
                        user.team_names.join(", ")
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <span className={cn("px-2.5 py-1 rounded-full text-xs font-medium capitalize", STATUS_STYLES[user.status] ?? "bg-elevated text-body")}>
                        {user.status}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      {mfaByUser[user.id] ? (
                        <span className="inline-flex items-center gap-1 text-xs text-success">
                          <ShieldCheck className="w-3.5 h-3.5" /> On
                        </span>
                      ) : (
                        <span className={cn("inline-flex items-center gap-1 text-xs",
                          mfaPolicy.required ? "text-warning" : "text-subtle")}>
                          <ShieldOff className="w-3.5 h-3.5" /> Off
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-xs text-subtle">
                      {user.last_login_at ? formatDate(user.last_login_at) : "never"}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {canWrite ? (
                          <>
                            <button onClick={() => openEdit(user)} title="Edit access"
                              className="p-1.5 hover:bg-elevated rounded text-subtle hover:text-body">
                              <Edit className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setDeleteUser(user)}
                              disabled={user.id === myId}
                              title={user.id === myId ? "You cannot remove yourself" : "Remove user"}
                              className="p-1.5 hover:bg-red-500/10 rounded text-subtle hover:text-danger disabled:opacity-30 disabled:hover:bg-transparent"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        ) : (
                          <span className="text-xs text-subtle">View only</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <Pagination
          page={page}
          totalPages={Math.ceil(users.length / limit)}
          total={users.length}
          limit={limit}
          onPageChange={setPage}
          onLimitChange={n => { setLimit(n); setPage(1); }}
        />
      </div>

      {/* Add / edit */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-card rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="font-semibold text-foreground">{editUser ? "Edit access" : "Add dashboard user"}</h3>
              <button onClick={closeForm} className="text-subtle hover:text-body"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={submit} className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-body mb-1">First name</label>
                  <input value={form.first_name} onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-body mb-1">Last name</label>
                  <input value={form.last_name} onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-body mb-1">Email *</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    required
                    disabled={!!editUser}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-body mb-1">Job title</label>
                  <input value={form.job_title} onChange={e => setForm(f => ({ ...f, job_title: e.target.value }))}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-body mb-1">Role *</label>
                <select
                  value={form.role}
                  onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  {roleCatalog.map((r: any) => (
                    <option key={r.role} value={r.role}>{ROLE_LABELS[r.role] ?? r.role}</option>
                  ))}
                </select>
                {selectedRole && (
                  <p className="text-xs text-muted-foreground mt-1.5">{selectedRole.description}</p>
                )}
              </div>

              {/* Only a manager's access is narrowed by teams, so the picker
                  appears only for that role instead of sitting there inert. */}
              {teamScoped && (
                <div>
                  <label className="block text-xs font-medium text-body mb-1">
                    Teams this manager owns
                  </label>
                  <p className="text-xs text-muted-foreground mb-2">
                    They will see only these teams&apos; employees, devices and activity.
                    With none selected they see the whole organization.
                  </p>
                  <div className="border border-border rounded-lg max-h-44 overflow-y-auto divide-y divide-elevated">
                    {teams.length === 0 ? (
                      <p className="text-sm text-subtle p-3">No teams yet — create one first.</p>
                    ) : teams.map((t: any) => (
                      <label key={t.id} className="flex items-center gap-3 p-2.5 hover:bg-elevated cursor-pointer">
                        <input
                          type="checkbox"
                          checked={form.team_ids.includes(t.id)}
                          onChange={() => toggleTeam(t.id)}
                          className="rounded border-border-strong"
                        />
                        <span className="text-sm text-body">{t.name}</span>
                        <span className="text-xs text-subtle ml-auto">{t.member_count ?? 0} members</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {editUser && (
                <div>
                  <label className="block text-xs font-medium text-body mb-1">Status</label>
                  <select
                    value={form.status}
                    onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-body mb-1">
                  {editUser ? "Set a new password (optional)" : "Password (leave blank to generate one)"}
                </label>
                <input
                  type="password"
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  placeholder={editUser ? "Unchanged" : "Auto-generated"}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              <div className="flex gap-3 pt-1">
                <button type="button" onClick={closeForm}
                  className="flex-1 border border-border text-body py-2 rounded-lg text-sm hover:bg-elevated">Cancel</button>
                <button type="submit" disabled={saveMut.isPending}
                  className="flex-1 bg-brand-500 text-on-brand py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60">
                  {saveMut.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  {editUser ? "Save changes" : "Add user"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Generated password — shown once */}
      {issuedPassword && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-card rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="w-12 h-12 bg-brand-500/10 rounded-xl flex items-center justify-center mx-auto mb-4">
              <KeyRound className="w-5 h-5 text-brand-500" />
            </div>
            <h3 className="text-center font-semibold text-foreground mb-2">User added</h3>
            <p className="text-center text-sm text-muted-foreground mb-4">
              Share this password with <strong className="text-foreground">{issuedPassword.email}</strong>.
              It is stored only as a hash, so it cannot be shown again.
            </p>
            <div className="flex items-center gap-2 bg-elevated border border-border rounded-lg px-3 py-2 mb-4">
              <code className="flex-1 font-mono text-sm text-foreground break-all">{issuedPassword.password}</code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(issuedPassword.password);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="text-subtle hover:text-brand-500 flex-shrink-0"
              >
                {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            <button
              onClick={() => { setIssuedPassword(null); setCopied(false); }}
              className="w-full bg-brand-500 text-on-brand py-2 rounded-lg text-sm font-medium"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Remove confirm */}
      {deleteUser && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-card rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="w-12 h-12 bg-red-500/10 rounded-xl flex items-center justify-center mx-auto mb-4">
              <Trash2 className="w-5 h-5 text-danger" />
            </div>
            <h3 className="text-center font-semibold text-foreground mb-2">Remove this user?</h3>
            <p className="text-center text-sm text-muted-foreground mb-6">
              <strong className="text-foreground">{deleteUser.email}</strong> will lose access immediately and any
              active session will be signed out.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteUser(null)} className="flex-1 border border-border text-body py-2 rounded-lg text-sm">Cancel</button>
              <button
                onClick={() => deleteMut.mutate(deleteUser.id)}
                disabled={deleteMut.isPending}
                className="flex-1 bg-red-600 text-white py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {deleteMut.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Remove
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-brand-500/10 border border-brand-500/30 rounded-xl p-4 flex items-start gap-3">
        <ShieldCheck className="w-4 h-4 text-brand-500 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-muted-foreground">
          These roles control the <strong className="text-foreground">dashboard</strong>. They are separate from
          Employees, who are the people whose devices this platform monitors.
        </p>
      </div>
    </div>
  );
}
