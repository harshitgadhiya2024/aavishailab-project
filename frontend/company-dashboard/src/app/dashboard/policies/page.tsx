"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { policyApi, teamApi, employeeApi, swgApi } from "@/lib/api";
import {
  Plus, Search, Trash2, Edit, X, Loader2, FileText, Copy,
  Download, Upload, Users, ChevronLeft, ChevronRight,
  Shield, Globe, Clock, Tag, Building2, UserRound, Eye
} from "lucide-react";
import { formatDate, cn } from "@/lib/utils";
import { toast } from "sonner";
import { usePermissions, PERMISSIONS } from "@/lib/permissions";
import { Pagination } from "@/components/ui/Pagination";
import {
  POLICY_TYPE_LABELS,
  formToApiPayload,
  apiToForm,
  policyTypeLabel,
  policyTargetLabel,
  UI_TO_API_TYPE,
  API_TO_UI_TYPE,
  DLP_DETECTORS,
  DLP_BYPASS_FILE_TYPES,
  DOMAIN_CONDITION_TYPES,
  WEBSITE_BLOCKING_UI_TYPES,
  EMPTY_DLP_FORM,
  EMPTY_TARGET,
  type PolicyFormData,
  type PolicyCondition,
  type DLPCustomPattern,
} from "@/lib/policies";

const EMPTY_FORM: PolicyFormData = {
  name: "",
  description: "",
  policy_type: "network",
  priority: 50,
  conditions: [{ type: "domain", operator: "matches", value: "" }],
  conditionTab: "domain",
  domainConditions: [{ type: "domain", operator: "matches", value: "" }],
  categoryConditions: [],
  actions: ["block"],
  dlp: EMPTY_DLP_FORM,
  target: EMPTY_TARGET,
};

const POLICY_TYPE_ICONS_MAP: Record<string, React.ElementType> = {
  web_filter: Globe,
  application_control: Shield,
  time_restriction: Clock,
  dlp: Tag,
  network: Shield,
};

const CONDITION_TYPES = ["domain", "category", "url_pattern", "application", "time_range", "user_group"];
const OPERATORS = ["matches", "contains", "equals", "starts_with", "ends_with", "not_matches"];
const ACTIONS = ["block", "alert", "allow", "log"];

const ACTION_BADGE: Record<string, string> = {
  block: "bg-red-500/10 text-danger",
  alert: "bg-yellow-500/10 text-warning",
  allow: "bg-green-500/10 text-success",
};


