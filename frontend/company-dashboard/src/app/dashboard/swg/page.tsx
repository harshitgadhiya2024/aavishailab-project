"use client";

import { useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { activityApi, categoryApi, employeeApi, policyApi, swgApi, teamApi } from "@/lib/api";
import {
  Globe, Plus, Trash2, Search, X, Loader2, Shield, AlertCircle,
  CheckCircle2, XCircle, Power, Pencil,
} from "lucide-react";
import { formatDateTime, cn } from "@/lib/utils";
import { toast } from "sonner";
import { Pagination } from "@/components/ui/Pagination";

/**
 * The Web Gateway tab owns everything web-filtering: the policies a company
 * writes, and the traffic those policies produced.
 *
 * Policies are `Policy` rows of type `domain` or `url_category` — the same
 * rows the agent's rule feed already expands and enforces — rather than the
 * older flat `domain_rules` table, which nothing writes to by hand any more
 * (it is now only the risk engine's auto-block output).
 */

type MatchKind = "domain" | "url_category";

type PolicyRow = {
  id: string;
  name: string;
  description?: string;
  type: MatchKind;
  action: "block" | "alert";
  enabled: boolean;
  rules?: { domains?: string[]; categories?: string[] };
  targets?: { scope?: string; team_ids?: string[]; employee_ids?: string[] };
  created_at?: string;
};

type LogRow = {
  id: string;
  action: string;
  target?: string;
  target_domain?: string;
  category?: string;
  policy_name?: string;
  risk_score?: number;
  event_type?: string;
  timestamp?: string;
  created_at?: string;
  employee?: { first_name?: string; last_name?: string; email?: string } | null;
};

const EMPTY_FORM = {
  id: "",
  name: "",
  description: "",
  match: "domain" as MatchKind,
  domains: "",
  categories: [] as string[],
  action: "block" as "block" | "alert",
  scope: "all" as "all" | "team" | "employee",
  team_ids: [] as string[],
  employee_ids: [] as string[],
};

function employeeName(e: LogRow["employee"]) {
  if (!e) return "—";
  const name = [e.first_name, e.last_name].filter(Boolean).join(" ").trim();
  return name || e.email || "—";
}

/**
 * Action, in the requirement's vocabulary rather than the database's: an event
 * is a web request, an application event, or a malware block. The category
 * column carries the finer detail, so this stays at three values on purpose.
 */
function actionLabel(row: LogRow) {
  const cat = (row.category ?? "").toLowerCase();
  if (cat === "malware" || cat === "malware_detection") return "Malware";
  if (cat === "application_control" || row.event_type === "process_start") return "Application";
  return "Web request";
}

// Only the two outcomes this table can contain. "allowed" is not styled
// here on purpose: the server strips it from every activity response, so a
// green "allowed" pill could only appear if that guard had broken — and it
// should look wrong when it does, not blend in.
function outcomeStyle(action: string) {
  if (action === "blocked") return "bg-red-500/10 text-danger";
  if (action === "alerted") return "bg-yellow-500/10 text-warning";
  return "bg-elevated text-body";
}

function riskStyle(score: number) {
  if (score >= 80) return "text-danger";
  if (score >= 50) return "text-warning";
  return "text-muted-foreground";
}

export default function SWGPage() {
  const qc = useQueryClient();

  // ── policies ───────────────────────────────────────────────────────────
  const [policyPage, setPolicyPage] = useState(1);
  const [policyLimit, setPolicyLimit] = useState(10);
  const [policySearch, setPolicySearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // ── logs ───────────────────────────────────────────────────────────────
  const [logPage, setLogPage] = useState(1);
  const [logLimit, setLogLimit] = useState(20);
  const [logSearch, setLogSearch] = useState("");
  const [logAction, setLogAction] = useState("");

  // ── url checker ────────────────────────────────────────────────────────
  const [checkUrl, setCheckUrl] = useState("");
  const [checkResult, setCheckResult] = useState<any>(null);
  const [checking, setChecking] = useState(false);

  const { data: statsData } = useQuery({
    queryKey: ["swg-stats"],
    queryFn: swgApi.stats,
    refetchInterval: 30_000,
  });

  const { data: policyData, isLoading: policiesLoading } = useQuery({
    queryKey: ["swg-policies", policyPage, policyLimit, policySearch],
    queryFn: () =>
      policyApi.list({
        type: "domain,url_category",
        page: policyPage,
        limit: policyLimit,
        search: policySearch || undefined,
      }),
    placeholderData: keepPreviousData,
  });

  const { data: logData, isLoading: logsLoading } = useQuery({
    queryKey: ["swg-logs", logPage, logLimit, logSearch, logAction],
    queryFn: () =>
      activityApi.list({
        source: "web_gateway",
        page: logPage,
        limit: logLimit,
        search: logSearch || undefined,
        action: logAction || undefined,
      }),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });

  const { data: catsData } = useQuery({
    queryKey: ["swg-categories-for-policy"],
    queryFn: () => categoryApi.list(),
  });
  const { data: teamsData } = useQuery({ queryKey: ["teams-lite"], queryFn: () => teamApi.list({ limit: 200 }) });
  const { data: empData } = useQuery({ queryKey: ["employees-lite"], queryFn: () => employeeApi.list({ limit: 500 }) });

  const stats = statsData?.data ?? {};
  const policies: PolicyRow[] = policyData?.data?.data ?? [];
  const policyTotal: number = policyData?.data?.total ?? 0;
  const policyPages = Math.max(1, Math.ceil(policyTotal / policyLimit));

  const logs: LogRow[] = logData?.data?.data ?? [];
  const logTotal: number = logData?.data?.total ?? 0;
  const logPages = Math.max(1, Math.ceil(logTotal / logLimit));

  const categories: any[] = catsData?.data?.data ?? [];
  const teams: any[] = teamsData?.data?.data ?? [];
  const employees: any[] = empData?.data?.data ?? [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["swg-policies"] });
    qc.invalidateQueries({ queryKey: ["swg-stats"] });
  };

  const saveMut = useMutation({
    mutationFn: (payload: { id?: string; body: any }) =>
      payload.id ? policyApi.update(payload.id, payload.body) : policyApi.create(payload.body),
    onSuccess: () => {
      toast.success(form.id ? "Policy updated" : "Policy created");
      setShowForm(false);
      setForm(EMPTY_FORM);
      invalidate();
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Could not save the policy"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => policyApi.delete(id),
    onSuccess: () => { toast.success("Policy deleted"); setDeleteId(null); invalidate(); },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Could not delete the policy"),
  });

  const toggleMut = useMutation({
    mutationFn: (id: string) => policyApi.toggle(id),
    onSuccess: () => invalidate(),
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Could not change the policy"),
  });

  const openCreate = () => { setForm(EMPTY_FORM); setShowForm(true); };

  const openEdit = (p: PolicyRow) => {
    setForm({
      id: p.id,
      name: p.name ?? "",
      description: p.description ?? "",
      match: p.type,
      domains: (p.rules?.domains ?? []).join("\n"),
      categories: p.rules?.categories ?? [],
      action: p.action === "alert" ? "alert" : "block",
      scope: (p.targets?.scope as any) || "all",
      team_ids: p.targets?.team_ids ?? [],
      employee_ids: p.targets?.employee_ids ?? [],
    });
    setShowForm(true);
  };

  const submit = () => {
    const domains = form.domains.split(/[\s,]+/).map(d => d.trim()).filter(Boolean);
    if (!form.name.trim()) return toast.error("Give the policy a name");
    if (form.match === "domain" && domains.length === 0) return toast.error("Add at least one domain");
    if (form.match === "url_category" && form.categories.length === 0) return toast.error("Pick at least one category");
    if (form.scope === "team" && form.team_ids.length === 0) return toast.error("Pick at least one team");
    if (form.scope === "employee" && form.employee_ids.length === 0) return toast.error("Pick at least one employee");

    const targets: Record<string, any> = { scope: form.scope };
    if (form.scope === "team") targets.team_ids = form.team_ids;
    if (form.scope === "employee") targets.employee_ids = form.employee_ids;

    saveMut.mutate({
      id: form.id || undefined,
      body: {
        name: form.name.trim(),
        description: form.description.trim(),
        type: form.match,
        action: form.action,
        enabled: true,
        rules: form.match === "domain" ? { domains } : { categories: form.categories },
        targets,
      },
    });
  };

  const handleCheck = async () => {
    if (!checkUrl.trim()) return;
    setChecking(true);
    setCheckResult(null);
    try {
      const res = await swgApi.checkUrl(checkUrl);
      setCheckResult(res.data);
    } catch (e: any) {
      toast.error(e.response?.data?.error ?? "Check failed");
    } finally {
      setChecking(false);
    }
  };

  const toggleIn = (list: string[], id: string) =>
    list.includes(id) ? list.filter(x => x !== id) : [...list, id];

  // No "Allowed requests" card: routine, allowed traffic is never stored (see
  // dropAllowedEvents on the server), so there is nothing live to count.
  const statCards = useMemo(() => ([
    { label: "Policies", value: policyTotal, color: "bg-brand-500/10 text-brand-500", icon: Shield },
    { label: "Blocked requests", value: stats.total_blocked ?? 0, color: "bg-red-500/10 text-danger", icon: XCircle },
    { label: "Logged events", value: logTotal, color: "bg-green-500/10 text-success", icon: AlertCircle },
  ]), [policyTotal, logTotal, stats.total_blocked]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Web Gateway</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Block or alert on sites by domain, domain pattern or category — and see everything
            the gateway did.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground hover:bg-brand-600"
        >
          <Plus className="w-4 h-4" /> New policy
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statCards.map(s => (
          <div key={s.label} className="bg-card rounded-xl p-4 border border-border shadow-sm flex items-center gap-3">
            <div className={`p-2 rounded-lg ${s.color}`}><s.icon className="w-4 h-4" /></div>
            <div>
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-xl font-bold text-foreground">{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* URL checker */}
      <div className="bg-card rounded-xl border border-border shadow-sm p-5">
        <h3 className="font-semibold text-foreground mb-3">URL checker</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Ask what would happen to a URL right now, without waiting for someone to visit it.
        </p>
        <div className="flex gap-3">
          <input
            value={checkUrl}
            onChange={e => setCheckUrl(e.target.value)}
            placeholder="https://example.com/path"
            className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-brand-500"
            onKeyDown={e => e.key === "Enter" && handleCheck()}
          />
          <button
            onClick={handleCheck}
            disabled={checking}
            className="flex items-center gap-2 bg-brand-500 text-on-brand px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60"
          >
            {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Check
          </button>
        </div>
        {checkResult && (
          <div className={cn("mt-3 flex items-center gap-3 p-3 rounded-lg text-sm",
            checkResult.blocked ? "bg-red-500/10 text-danger" : "bg-green-500/10 text-success")}>
            {checkResult.blocked
              ? <XCircle className="w-5 h-5 flex-shrink-0" />
              : <CheckCircle2 className="w-5 h-5 flex-shrink-0" />}
            <div>
              <p className="font-medium">{checkResult.blocked ? "Blocked" : "Allowed"}</p>
              {checkResult.reason && <p className="text-xs opacity-80">{checkResult.reason}</p>}
              {checkResult.category && <p className="text-xs opacity-80">Category: {checkResult.category}</p>}
            </div>
          </div>
        )}
      </div>

      {/* Policies */}
      <div className="bg-card rounded-xl border border-border shadow-sm">
        <div className="p-4 border-b border-border flex flex-wrap gap-3 items-center">
          <h3 className="font-semibold text-foreground mr-auto">Policies</h3>
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
            <input
              value={policySearch}
              onChange={e => { setPolicySearch(e.target.value); setPolicyPage(1); }}
              placeholder="Search policies..."
              className="pl-9 pr-3 py-2 bg-background border border-border rounded-lg text-sm w-full text-foreground placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-elevated text-xs uppercase text-subtle">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Policy</th>
                <th className="text-left px-4 py-3 font-medium">Matches</th>
                <th className="text-left px-4 py-3 font-medium">Action</th>
                <th className="text-left px-4 py-3 font-medium">Applies to</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {policiesLoading ? (
                <tr><td colSpan={6} className="text-center py-12"><Loader2 className="w-5 h-5 animate-spin mx-auto text-subtle" /></td></tr>
              ) : policies.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-subtle">
                    <Globe className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No web gateway policies yet
                  </td>
                </tr>
              ) : policies.map(p => {
                const matches = p.type === "domain"
                  ? (p.rules?.domains ?? [])
                  : (p.rules?.categories ?? []);
                const scope = p.targets?.scope ?? "all";
                return (
                  <tr key={p.id} className="hover:bg-elevated/60">
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">{p.name}</p>
                      {p.description && <p className="text-xs text-muted-foreground mt-0.5">{p.description}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-muted-foreground">
                        {p.type === "domain" ? "Domains" : "Categories"} ·{" "}
                      </span>
                      <span className="text-foreground text-xs">
                        {matches.slice(0, 3).join(", ")}
                        {matches.length > 3 && ` +${matches.length - 3} more`}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("px-2 py-0.5 rounded text-xs font-medium",
                        p.action === "block" ? "bg-red-500/10 text-danger" : "bg-yellow-500/10 text-warning")}>
                        {p.action === "block" ? "Block" : "Alert"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground capitalize">
                      {scope === "all" ? "Everyone"
                        : scope === "team" ? `${p.targets?.team_ids?.length ?? 0} team(s)`
                        : `${p.targets?.employee_ids?.length ?? 0} employee(s)`}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("px-2 py-0.5 rounded text-xs font-medium",
                        p.enabled ? "bg-emerald-500/10 text-success" : "bg-elevated text-subtle")}>
                        {p.enabled ? "Enabled" : "Disabled"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => toggleMut.mutate(p.id)} title={p.enabled ? "Disable" : "Enable"}
                          className="p-1.5 hover:bg-elevated rounded text-subtle hover:text-body">
                          <Power className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => openEdit(p)} title="Edit"
                          className="p-1.5 hover:bg-elevated rounded text-subtle hover:text-body">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setDeleteId(p.id)} title="Delete"
                          className="p-1.5 hover:bg-red-500/10 rounded text-subtle hover:text-danger">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <Pagination
          page={policyPage}
          totalPages={policyPages}
          total={policyTotal}
          limit={policyLimit}
          onPageChange={setPolicyPage}
          onLimitChange={l => { setPolicyLimit(l); setPolicyPage(1); }}
        />
      </div>

      {/* Activity */}
      <div className="bg-card rounded-xl border border-border shadow-sm">
        <div className="p-4 border-b border-border flex flex-wrap gap-3 items-center">
          <h3 className="font-semibold text-foreground mr-auto">Web gateway activity</h3>
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
            <input
              value={logSearch}
              onChange={e => { setLogSearch(e.target.value); setLogPage(1); }}
              placeholder="Search domain, reason..."
              className="pl-9 pr-3 py-2 bg-background border border-border rounded-lg text-sm w-full text-foreground placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <select
            value={logAction}
            onChange={e => { setLogAction(e.target.value); setLogPage(1); }}
            className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground"
          >
            {/* No "Allowed" option: routine traffic is never stored or shown
                here, so it would always return an empty page. */}
            <option value="">All outcomes</option>
            <option value="blocked">Blocked</option>
            <option value="alerted">Alerted</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-elevated text-xs uppercase text-subtle">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Employee</th>
                <th className="text-left px-4 py-3 font-medium">Domain</th>
                <th className="text-left px-4 py-3 font-medium">Action</th>
                <th className="text-left px-4 py-3 font-medium">Reason / policy</th>
                <th className="text-left px-4 py-3 font-medium">Category</th>
                <th className="text-left px-4 py-3 font-medium">Risk</th>
                <th className="text-left px-4 py-3 font-medium">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {logsLoading ? (
                <tr><td colSpan={7} className="text-center py-12"><Loader2 className="w-5 h-5 animate-spin mx-auto text-subtle" /></td></tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-subtle">
                    <Globe className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No web gateway activity yet
                  </td>
                </tr>
              ) : logs.map(ev => (
                <tr key={ev.id} className="hover:bg-elevated/60">
                  <td className="px-4 py-3 text-foreground">{employeeName(ev.employee)}</td>
                  <td className="px-4 py-3 text-foreground">{ev.target_domain || ev.target || "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-foreground text-xs">{actionLabel(ev)}</span>
                      <span className={cn("px-2 py-0.5 rounded text-xs font-medium capitalize", outcomeStyle(ev.action))}>
                        {ev.action}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground max-w-[240px] truncate" title={ev.policy_name}>
                    {ev.policy_name || "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{ev.category || "—"}</td>
                  <td className={cn("px-4 py-3 font-medium tabular-nums", riskStyle(ev.risk_score ?? 0))}>
                    {Math.round(ev.risk_score ?? 0)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                    {formatDateTime(ev.timestamp || ev.created_at || "")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Pagination
          page={logPage}
          totalPages={logPages}
          total={logTotal}
          limit={logLimit}
          onPageChange={setLogPage}
          onLimitChange={l => { setLogLimit(l); setLogPage(1); }}
        />
      </div>

      {/* Create / edit policy */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-card rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <h3 className="font-semibold text-foreground">{form.id ? "Edit policy" : "New web gateway policy"}</h3>
              <button onClick={() => setShowForm(false)} className="text-subtle hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Name</label>
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Block AI assistants"
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Reason shown to the employee</label>
                <input
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Not approved for company data"
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Match by</label>
                  <select
                    value={form.match}
                    onChange={e => setForm(f => ({ ...f, match: e.target.value as MatchKind }))}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground"
                  >
                    <option value="domain">Domain / domain pattern</option>
                    <option value="url_category">Category</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Action</label>
                  <select
                    value={form.action}
                    onChange={e => setForm(f => ({ ...f, action: e.target.value as "block" | "alert" }))}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground"
                  >
                    <option value="block">Block — show the company block page</option>
                    <option value="alert">Alert — allow, but record it</option>
                  </select>
                </div>
              </div>

              {form.match === "domain" ? (
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Domains</label>
                  <textarea
                    value={form.domains}
                    onChange={e => setForm(f => ({ ...f, domains: e.target.value }))}
                    rows={4}
                    placeholder={"chatgpt.com\nclaude.ai\n*.openai.com"}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm font-mono text-foreground placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    One per line. A domain always covers its subdomains, so
                    <code className="mx-1 text-foreground">openai.com</code> and
                    <code className="mx-1 text-foreground">*.openai.com</code> mean the same thing.
                  </p>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Categories</label>
                  <div className="max-h-48 overflow-y-auto border border-border rounded-lg divide-y divide-border">
                    {categories.length === 0 && (
                      <p className="text-sm text-muted-foreground p-3">No categories available.</p>
                    )}
                    {categories.map((cat: any) => (
                      <label key={cat.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-elevated">
                        <input
                          type="checkbox"
                          checked={form.categories.includes(cat.slug)}
                          onChange={() => setForm(f => ({ ...f, categories: toggleIn(f.categories, cat.slug) }))}
                        />
                        <span className="text-foreground">{cat.name}</span>
                        <span className="text-xs text-muted-foreground ml-auto">{cat.domain_count ?? 0} domains</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Applies to</label>
                <select
                  value={form.scope}
                  onChange={e => setForm(f => ({ ...f, scope: e.target.value as any }))}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground"
                >
                  <option value="all">Everyone in the company</option>
                  <option value="team">Specific teams</option>
                  <option value="employee">Specific employees</option>
                </select>
              </div>

              {form.scope === "team" && (
                <div className="max-h-40 overflow-y-auto border border-border rounded-lg divide-y divide-border">
                  {teams.map((t: any) => (
                    <label key={t.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-elevated">
                      <input type="checkbox" checked={form.team_ids.includes(t.id)}
                        onChange={() => setForm(f => ({ ...f, team_ids: toggleIn(f.team_ids, t.id) }))} />
                      <span className="text-foreground">{t.name}</span>
                    </label>
                  ))}
                </div>
              )}

              {form.scope === "employee" && (
                <div className="max-h-40 overflow-y-auto border border-border rounded-lg divide-y divide-border">
                  {employees.map((e: any) => (
                    <label key={e.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-elevated">
                      <input type="checkbox" checked={form.employee_ids.includes(e.id)}
                        onChange={() => setForm(f => ({ ...f, employee_ids: toggleIn(f.employee_ids, e.id) }))} />
                      <span className="text-foreground">
                        {[e.first_name, e.last_name].filter(Boolean).join(" ") || e.email}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-3 p-5 border-t border-border">
              <button onClick={() => setShowForm(false)} className="flex-1 border border-border text-body py-2 rounded-lg text-sm">Cancel</button>
              <button
                onClick={submit}
                disabled={saveMut.isPending}
                className="flex-1 bg-primary text-primary-foreground py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {saveMut.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                {form.id ? "Save changes" : "Create policy"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteId && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-card rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="w-12 h-12 bg-red-500/10 rounded-xl flex items-center justify-center mx-auto mb-4">
              <Trash2 className="w-5 h-5 text-danger" />
            </div>
            <h3 className="text-center font-semibold text-foreground mb-2">Delete this policy?</h3>
            <p className="text-center text-sm text-muted-foreground mb-6">
              Every device stops enforcing it within a minute. The activity it already recorded stays.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteId(null)} className="flex-1 border border-border text-body py-2 rounded-lg text-sm">Cancel</button>
              <button
                onClick={() => deleteMut.mutate(deleteId)}
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
