"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { teamApi, employeeApi } from "@/lib/api";
import {
  Plus, Search, Trash2, Edit, X, Loader2, UsersRound, Users, UserPlus,
  Eye
} from "lucide-react";
import { formatDate, cn, getInitials } from "@/lib/utils";
import { toast } from "sonner";
import { Pagination } from "@/components/ui/Pagination";


const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-500/10 text-success",
  inactive: "bg-elevated text-body",
  suspended: "bg-red-500/10 text-danger",
};

export default function TeamsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [showForm, setShowForm] = useState(false);
  const [editTeam, setEditTeam] = useState<any>(null);
  const [form, setForm] = useState({ name: "", description: "" });
  const [deleteIds, setDeleteIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [membersTeam, setMembersTeam] = useState<any>(null);
  const [assignModal, setAssignModal] = useState<any>(null);
  const [selectedEmps, setSelectedEmps] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ["teams", search],
    queryFn: () => teamApi.list({ search: search || undefined }),
  });

  const { data: membersData, isLoading: membersLoading } = useQuery({
    queryKey: ["team-members", membersTeam?.id],
    queryFn: () => teamApi.members(membersTeam.id),
    enabled: !!membersTeam,
  });

  const { data: empsData } = useQuery({
    queryKey: ["all-employees-assign"],
    queryFn: () => employeeApi.list({ limit: 200, status: "active" }),
    enabled: !!assignModal,
  });

  const createMut = useMutation({
    mutationFn: teamApi.create,
    onSuccess: () => { toast.success("Team created"); qc.invalidateQueries({ queryKey: ["teams"] }); closeForm(); },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Failed"),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => teamApi.update(id, data),
    onSuccess: () => { toast.success("Team updated"); qc.invalidateQueries({ queryKey: ["teams"] }); closeForm(); },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Failed"),
  });

  const deleteMut = useMutation({
    mutationFn: (ids: string[]) => Promise.all(ids.map(id => teamApi.delete(id))),
    onSuccess: () => {
      toast.success("Deleted successfully");
      qc.invalidateQueries({ queryKey: ["teams"] });
      setDeleteIds([]);
      setSelected(new Set());
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Failed"),
  });

  const assignMut = useMutation({
    mutationFn: ({ id, ids }: { id: string; ids: string[] }) =>
      teamApi.assignEmployees(id, { employee_ids: ids }),
    onSuccess: () => {
      toast.success("Team members updated");
      qc.invalidateQueries({ queryKey: ["team-members"] });
      qc.invalidateQueries({ queryKey: ["teams"] });
      setAssignModal(null);
      setSelectedEmps(new Set());
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Failed"),
  });

  const removeMut = useMutation({
    mutationFn: ({ teamId, empId }: { teamId: string; empId: string }) =>
      teamApi.removeEmployee(teamId, empId),
    onSuccess: () => {
      toast.success("Employee removed from team");
      qc.invalidateQueries({ queryKey: ["team-members"] });
      qc.invalidateQueries({ queryKey: ["teams"] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Failed"),
  });

  const allTeams = Array.isArray(data?.data?.data) ? data.data.data : (data?.data?.teams ?? []);
  const members = Array.isArray(membersData?.data?.data) ? membersData.data.data : (membersData?.data?.members ?? []);
  const allEmps = Array.isArray(empsData?.data?.data) ? empsData.data.data : (empsData?.data?.employees ?? []);

  // Backend returns all teams unpaginated — filter and page on the client.
  const filteredTeams = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allTeams;
    return allTeams.filter((t: any) =>
      `${t.name ?? ""} ${t.description ?? ""}`.toLowerCase().includes(q)
    );
  }, [allTeams, search]);

  const total = filteredTeams.length;
  const totalPages = Math.ceil(total / limit);
  const teams = filteredTeams.slice((page - 1) * limit, page * limit);

  const closeForm = () => { setShowForm(false); setEditTeam(null); setForm({ name: "", description: "" }); };
  const openEdit = (t: any) => { setEditTeam(t); setForm({ name: t.name, description: t.description ?? "" }); setShowForm(true); };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editTeam) updateMut.mutate({ id: editTeam.id, data: form });
    else createMut.mutate(form);
  };

  const openAssign = (team: any) => {
    setAssignModal(team);
    setSelectedEmps(new Set());
  };

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const toggleAll = () => {
    if (selected.size === teams.length) setSelected(new Set());
    else setSelected(new Set(teams.map((t: any) => t.id)));
  };

  const isPending = createMut.isPending || updateMut.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Teams</h2>
          <p className="text-sm text-muted-foreground mt-1">{total} total teams</p>
        </div>
        <button
          onClick={() => { setEditTeam(null); setForm({ name: "", description: "" }); setShowForm(true); }}
          className="flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-on-brand px-4 py-2 rounded-lg text-sm font-medium"
        >
          <Plus className="w-4 h-4" /> New Team
        </button>
      </div>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div className="bg-brand-500/10 border border-brand-500/30 rounded-xl px-4 py-3 flex items-center gap-3">
          <span className="text-sm text-brand-500 font-medium">{selected.size} selected</span>
          <button
            onClick={() => setDeleteIds([...selected])}
            className="flex items-center gap-1.5 text-sm text-danger hover:text-danger"
          >
            <Trash2 className="w-4 h-4" /> Delete selected
          </button>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-xs text-brand-500 hover:text-brand-400">Clear</button>
        </div>
      )}

      <div className="bg-card rounded-xl border border-border shadow-sm">
        {/* Filters */}
        <div className="p-4 border-b border-border flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle" />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search teams..."
              className="pl-9 pr-3 py-2 bg-background border border-border rounded-lg text-sm w-full text-foreground placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={selected.size === teams.length && teams.length > 0}
                    onChange={toggleAll}
                    className="rounded border-border-strong"
                  />
                </th>
                <th className="px-4 py-3 text-left font-medium">Team</th>
                <th className="px-4 py-3 text-left font-medium">Description</th>
                <th className="px-4 py-3 text-left font-medium">Members</th>
                <th className="px-4 py-3 text-left font-medium">Created</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-elevated">
              {isLoading ? (
                [...Array(6)].map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {[...Array(6)].map((__, j) => (
                      <td key={j} className="px-4 py-4"><div className="h-4 bg-elevated rounded w-3/4" /></td>
                    ))}
                  </tr>
                ))
              ) : teams.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-subtle">
                    <UsersRound className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No teams found
                  </td>
                </tr>
              ) : (
                teams.map((team: any) => (
                  <tr key={team.id} className="hover:bg-elevated transition-colors">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(team.id)}
                        onChange={() => toggleSelect(team.id)}
                        className="rounded border-border-strong"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-brand-500/10 flex items-center justify-center text-brand-500 flex-shrink-0">
                          <UsersRound className="w-4 h-4" />
                        </div>
                        <div>
                          <p className="font-medium text-foreground">{team.name}</p>
                          <p className="text-xs text-subtle">ID {team.id?.slice(0, 8)}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-body max-w-xs truncate">{team.description || "—"}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-elevated text-body">
                        <Users className="w-3 h-3" />
                        {team.member_count ?? 0}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-subtle">{formatDate(team.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setMembersTeam(team)}
                          title="View team employees"
                          className="p-1.5 hover:bg-elevated rounded text-subtle hover:text-body"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => openAssign(team)}
                          title="Manage members"
                          className="p-1.5 hover:bg-brand-500/10 rounded text-subtle hover:text-brand-500"
                        >
                          <UserPlus className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => openEdit(team)}
                          title="Edit team"
                          className="p-1.5 hover:bg-elevated rounded text-subtle hover:text-body"
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteIds([team.id])}
                          title="Delete team"
                          className="p-1.5 hover:bg-red-500/10 rounded text-subtle hover:text-danger"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
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

      {/* Team employees modal */}
      {membersTeam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-card rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-brand-500/10 flex items-center justify-center text-brand-500">
                  <UsersRound className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">{membersTeam.name}</h3>
                  <p className="text-xs text-muted-foreground">{members.length} employees in this team</p>
                </div>
              </div>
              <button onClick={() => setMembersTeam(null)} className="text-subtle hover:text-body"><X className="w-5 h-5" /></button>
            </div>

            <div className="flex-1 overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-6 py-3 text-left font-medium">Employee</th>
                    <th className="px-4 py-3 text-left font-medium">Department</th>
                    <th className="px-4 py-3 text-left font-medium">Title</th>
                    <th className="px-4 py-3 text-left font-medium">Status</th>
                    <th className="px-4 py-3 text-left font-medium">Joined</th>
                    <th className="px-6 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-elevated">
                  {membersLoading ? (
                    [...Array(4)].map((_, i) => (
                      <tr key={i} className="animate-pulse">
                        {[...Array(6)].map((__, j) => (
                          <td key={j} className="px-4 py-4"><div className="h-4 bg-elevated rounded w-3/4" /></td>
                        ))}
                      </tr>
                    ))
                  ) : members.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-12 text-subtle">
                        <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        No employees in this team yet
                      </td>
                    </tr>
                  ) : (
                    members.map((m: any) => (
                      <tr key={m.id} className="hover:bg-elevated transition-colors">
                        <td className="px-6 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-brand-500/10 flex items-center justify-center text-brand-500 text-xs font-bold flex-shrink-0">
                              {getInitials(`${m.first_name} ${m.last_name}`)}
                            </div>
                            <div>
                              <p className="font-medium text-foreground">{m.first_name} {m.last_name}</p>
                              <p className="text-xs text-subtle">{m.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-body">{m.department || "—"}</td>
                        <td className="px-4 py-3 text-body">{m.job_title || "—"}</td>
                        <td className="px-4 py-3">
                          <span className={cn("px-2.5 py-1 rounded-full text-xs font-medium", STATUS_COLORS[m.status] ?? "bg-elevated text-body")}>
                            {m.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-subtle">{formatDate(m.created_at)}</td>
                        <td className="px-6 py-3">
                          <div className="flex items-center justify-end">
                            <button
                              onClick={() => removeMut.mutate({ teamId: membersTeam.id, empId: m.id })}
                              disabled={removeMut.isPending}
                              title="Remove from team"
                              className="p-1.5 hover:bg-red-500/10 rounded text-subtle hover:text-danger disabled:opacity-50"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="px-6 py-4 border-t border-border flex gap-3">
              <button onClick={() => setMembersTeam(null)} className="flex-1 border border-border text-body py-2 rounded-lg text-sm hover:bg-elevated">Close</button>
              <button
                onClick={() => { openAssign(membersTeam); setMembersTeam(null); }}
                className="flex-1 bg-brand-500 text-on-brand py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2"
              >
                <UserPlus className="w-4 h-4" /> Add Members
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create/Edit Team Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-card rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="font-semibold text-foreground">{editTeam ? "Edit Team" : "New Team"}</h3>
              <button onClick={closeForm} className="text-subtle hover:text-body"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-body mb-1">Team Name *</label>
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-body mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  rows={3}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
                />
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={closeForm} className="flex-1 border border-border text-body py-2 rounded-lg text-sm hover:bg-elevated">Cancel</button>
                <button type="submit" disabled={isPending}
                  className="flex-1 bg-brand-500 text-on-brand py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60">
                  {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  {editTeam ? "Save" : "Create Team"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Assign Members Modal */}
      {assignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-card rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="font-semibold text-foreground">Manage: {assignModal.name}</h3>
              <button onClick={() => setAssignModal(null)} className="text-subtle hover:text-body"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <p className="text-xs text-muted-foreground mb-3">Select employees to add to this team:</p>
              <div className="space-y-2">
                {allEmps.map((emp: any) => (
                  <label key={emp.id} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-elevated cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedEmps.has(emp.id)}
                      onChange={() => {
                        setSelectedEmps(prev => {
                          const n = new Set(prev);
                          n.has(emp.id) ? n.delete(emp.id) : n.add(emp.id);
                          return n;
                        });
                      }}
                      className="rounded border-border-strong"
                    />
                    <div className="w-7 h-7 rounded-full bg-brand-500/10 flex items-center justify-center text-brand-500 text-[10px] font-bold">
                      {getInitials(`${emp.first_name} ${emp.last_name}`)}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-body">{emp.first_name} {emp.last_name}</p>
                      <p className="text-xs text-subtle">{emp.department || emp.email}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
            <div className="px-6 py-4 border-t border-border flex gap-3">
              <button onClick={() => setAssignModal(null)} className="flex-1 border border-border text-body py-2 rounded-lg text-sm">Cancel</button>
              <button
                onClick={() => assignMut.mutate({ id: assignModal.id, ids: [...selectedEmps] })}
                disabled={selectedEmps.size === 0 || assignMut.isPending}
                className="flex-1 bg-brand-500 text-on-brand py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {assignMut.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Add {selectedEmps.size > 0 ? `${selectedEmps.size} ` : ""}Members
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteIds.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-card rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="w-12 h-12 bg-red-500/10 rounded-xl flex items-center justify-center mx-auto mb-4">
              <Trash2 className="w-5 h-5 text-danger" />
            </div>
            <h3 className="text-center font-semibold text-foreground mb-2">Delete {deleteIds.length > 1 ? `${deleteIds.length} teams` : "team"}?</h3>
            <p className="text-center text-sm text-muted-foreground mb-6">Employees in {deleteIds.length > 1 ? "these teams" : "this team"} will be unassigned, not deleted.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteIds([])} className="flex-1 border border-border text-body py-2 rounded-lg text-sm">Cancel</button>
              <button
                onClick={() => deleteMut.mutate(deleteIds)}
                disabled={deleteMut.isPending}
                className="flex-1 bg-red-600 text-white py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {deleteMut.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