export default function PoliciesPage() {
  const qc = useQueryClient();
  const { can } = usePermissions();
  const canWrite = can(PERMISSIONS.policiesWrite);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [showForm, setShowForm] = useState(false);
  const [editPolicy, setEditPolicy] = useState<any>(null);
  const [form, setForm] = useState<PolicyFormData>(EMPTY_FORM);
  const [wizardStep, setWizardStep] = useState(1);
  const [deleteIds, setDeleteIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importInput, setImportInput] = useState(false);
  const [importText, setImportText] = useState("");
  const [detailsPolicy, setDetailsPolicy] = useState<any>(null);
  const [empSearch, setEmpSearch] = useState("");
  const [empDeptFilter, setEmpDeptFilter] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["policies", page, search, typeFilter, statusFilter],
    queryFn: () =>
      policyApi.list({
        page,
        limit: limit,
        search: search || undefined,
        type: typeFilter ? UI_TO_API_TYPE[typeFilter] || typeFilter : undefined,
        enabled: statusFilter || undefined,
      }),
  });

  // "teams" as the first key element so this participates in the same
  // invalidation family as the Teams page's create/update/delete mutations
  // (which invalidate queryKey: ["teams"]) — see employees/page.tsx for the
  // full reasoning.
  const { data: teamsData } = useQuery({
    queryKey: ["teams", "assign"],
    queryFn: () => teamApi.list({ limit: 100 }),
    enabled: showForm && form.target.scope === "team",
  });

  const { data: employeesData } = useQuery({
    queryKey: ["employees-for-policy", empSearch, empDeptFilter],
    queryFn: () => employeeApi.list({ limit: 200, search: empSearch || undefined, department: empDeptFilter || undefined }),
    enabled: showForm && form.target.scope === "employee",
  });

  const { data: deptData } = useQuery({
    queryKey: ["departments"],
    queryFn: employeeApi.departments,
    enabled: showForm && form.target.scope === "employee",
  });

  const { data: categoriesData } = useQuery({
    queryKey: ["swg-categories-for-policy"],
    queryFn: swgApi.categories,
    enabled: showForm,
  });

  const { data: resolvedDomainsData, isLoading: domainsLoading } = useQuery({
    queryKey: ["policy-resolved-domains", detailsPolicy?.id],
    queryFn: () => policyApi.resolvedDomains(detailsPolicy.id),
    enabled: !!detailsPolicy,
  });

  const createMut = useMutation({
    mutationFn: policyApi.create,
    onSuccess: () => { toast.success("Policy created"); qc.invalidateQueries({ queryKey: ["policies"] }); closeForm(); },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Failed"),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => policyApi.update(id, data),
    onSuccess: () => { toast.success("Policy updated"); qc.invalidateQueries({ queryKey: ["policies"] }); closeForm(); },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Failed"),
  });

  const deleteMut = useMutation({
    mutationFn: (ids: string[]) => Promise.all(ids.map(id => policyApi.delete(id))),
    onSuccess: () => {
      toast.success("Deleted successfully");
      qc.invalidateQueries({ queryKey: ["policies"] });
      setDeleteIds([]);
      setSelected(new Set());
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Failed"),
  });

  const toggleMut = useMutation({
    mutationFn: policyApi.toggle,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["policies"] }),
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Failed"),
  });

  const dupMut = useMutation({
    mutationFn: policyApi.duplicate,
    onSuccess: () => { toast.success("Policy duplicated"); qc.invalidateQueries({ queryKey: ["policies"] }); },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Failed"),
  });

  const importMut = useMutation({
    mutationFn: (data: any[]) => policyApi.importJson(data),
    onSuccess: (res) => {
      toast.success(`Imported ${res.data?.created ?? 0} policies`);
      qc.invalidateQueries({ queryKey: ["policies"] });
      setImportInput(false);
      setImportText("");
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Import failed"),
  });

  const policies = Array.isArray(data?.data?.data) ? data.data.data : (data?.data?.policies ?? []);
  const total = data?.data?.total ?? policies.length;
  const totalPages = Math.ceil(total / limit);
  // Only the row being toggled should show as busy, not every switch on the page.
  const togglingId = toggleMut.isPending ? (toggleMut.variables as string) : null;
  const teams = Array.isArray(teamsData?.data?.data) ? teamsData.data.data : (teamsData?.data?.teams ?? []);
  const employees = Array.isArray(employeesData?.data?.data) ? employeesData.data.data : (employeesData?.data?.employees ?? []);
  const departments = Array.isArray(deptData?.data) ? deptData.data : (deptData?.data?.departments ?? []);
  const categories = Array.isArray(categoriesData?.data) ? categoriesData.data : (categoriesData?.data?.categories ?? []);
  const resolvedDomains: string[] = resolvedDomainsData?.data?.domains ?? [];

  const closeForm = () => { setShowForm(false); setEditPolicy(null); setForm(EMPTY_FORM); setWizardStep(1); setEmpSearch(""); setEmpDeptFilter(""); };

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const toggleAll = () => {
    if (selected.size === policies.length) setSelected(new Set());
    else setSelected(new Set(policies.map((p: any) => p.id)));
  };

  const openEdit = (p: any) => {
    setEditPolicy(p);
    setForm(apiToForm(p));
    setWizardStep(1);
    setShowForm(true);
  };

  const handleSubmit = () => {
    const payload = formToApiPayload(form);
    if (editPolicy) updateMut.mutate({ id: editPolicy.id, data: payload });
    else createMut.mutate(payload);
  };

  const handleExport = async (id: string) => {
    try {
      const res = await policyApi.get(id);
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${res.data?.name || "policy"}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Export failed");
    }
  };

  const handleImport = () => {
    try {
      const parsed = JSON.parse(importText);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      importMut.mutate(
        arr.map((item) => (item.type ? item : formToApiPayload(apiToForm(item))))
      );
    } catch {
      toast.error("Invalid JSON format");
    }
  };

  // ── Generic conditions builder (non-website, non-DLP types) ────────────────
  const addCondition = () => {
    setForm(f => ({ ...f, conditions: [...f.conditions, { type: "domain", operator: "matches", value: "" }] }));
  };
  const removeCondition = (i: number) => {
    setForm(f => ({ ...f, conditions: f.conditions.filter((_, j) => j !== i) }));
  };
  const updateCondition = (i: number, key: keyof PolicyCondition, val: string) => {
    setForm(f => ({ ...f, conditions: f.conditions.map((c, j) => j === i ? { ...c, [key]: val } : c) }));
  };

  // ── Domain tab (website-blocking types) ─────────────────────────────────────
  const addDomainCondition = () => {
    setForm(f => ({ ...f, domainConditions: [...f.domainConditions, { type: "domain", operator: "matches", value: "" }] }));
  };
  const removeDomainCondition = (i: number) => {
    setForm(f => ({ ...f, domainConditions: f.domainConditions.filter((_, j) => j !== i) }));
  };
  const updateDomainCondition = (i: number, key: keyof PolicyCondition, val: string) => {
    setForm(f => ({ ...f, domainConditions: f.domainConditions.map((c, j) => j === i ? { ...c, [key]: val } : c) }));
  };

  // ── Category tab (website-blocking types) ───────────────────────────────────
  const addCategoryCondition = () => {
    setForm(f => ({ ...f, categoryConditions: [...f.categoryConditions, ""] }));
  };
  const removeCategoryCondition = (i: number) => {
    setForm(f => ({ ...f, categoryConditions: f.categoryConditions.filter((_, j) => j !== i) }));
  };
  const updateCategoryCondition = (i: number, val: string) => {
    setForm(f => ({ ...f, categoryConditions: f.categoryConditions.map((c, j) => j === i ? val : c) }));
  };

  // ── DLP builder ──────────────────────────────────────────────────────────────
  const toggleDetector = (value: string) => {
    setForm(f => ({ ...f, dlp: { ...f.dlp, detectors: f.dlp.detectors.includes(value) ? f.dlp.detectors.filter(d => d !== value) : [...f.dlp.detectors, value] } }));
  };
  const toggleBypassFileType = (value: string) => {
    setForm(f => ({ ...f, dlp: { ...f.dlp, bypassFileTypes: f.dlp.bypassFileTypes.includes(value) ? f.dlp.bypassFileTypes.filter(t => t !== value) : [...f.dlp.bypassFileTypes, value] } }));
  };
  const addCustomPattern = () => {
    setForm(f => ({ ...f, dlp: { ...f.dlp, customPatterns: [...f.dlp.customPatterns, { name: "", regex: "" }] } }));
  };
  const removeCustomPattern = (i: number) => {
    setForm(f => ({ ...f, dlp: { ...f.dlp, customPatterns: f.dlp.customPatterns.filter((_, j) => j !== i) } }));
  };
  const updateCustomPattern = (i: number, key: keyof DLPCustomPattern, val: string) => {
    setForm(f => ({ ...f, dlp: { ...f.dlp, customPatterns: f.dlp.customPatterns.map((p, j) => j === i ? { ...p, [key]: val } : p) } }));
  };

  const toggleAction = (action: string) => {
    setForm(f => ({ ...f, actions: f.actions.includes(action) ? f.actions.filter(a => a !== action) : [...f.actions, action] }));
  };

  // ── Wizard: target selection (step 1-2) ─────────────────────────────────────
  const setScope = (scope: "all" | "team" | "employee") => {
    setForm(f => ({ ...f, target: { scope, team_ids: [], employee_ids: [] } }));
  };
  const toggleTeamId = (id: string) => {
    setForm(f => ({
      ...f,
      target: { ...f.target, team_ids: f.target.team_ids.includes(id) ? f.target.team_ids.filter(t => t !== id) : [...f.target.team_ids, id] },
    }));
  };
  const toggleEmployeeId = (id: string) => {
    setForm(f => ({
      ...f,
      target: { ...f.target, employee_ids: f.target.employee_ids.includes(id) ? f.target.employee_ids.filter(e => e !== id) : [...f.target.employee_ids, id] },
    }));
  };

  const goNext = () => {
    // Full-organization scope has nothing to configure on step 2 — skip it.
    if (wizardStep === 1 && form.target.scope === "all") { setWizardStep(3); return; }
    setWizardStep(s => Math.min(3, s + 1));
  };
  const goBack = () => {
    if (wizardStep === 3 && form.target.scope === "all") { setWizardStep(1); return; }
    setWizardStep(s => Math.max(1, s - 1));
  };

  const step2Valid = form.target.scope === "all"
    || (form.target.scope === "team" && form.target.team_ids.length > 0)
    || (form.target.scope === "employee" && form.target.employee_ids.length > 0);

  const isPending = createMut.isPending || updateMut.isPending;
  const isWebsiteType = WEBSITE_BLOCKING_UI_TYPES.includes(form.policy_type);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Policies</h2>
          <p className="text-sm text-muted-foreground mt-1">{total} security policies</p>
        </div>
        <div className="flex items-center gap-2">
          {canWrite && (<>
          <button
            onClick={() => setImportInput(true)}
            className="flex items-center gap-2 border border-border text-body hover:bg-elevated px-3 py-2 rounded-lg text-sm"
          >
            <Upload className="w-4 h-4" /> Import JSON
          </button>
          <button
            onClick={() => { setEditPolicy(null); setForm(EMPTY_FORM); setWizardStep(1); setShowForm(true); }}
            className="flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-on-brand px-4 py-2 rounded-lg text-sm font-medium"
          >
            <Plus className="w-4 h-4" /> New Policy
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
              placeholder="Search policies..."
              className="pl-9 pr-3 py-2 bg-background border border-border rounded-lg text-sm w-full text-foreground placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <select
            value={typeFilter}
            onChange={e => { setTypeFilter(e.target.value); setPage(1); }}
            className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="">All Types</option>
            {Object.entries(POLICY_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select
            value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
            className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="">All Status</option>
            <option value="true">Enabled</option>
            <option value="false">Disabled</option>
          </select>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={selected.size === policies.length && policies.length > 0}
                    onChange={toggleAll}
                    className="rounded border-border-strong"
                  />
                </th>
                <th className="px-4 py-3 text-left font-medium">Policy</th>
                <th className="px-4 py-3 text-left font-medium">Type</th>
                <th className="px-4 py-3 text-left font-medium">Applies To</th>
                <th className="px-4 py-3 text-left font-medium">Enforcement</th>
                <th className="px-4 py-3 text-left font-medium">Priority</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-elevated">
              {isLoading ? (
                [...Array(6)].map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {[...Array(8)].map((__, j) => (
                      <td key={j} className="px-4 py-4"><div className="h-4 bg-elevated rounded w-3/4" /></td>
                    ))}
                  </tr>
                ))
              ) : policies.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-subtle">
                    <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No policies found
                  </td>
                </tr>
              ) : (
                policies.map((p: any) => {
                  const uiType = API_TO_UI_TYPE[p.type] ?? p.type;
                  const Icon = POLICY_TYPE_ICONS_MAP[uiType] ?? Shield;
                  const isEnabled = p.enabled ?? p.is_enabled ?? true;
                  const actions = p.actions ?? (p.action ? [p.action] : []);
                  return (
                    <tr key={p.id} className={cn("hover:bg-elevated transition-colors", !isEnabled && "opacity-60")}>
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selected.has(p.id)}
                          onChange={() => toggleSelect(p.id)}
                          className="rounded border-border-strong"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className={cn("w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0", isEnabled ? "bg-brand-500/10 text-brand-500" : "bg-elevated text-subtle")}>
                            <Icon className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-foreground">{p.name}</p>
                            <p className="text-xs text-subtle truncate max-w-[240px]">{p.description || `v${p.version}`}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-body">{policyTypeLabel(p)}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 text-body">
                          <Users className="w-3.5 h-3.5 text-subtle" /> {policyTargetLabel(p)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {actions.length === 0 ? <span className="text-subtle">—</span> : actions.map((a: string) => (
                            <span key={a} className={cn("px-2.5 py-1 rounded-full text-xs font-medium", ACTION_BADGE[a] ?? "bg-elevated text-body")}>
                              {a}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-body tabular-nums">{p.priority}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={isEnabled}
                            aria-label={isEnabled ? `Disable ${p.name}` : `Enable ${p.name}`}
                            title={isEnabled ? "Click to disable" : "Click to enable"}
                            onClick={() => toggleMut.mutate(p.id)}
                            disabled={togglingId === p.id}
                            className={cn(
                              "relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 focus:ring-offset-card disabled:opacity-60",
                              isEnabled ? "bg-brand-500" : "bg-border-strong"
                            )}
                          >
                            <span
                              className={cn(
                                "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
                                isEnabled ? "translate-x-4" : "translate-x-0.5"
                              )}
                            />
                          </button>
                          <span className={cn("text-xs font-medium", isEnabled ? "text-success" : "text-subtle")}>
                            {isEnabled ? "Enabled" : "Disabled"}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => setDetailsPolicy(p)}
                            title="View domains & access requests"
                            className="p-1.5 hover:bg-elevated rounded text-subtle hover:text-body"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => openEdit(p)}
                            title="Edit policy"
                            className="p-1.5 hover:bg-elevated rounded text-subtle hover:text-body"
                          >
                            <Edit className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => dupMut.mutate(p.id)}
                            title="Duplicate policy"
                            className="p-1.5 hover:bg-elevated rounded text-subtle hover:text-body"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleExport(p.id)}
                            title="Export policy JSON"
                            className="p-1.5 hover:bg-elevated rounded text-subtle hover:text-body"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setDeleteIds([p.id])}
                            title="Delete policy"
                            className="p-1.5 hover:bg-red-500/10 rounded text-subtle hover:text-danger"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
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

      {/* Policy details modal */}
      {detailsPolicy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-card rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-brand-500/10 flex items-center justify-center text-brand-500 flex-shrink-0">
                  {(() => {
                    const Icon = POLICY_TYPE_ICONS_MAP[API_TO_UI_TYPE[detailsPolicy.type] ?? detailsPolicy.type] ?? Shield;
                    return <Icon className="w-5 h-5" />;
                  })()}
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-foreground truncate">{detailsPolicy.name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {policyTypeLabel(detailsPolicy)} · {policyTargetLabel(detailsPolicy)} · Priority {detailsPolicy.priority} · v{detailsPolicy.version}
                  </p>
                </div>
              </div>
              <button onClick={() => setDetailsPolicy(null)} className="text-subtle hover:text-body"><X className="w-5 h-5" /></button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Blocked Domains {resolvedDomains.length > 0 && `(${resolvedDomains.length})`}
              </p>
              {domainsLoading ? (
                <div className="flex flex-wrap gap-1.5">
                  {[...Array(8)].map((_, i) => (
                    <div key={i} className="h-6 w-28 bg-elevated rounded animate-pulse" />
                  ))}
                </div>
              ) : resolvedDomains.length === 0 ? (
                <p className="text-sm text-subtle">No domains resolved for this policy.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {resolvedDomains.map(d => (
                    <span key={d} className="px-2 py-0.5 bg-elevated rounded text-xs font-mono text-body">{d}</span>
                  ))}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-border flex gap-3">
              <button onClick={() => setDetailsPolicy(null)} className="flex-1 border border-border text-body py-2 rounded-lg text-sm hover:bg-elevated">Close</button>
              <button
                onClick={() => { openEdit(detailsPolicy); setDetailsPolicy(null); }}
                className="flex-1 bg-brand-500 text-on-brand py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2"
              >
                <Edit className="w-4 h-4" /> Edit Policy
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New/Edit Policy Wizard */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-card rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-card z-10">
              <div>
                <h3 className="font-semibold text-foreground">{editPolicy ? "Edit Policy" : "New Policy"}</h3>
                <div className="flex items-center gap-1.5 mt-1.5">
                  {[1, 2, 3].map(s => (
                    <div key={s} className={cn("h-1.5 rounded-full transition-all", s === wizardStep ? "w-6 bg-brand-500" : "w-1.5 bg-muted")} />
                  ))}
                </div>
              </div>
              <button onClick={closeForm} className="text-subtle hover:text-body"><X className="w-5 h-5" /></button>
            </div>

            <div className="px-6 py-5">
              {/* ── Screen 1: who does this apply to ── */}
              {wizardStep === 1 && (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">Who do you need to apply this policy to?</p>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { scope: "all" as const, label: "Full Organization", desc: "Every employee", icon: Building2 },
                      { scope: "team" as const, label: "Teams", desc: "Specific teams", icon: Users },
                      { scope: "employee" as const, label: "Employees", desc: "Specific people", icon: UserRound },
                    ].map(card => (
                      <button
                        key={card.scope}
                        type="button"
                        onClick={() => setScope(card.scope)}
                        className={cn(
                          "flex flex-col items-center gap-2 rounded-xl border p-5 text-center transition-all",
                          form.target.scope === card.scope
                            ? "border-brand-500 bg-brand-500/10"
                            : "border-border hover:bg-elevated"
                        )}
                      >
                        <card.icon className={cn("w-7 h-7", form.target.scope === card.scope ? "text-brand-500" : "text-subtle")} />
                        <span className={cn("text-sm font-medium", form.target.scope === card.scope ? "text-foreground" : "text-body")}>{card.label}</span>
                        <span className="text-xs text-subtle">{card.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Screen 2: pick teams or employees ── */}
              {wizardStep === 2 && form.target.scope === "team" && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">Select the teams this policy applies to.</p>
                  <div className="border border-border rounded-lg max-h-80 overflow-y-auto divide-y divide-elevated">
                    {teams.length === 0 ? (
                      <p className="text-sm text-subtle p-4">No teams found.</p>
                    ) : teams.map((t: any) => (
                      <label key={t.id} className="flex items-center gap-3 p-3 cursor-pointer hover:bg-elevated">
                        <input
                          type="checkbox"
                          checked={form.target.team_ids.includes(t.id)}
                          onChange={() => toggleTeamId(t.id)}
                          className="text-brand-500"
                        />
                        <div>
                          <p className="text-sm text-body">{t.name}</p>
                          {typeof t.member_count === "number" && <p className="text-xs text-subtle">{t.member_count} members</p>}
                        </div>
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-subtle">{form.target.team_ids.length} team(s) selected</p>
                </div>
              )}

              {wizardStep === 2 && form.target.scope === "employee" && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">Select the employees this policy applies to.</p>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-subtle" />
                      <input
                        value={empSearch}
                        onChange={e => setEmpSearch(e.target.value)}
                        placeholder="Search employees..."
                        className="pl-8 pr-3 py-1.5 border border-border rounded-lg text-xs w-full bg-elevated focus:outline-none focus:ring-2 focus:ring-brand-500"
                      />
                    </div>
                    <select
                      value={empDeptFilter}
                      onChange={e => setEmpDeptFilter(e.target.value)}
                      className="border border-border rounded-lg px-2 py-1.5 text-xs bg-elevated focus:outline-none focus:ring-2 focus:ring-brand-500"
                    >
                      <option value="">All Departments</option>
                      {departments.map((d: any) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                  <div className="border border-border rounded-lg max-h-72 overflow-y-auto divide-y divide-elevated">
                    {employees.length === 0 ? (
                      <p className="text-sm text-subtle p-4">No employees found.</p>
                    ) : employees.map((e: any) => (
                      <label key={e.id} className="flex items-center gap-3 p-3 cursor-pointer hover:bg-elevated">
                        <input
                          type="checkbox"
                          checked={form.target.employee_ids.includes(e.id)}
                          onChange={() => toggleEmployeeId(e.id)}
                          className="text-brand-500"
                        />
                        <div>
                          <p className="text-sm text-body">{e.first_name} {e.last_name}</p>
                          <p className="text-xs text-subtle">{e.email}{e.department ? ` · ${e.department}` : ""}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-subtle">{form.target.employee_ids.length} employee(s) selected</p>
                </div>
              )}

              {/* ── Screen 3: policy details ── */}
              {wizardStep === 3 && (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-body mb-1">Policy Name *</label>
                      <input
                        value={form.name}
                        onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                        className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                        placeholder="e.g. Block Social Media"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-body mb-1">Type</label>
                      <select
                        value={form.policy_type}
                        onChange={e => setForm(f => ({ ...f, policy_type: e.target.value }))}
                        className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                      >
                        {Object.entries(POLICY_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-body mb-1">Priority (1=highest)</label>
                      <input
                        type="number"
                        value={form.priority}
                        onChange={e => setForm(f => ({ ...f, priority: Number(e.target.value) }))}
                        className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                        min={1} max={1000}
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-body mb-1">Description</label>
                      <input
                        value={form.description}
                        onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                        className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                      />
                    </div>
                  </div>

                  {/* Website blocking: Domain / Category tabs */}
                  {isWebsiteType && (
                    <div>
                      <div className="flex gap-1 mb-3 border border-border rounded-lg p-1 w-fit">
                        {(["domain", "category"] as const).map(tab => (
                          <button
                            key={tab}
                            type="button"
                            onClick={() => setForm(f => ({ ...f, conditionTab: tab }))}
                            className={cn(
                              "px-4 py-1.5 rounded-md text-xs font-medium capitalize transition-all",
                              form.conditionTab === tab ? "bg-brand-500 text-on-brand" : "text-muted-foreground hover:text-body"
                            )}
                          >
                            {tab}
                          </button>
                        ))}
                      </div>

                      {form.conditionTab === "domain" ? (
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <label className="text-xs font-semibold text-body uppercase tracking-wide">Domains / URL Patterns</label>
                            <button type="button" onClick={addDomainCondition} className="text-xs text-brand-500 hover:underline flex items-center gap-1">
                              <Plus className="w-3 h-3" /> Add condition
                            </button>
                          </div>
                          <div className="space-y-2">
                            {form.domainConditions.map((cond, i) => (
                              <div key={i} className="flex items-center gap-2 bg-elevated rounded-lg p-3">
                                <select
                                  value={cond.type}
                                  onChange={e => updateDomainCondition(i, "type", e.target.value)}
                                  className="border border-border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500 bg-card"
                                >
                                  {DOMAIN_CONDITION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                </select>
                                <select
                                  value={cond.operator}
                                  onChange={e => updateDomainCondition(i, "operator", e.target.value)}
                                  className="border border-border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500 bg-card"
                                >
                                  {OPERATORS.map(o => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}
                                </select>
                                <input
                                  value={cond.value}
                                  onChange={e => updateDomainCondition(i, "value", e.target.value)}
                                  placeholder={cond.type === "url_pattern" ? "e.g. chatgpt.com" : "e.g. facebook.com"}
                                  className="flex-1 border border-border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500"
                                />
                                {form.domainConditions.length > 1 && (
                                  <button type="button" onClick={() => removeDomainCondition(i)} className="text-faint hover:text-danger">
                                    <X className="w-4 h-4" />
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <label className="text-xs font-semibold text-body uppercase tracking-wide">Categories</label>
                            <button type="button" onClick={addCategoryCondition} className="text-xs text-brand-500 hover:underline flex items-center gap-1">
                              <Plus className="w-3 h-3" /> Add condition
                            </button>
                          </div>
                          {form.categoryConditions.length === 0 && (
                            <p className="text-xs text-subtle mb-2">No category selected yet — add one to block every domain in that category.</p>
                          )}
                          <div className="space-y-2">
                            {form.categoryConditions.map((slug, i) => (
                              <div key={i} className="flex items-center gap-2 bg-elevated rounded-lg p-3">
                                <select
                                  value={slug}
                                  onChange={e => updateCategoryCondition(i, e.target.value)}
                                  className="flex-1 border border-border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500 bg-card"
                                >
                                  <option value="">Select category...</option>
                                  {categories.map((c: any) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
                                </select>
                                <button type="button" onClick={() => removeCategoryCondition(i)} className="text-faint hover:text-danger">
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Generic conditions builder (other non-DLP types) */}
                  {!isWebsiteType && form.policy_type !== "dlp" && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-xs font-semibold text-body uppercase tracking-wide">Conditions</label>
                        <button type="button" onClick={addCondition} className="text-xs text-brand-500 hover:underline flex items-center gap-1">
                          <Plus className="w-3 h-3" /> Add condition
                        </button>
                      </div>
                      <div className="space-y-2">
                        {form.conditions.map((cond, i) => (
                          <div key={i} className="flex items-center gap-2 bg-elevated rounded-lg p-3">
                            {i > 0 && <span className="text-xs text-subtle w-6">AND</span>}
                            <select
                              value={cond.type}
                              onChange={e => updateCondition(i, "type", e.target.value)}
                              className="border border-border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500 bg-card"
                            >
                              {CONDITION_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
                            </select>
                            <select
                              value={cond.operator}
                              onChange={e => updateCondition(i, "operator", e.target.value)}
                              className="border border-border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500 bg-card"
                            >
                              {OPERATORS.map(o => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}
                            </select>
                            <input
                              value={cond.value}
                              onChange={e => updateCondition(i, "value", e.target.value)}
                              placeholder="value..."
                              className="flex-1 border border-border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500"
                            />
                            {form.conditions.length > 1 && (
                              <button type="button" onClick={() => removeCondition(i)} className="text-faint hover:text-danger">
                                <X className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* DLP detector builder */}
                  {form.policy_type === "dlp" && (
                    <div className="space-y-4">
                      <div>
                        <label className="text-xs font-semibold text-body uppercase tracking-wide mb-2 block">Detect &amp; Block</label>
                        <div className="flex flex-wrap gap-2">
                          {DLP_DETECTORS.map(d => (
                            <button
                              key={d.value}
                              type="button"
                              onClick={() => toggleDetector(d.value)}
                              className={cn(
                                "px-3 py-1.5 rounded-lg text-xs font-medium border transition-all",
                                form.dlp.detectors.includes(d.value)
                                  ? "bg-red-600 text-white border-red-600"
                                  : "bg-card text-body border-border hover:bg-elevated"
                              )}
                            >
                              {d.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Decision thresholds — the >80 block / 50-80 alert bands */}
                      <div>
                        <label className="text-xs font-semibold text-body uppercase tracking-wide mb-2 block">
                          Decision Thresholds
                        </label>
                        <p className="text-xs text-subtle mb-3">
                          Each scanned upload is scored 0–100 by sensitivity. Block at or above the block score;
                          alert (allow but flag) at or above the alert score.
                        </p>
                        <div className="space-y-4 bg-card border border-border rounded-lg p-4">
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs text-danger font-medium">Block at score ≥</span>
                              <span className="text-sm font-bold text-foreground tabular-nums">{form.dlp.blockThreshold}</span>
                            </div>
                            <input
                              type="range"
                              min={1}
                              max={100}
                              value={form.dlp.blockThreshold}
                              onChange={e => {
                                const block = Number(e.target.value);
                                setForm(f => ({
                                  ...f,
                                  dlp: {
                                    ...f.dlp,
                                    blockThreshold: block,
                                    // keep alert strictly below block
                                    alertThreshold: Math.min(f.dlp.alertThreshold, block - 1),
                                  },
                                }));
                              }}
                              className="w-full accent-red-500"
                            />
                          </div>
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs text-warning font-medium">Alert at score ≥</span>
                              <span className="text-sm font-bold text-foreground tabular-nums">{form.dlp.alertThreshold}</span>
                            </div>
                            <input
                              type="range"
                              min={0}
                              max={99}
                              value={form.dlp.alertThreshold}
                              onChange={e => {
                                const alert = Math.min(Number(e.target.value), form.dlp.blockThreshold - 1);
                                setForm(f => ({ ...f, dlp: { ...f.dlp, alertThreshold: alert } }));
                              }}
                              className="w-full accent-yellow-500"
                            />
                          </div>
                          <div className="flex items-center gap-2 text-[10px] text-subtle">
                            <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-success">
                              0–{Math.max(0, form.dlp.alertThreshold - 1)} allow
                            </span>
                            <span className="px-2 py-0.5 rounded bg-yellow-500/10 text-warning">
                              {form.dlp.alertThreshold}–{form.dlp.blockThreshold - 1} alert
                            </span>
                            <span className="px-2 py-0.5 rounded bg-red-500/10 text-danger">
                              {form.dlp.blockThreshold}–100 block
                            </span>
                          </div>
                        </div>
                      </div>

                      <div>
                        <label className="text-xs font-semibold text-body uppercase tracking-wide mb-2 block">Keywords (one per line)</label>
                        <textarea
                          value={form.dlp.keywords}
                          onChange={e => setForm(f => ({ ...f, dlp: { ...f.dlp, keywords: e.target.value } }))}
                          rows={3}
                          placeholder={"confidential\ncustomer database"}
                          className="w-full border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500 bg-elevated"
                        />
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <label className="text-xs font-semibold text-body uppercase tracking-wide">Custom Patterns</label>
                          <button type="button" onClick={addCustomPattern} className="text-xs text-brand-500 hover:underline flex items-center gap-1">
                            <Plus className="w-3 h-3" /> Add pattern
                          </button>
                        </div>
                        <div className="space-y-2">
                          {form.dlp.customPatterns.map((p, i) => (
                            <div key={i} className="flex items-center gap-2 bg-elevated rounded-lg p-3">
                              <input
                                value={p.name}
                                onChange={e => updateCustomPattern(i, "name", e.target.value)}
                                placeholder="Name (e.g. Project Codename)"
                                className="w-48 border border-border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500"
                              />
                              <input
                                value={p.regex}
                                onChange={e => updateCustomPattern(i, "regex", e.target.value)}
                                placeholder="Regex (e.g. PROJECT-X-\d+)"
                                className="flex-1 border border-border rounded-lg px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
                              />
                              <button type="button" onClick={() => removeCustomPattern(i)} className="text-faint hover:text-danger">
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div>
                        <label className="text-xs font-semibold text-body uppercase tracking-wide mb-2 block">Allow (skip scanning for these file types)</label>
                        <div className="flex flex-wrap gap-2">
                          {DLP_BYPASS_FILE_TYPES.map(t => (
                            <button
                              key={t.value}
                              type="button"
                              onClick={() => toggleBypassFileType(t.value)}
                              className={cn(
                                "px-3 py-1.5 rounded-lg text-xs font-medium border transition-all",
                                form.dlp.bypassFileTypes.includes(t.value)
                                  ? "bg-green-600 text-white border-green-600"
                                  : "bg-card text-body border-border hover:bg-elevated"
                              )}
                            >
                              {t.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <p className="text-xs text-subtle">
                        Applies to plain-HTTP uploads always, and to HTTPS uploads only when SSL Inspection is enabled
                        for this organization (see SSL Inspection settings).
                      </p>
                    </div>
                  )}

                  {/* Actions */}
                  <div>
                    <label className="block text-xs font-semibold text-body uppercase tracking-wide mb-2">Actions</label>
                    <div className="flex flex-wrap gap-2">
                      {ACTIONS.map(action => (
                        <button
                          key={action}
                          type="button"
                          onClick={() => toggleAction(action)}
                          className={cn(
                            "px-3 py-1.5 rounded-lg text-sm font-medium border transition-all",
                            form.actions.includes(action)
                              ? action === "block" ? "bg-red-600 text-white border-red-600"
                                : action === "alert" ? "bg-yellow-500 text-white border-yellow-500"
                                : action === "allow" ? "bg-green-600 text-white border-green-600"
                                : "bg-brand-500 text-on-brand border-brand-500"
                              : "bg-card text-body border-border hover:bg-elevated"
                          )}
                        >
                          {action}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Wizard navigation */}
              <div className="flex gap-3 pt-5">
                {wizardStep > 1 ? (
                  <button type="button" onClick={goBack} className="flex-1 border border-border text-body py-2 rounded-lg text-sm hover:bg-elevated flex items-center justify-center gap-1">
                    <ChevronLeft className="w-4 h-4" /> Back
                  </button>
                ) : (
                  <button type="button" onClick={closeForm} className="flex-1 border border-border text-body py-2 rounded-lg text-sm hover:bg-elevated">Cancel</button>
                )}
                {wizardStep < 3 ? (
                  <button
                    type="button"
                    onClick={goNext}
                    disabled={wizardStep === 2 && !step2Valid}
                    className="flex-1 bg-brand-500 text-on-brand py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-1 disabled:opacity-60"
                  >
                    Next <ChevronRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={isPending || !form.name.trim()}
                    className="flex-1 bg-brand-500 text-on-brand py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                    {editPolicy ? "Save Changes" : "Create Policy"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Import JSON */}
      {importInput && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-card rounded-2xl shadow-2xl w-full max-w-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-foreground">Import Policies (JSON)</h3>
              <button onClick={() => setImportInput(false)} className="text-subtle hover:text-body"><X className="w-5 h-5" /></button>
            </div>
            <textarea
              value={importText}
              onChange={e => setImportText(e.target.value)}
              rows={10}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500 mb-4"
              placeholder='[{"name": "Block AI", "type": "domain", "action": "block", "rules": {"domains": ["chatgpt.com"]}}]'
            />
            <div className="flex gap-3">
              <button onClick={() => setImportInput(false)} className="flex-1 border border-border text-body py-2 rounded-lg text-sm">Cancel</button>
              <button
                onClick={handleImport}
                disabled={!importText.trim() || importMut.isPending}
                className="flex-1 bg-brand-500 text-on-brand py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {importMut.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Import
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
            <h3 className="text-center font-semibold text-foreground mb-2">Delete {deleteIds.length > 1 ? `${deleteIds.length} policies` : "policy"}?</h3>
            <p className="text-center text-sm text-muted-foreground mb-6">All assignments will be removed.</p>
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
