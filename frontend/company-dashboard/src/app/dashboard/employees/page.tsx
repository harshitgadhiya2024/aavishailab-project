"use client";

import { useState, useRef } from "react";
import { keepPreviousData, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { employeeApi, teamApi } from "@/lib/api";
import {
  Plus, Search, Upload, Download, Trash2, Edit,
  X, Loader2, Users, Filter, MoreHorizontal, Eye, Mail, Phone, KeyRound
} from "lucide-react";
import { formatDate, cn, getInitials } from "@/lib/utils";
import { toast } from "sonner";
import { usePermissions, PERMISSIONS } from "@/lib/permissions";
import { Pagination } from "@/components/ui/Pagination";


type EmpFormData = {
  first_name: string;
  last_name: string;
  email: string;
  department: string;
  job_title: string;
  phone: string;
  team_id: string;
  status: string;
};

const EMPTY_FORM: EmpFormData = {
  first_name: "", last_name: "", email: "", department: "",
  job_title: "", phone: "", team_id: "", status: "active",
};

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-500/10 text-success",
  inactive: "bg-elevated text-body",
  suspended: "bg-red-500/10 text-danger",
};

export default function EmployeesPage() {
  const qc = useQueryClient();
  const { can } = usePermissions();
  const canWrite = can(PERMISSIONS.employeesWrite);
  const fileRef = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [statusFilter, setStatusFilter] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [deptFilter, setDeptFilter] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editEmp, setEditEmp] = useState<any>(null);
  const [form, setForm] = useState<EmpFormData>(EMPTY_FORM);
  const [deleteIds, setDeleteIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewEmp, setViewEmp] = useState<any>(null);
  const [portalEmp, setPortalEmp] = useState<any>(null);

  const openPortalPassword = (emp: any) => setPortalEmp(emp);
  const closePortalPassword = () => setPortalEmp(null);

  const { data, isLoading } = useQuery({
    queryKey: ["employees", page, limit, search, statusFilter, teamFilter, deptFilter],
    queryFn: () =>
      employeeApi.list({
        page, limit, search: search || undefined,
        status: statusFilter || undefined,
        team_id: teamFilter || undefined,
        department: deptFilter || undefined,
      }),
    staleTime: 10_000,
    placeholderData: keepPreviousData,
  });

  // "teams" as the first key element, not a standalone name like "teams-list"
  // — the Teams page's create/update/delete mutations invalidate
  // queryKey: ["teams"], which react-query matches by prefix. A differently
  // named key here would sit in its own cache entry forever, showing
  // whatever teams existed the first time this page loaded until its own
  // 30s staleTime happened to expire on a later remount.
  const { data: teamsData } = useQuery({
    queryKey: ["teams", "for-employees"],
    queryFn: () => teamApi.list({ limit: 100 }),
  });

  const { data: deptData } = useQuery({
    queryKey: ["departments"],
    queryFn: employeeApi.departments,
  });

  const createMut = useMutation({
    mutationFn: employeeApi.create,
    onSuccess: () => { toast.success("Employee created"); qc.invalidateQueries({ queryKey: ["employees"] }); closeForm(); },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Failed"),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => employeeApi.update(id, data),
    onSuccess: () => { toast.success("Employee updated"); qc.invalidateQueries({ queryKey: ["employees"] }); closeForm(); },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Failed"),
  });

  const deleteMut = useMutation({
    mutationFn: (ids: string[]) => ids.length === 1 ? employeeApi.delete(ids[0]) : employeeApi.bulkDelete(ids),
    onSuccess: () => {
      toast.success("Deleted successfully");
      qc.invalidateQueries({ queryKey: ["employees"] });
      setDeleteIds([]);
      setSelected(new Set());
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Failed"),
  });

  const importMut = useMutation({
    mutationFn: employeeApi.importCsv,
    onSuccess: (res) => {
      toast.success(`Imported ${res.data?.imported ?? 0} employees`);
      qc.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Import failed"),
  });

  const portalPasswordMut = useMutation({
    mutationFn: (id: string) => employeeApi.resetPortalPassword(id),
    onSuccess: (res) => {
      toast.success(res.data?.message ?? "A new password was emailed to the employee");
      closePortalPassword();
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Failed to reset portal password"),
  });

  const employees = Array.isArray(data?.data?.data) ? data.data.data : (data?.data?.employees ?? []);
  const total = data?.data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);
  const teams = Array.isArray(teamsData?.data?.data) ? teamsData.data.data : (teamsData?.data?.teams ?? []);
  const departments = Array.isArray(deptData?.data) ? deptData.data : (deptData?.data?.departments ?? []);

  const closeForm = () => { setShowForm(false); setEditEmp(null); setForm(EMPTY_FORM); };

  const openCreate = () => { setEditEmp(null); setForm(EMPTY_FORM); setShowForm(true); };
  const openEdit = (emp: any) => {
    setEditEmp(emp);
    setForm({
      first_name: emp.first_name ?? "",
      last_name: emp.last_name ?? "",
      email: emp.email ?? "",
      department: emp.department ?? "",
      job_title: emp.job_title ?? "",
      phone: emp.phone ?? "",
      team_id: emp.team_id ?? "",
      status: emp.status ?? "active",
    });
    setShowForm(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editEmp) updateMut.mutate({ id: editEmp.id, data: form });
    else createMut.mutate(form);
  };

  const handleExport = async () => {
    try {
      const res = await employeeApi.exportCsv();
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url; a.download = "employees.csv"; a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error("Export failed"); }
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) importMut.mutate(file);
    if (fileRef.current) fileRef.current.value = "";
  };

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const toggleAll = () => {
    if (selected.size === employees.length) setSelected(new Set());
    else setSelected(new Set(employees.map((e: any) => e.id)));
  };

  const isPending = createMut.isPending || updateMut.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Employees</h2>
          <p className="text-sm text-muted-foreground mt-1">{total} total employees</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="file" ref={fileRef} accept=".csv" onChange={handleImport} className="hidden" />
          {canWrite && (<>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={importMut.isPending}
            className="flex items-center gap-2 border border-border text-body hover:bg-elevated px-3 py-2 rounded-lg text-sm"
          >
            {importMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Import CSV
          </button>
          <button
            onClick={handleExport}
            className="flex items-center gap-2 border border-border text-body hover:bg-elevated px-3 py-2 rounded-lg text-sm"
          >
            <Download className="w-4 h-4" /> Export CSV
          </button>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-on-brand px-4 py-2 rounded-lg text-sm font-medium"
          >
            <Plus className="w-4 h-4" /> Add Employee
          </button>
          </>)}
        </div>
      </div>

      {/* Bulk actions */}
      {canWrite && selected.size > 0 && (
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
              placeholder="Search employees..."
              className="pl-9 pr-3 py-2 bg-background border border-border rounded-lg text-sm w-full text-foreground placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <select
            value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
            className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="suspended">Suspended</option>
          </select>
          {teams.length > 0 && (
            <select
              value={teamFilter}
              onChange={e => { setTeamFilter(e.target.value); setPage(1); }}
              className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">All Teams</option>
              {teams.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          {departments.length > 0 && (
            <select
              value={deptFilter}
              onChange={e => { setDeptFilter(e.target.value); setPage(1); }}
              className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">All Departments</option>
              {departments.map((d: string) => <option key={d} value={d}>{d}</option>)}
            </select>
          )}
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={selected.size === employees.length && employees.length > 0}
                    onChange={toggleAll}
                    className="rounded border-border-strong"
                  />
                </th>
                <th className="px-4 py-3 text-left font-medium">Employee</th>
                <th className="px-4 py-3 text-left font-medium">Department</th>
                <th className="px-4 py-3 text-left font-medium">Title</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium">Joined</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-elevated">
              {isLoading ? (
                [...Array(6)].map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {[...Array(7)].map((__, j) => (
                      <td key={j} className="px-4 py-4"><div className="h-4 bg-elevated rounded w-3/4" /></td>
                    ))}
                  </tr>
                ))
              ) : employees.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-subtle">
                    <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No employees found
                  </td>
                </tr>
              ) : (
                employees.map((emp: any) => (
                  <tr key={emp.id} className="hover:bg-elevated transition-colors">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(emp.id)}
                        onChange={() => toggleSelect(emp.id)}
                        className="rounded border-border-strong"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-brand-500/10 flex items-center justify-center text-brand-500 text-xs font-bold flex-shrink-0">
                          {getInitials(`${emp.first_name} ${emp.last_name}`)}
                        </div>
                        <div>
                          <p className="font-medium text-foreground">{emp.first_name} {emp.last_name}</p>
                          <p className="text-xs text-subtle">{emp.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-body">{emp.department || "—"}</td>
                    <td className="px-4 py-3 text-body">{emp.job_title || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={cn("px-2.5 py-1 rounded-full text-xs font-medium", STATUS_COLORS[emp.status] ?? "bg-elevated text-body")}>
                        {emp.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-subtle">{formatDate(emp.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setViewEmp(emp)}
                          className="p-1.5 hover:bg-elevated rounded text-subtle hover:text-body"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        {canWrite && (<>
                        <button
                          onClick={() => openPortalPassword(emp)}
                          title="Set portal password"
                          className="p-1.5 hover:bg-brand-500/10 rounded text-subtle hover:text-brand-500"
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => openEdit(emp)}
                          className="p-1.5 hover:bg-elevated rounded text-subtle hover:text-body"
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteIds([emp.id])}
                          className="p-1.5 hover:bg-red-500/10 rounded text-subtle hover:text-danger"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        </>)}
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
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-card rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="font-semibold text-foreground">{editEmp ? "Edit Employee" : "Add Employee"}</h3>
              <button onClick={closeForm} className="text-subtle hover:text-body"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-body mb-1">First Name *</label>
                  <input
                    value={form.first_name}
                    onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-brand-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-body mb-1">Last Name *</label>
                  <input
                    value={form.last_name}
                    onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-brand-500"
                    required
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-body mb-1">Email *</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60"
                    required
                    disabled={!!editEmp}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-body mb-1">Department</label>
                  <input
                    value={form.department}
                    onChange={e => setForm(f => ({ ...f, department: e.target.value }))}
                    list="dept-list"
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  <datalist id="dept-list">
                    {departments.map((d: string) => <option key={d} value={d} />)}
                  </datalist>
                </div>
                <div>
                  <label className="block text-xs font-medium text-body mb-1">Job Title</label>
                  <input
                    value={form.job_title}
                    onChange={e => setForm(f => ({ ...f, job_title: e.target.value }))}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-body mb-1">Phone</label>
                  <input
                    value={form.phone}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-body mb-1">Team</label>
                  <select
                    value={form.team_id}
                    onChange={e => setForm(f => ({ ...f, team_id: e.target.value }))}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    <option value="">No team</option>
                    {teams.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                {editEmp && (
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
              </div>
              {!editEmp && (
                <p className="text-xs text-muted-foreground">
                  A portal password will be generated and emailed to them automatically.
                </p>
              )}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={closeForm} className="flex-1 border border-border text-body py-2 rounded-lg text-sm hover:bg-elevated">Cancel</button>
                <button type="submit" disabled={isPending}
                  className="flex-1 bg-brand-500 text-on-brand py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60">
                  {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  {editEmp ? "Save" : "Add Employee"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* View Modal */}
      {viewEmp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-card rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="font-semibold text-foreground">Employee Details</h3>
              <button onClick={() => setViewEmp(null)} className="text-subtle hover:text-body"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-6 py-5">
              <div className="flex items-center gap-4 mb-5">
                <div className="w-14 h-14 rounded-2xl bg-brand-500 flex items-center justify-center text-white text-xl font-bold">
                  {getInitials(`${viewEmp.first_name} ${viewEmp.last_name}`)}
                </div>
                <div>
                  <p className="text-xl font-semibold text-foreground">{viewEmp.first_name} {viewEmp.last_name}</p>
                  <p className="text-sm text-muted-foreground">{viewEmp.job_title || "Employee"}</p>
                  <span className={cn("inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-medium", STATUS_COLORS[viewEmp.status] ?? "bg-elevated")}>
                    {viewEmp.status}
                  </span>
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-body">
                  <Mail className="w-4 h-4 text-subtle" />{viewEmp.email}
                </div>
                {viewEmp.phone && (
                  <div className="flex items-center gap-2 text-sm text-body">
                    <Phone className="w-4 h-4 text-subtle" />{viewEmp.phone}
                  </div>
                )}
                {viewEmp.department && (
                  <div className="flex items-center gap-2 text-sm text-body">
                    <Users className="w-4 h-4 text-subtle" />{viewEmp.department}
                  </div>
                )}
                <div className="text-xs text-subtle pt-2 border-t border-border">
                  Joined {formatDate(viewEmp.created_at)} · ID {viewEmp.id?.slice(0, 8)}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reset portal password confirm */}
      {portalEmp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-card rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-foreground">Reset Portal Password</h3>
              <button onClick={closePortalPassword} className="text-subtle hover:text-body">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground mb-6">
              A new password will be generated and emailed to{" "}
              <strong className="text-foreground">{portalEmp.first_name} {portalEmp.last_name}</strong>{" "}
              ({portalEmp.email}). Their current portal password stops working immediately.
            </p>
            <div className="flex gap-3">
              <button
                onClick={closePortalPassword}
                className="flex-1 border border-border text-body py-2 rounded-lg text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => portalPasswordMut.mutate(portalEmp.id)}
                disabled={portalPasswordMut.isPending}
                className="flex-1 bg-brand-500 text-on-brand py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {portalPasswordMut.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Send New Password
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
            <h3 className="text-center font-semibold text-foreground mb-2">Delete {deleteIds.length > 1 ? `${deleteIds.length} employees` : "employee"}?</h3>
            <p className="text-center text-sm text-muted-foreground mb-6">This action cannot be undone.</p>
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
