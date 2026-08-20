"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { casbApi } from "@/lib/api";
import {
  ShieldCheck, CloudCog, FlaskConical, Loader2, AlertTriangle, Plus, Edit, Trash2,
  X, ListOrdered, Lock, ToggleRight, ToggleLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Pagination } from "@/components/ui/Pagination";


const CATEGORIES = ["cloud_storage", "file_transfer", "ai_tools", "communication", "social_media", "dev_tools"];
const ACTIVITIES = ["upload", "download", "share", "post", "login"];

function actionStyle(a: string) {
  if (a === "block") return "bg-red-500/10 text-danger border-red-500/20";
  if (a === "alert") return "bg-yellow-500/10 text-warning border-yellow-500/20";
  return "bg-emerald-500/10 text-success border-emerald-500/20";
}
function sevStyle(s: string) {
  if (s === "high") return "bg-red-500/10 text-danger";
  if (s === "medium") return "bg-yellow-500/10 text-warning";
  return "bg-blue-500/10 text-info";
}


// ─── Org app-control rules ────────────────────────────────────────────────────

type CASBRule = {
  id: string;
  name: string;
  category: string;
  app: string;
  activity: string;
  sanctioned: boolean | null;
  min_risk: number | null;
  action: "block" | "alert" | "allow";
  priority: number;
  enabled: boolean;
};

type RuleForm = {
  name: string;
  category: string;
  app: string;
  activity: string;
  sanctioned: "any" | "yes" | "no";
  min_risk: string;
  action: string;
  priority: number;
};

const EMPTY_RULE: RuleForm = {
  name: "", category: "", app: "", activity: "upload",
  sanctioned: "any", min_risk: "", action: "alert", priority: 100,
};

// One-click starting points for the decisions companies actually argue about.
const RULE_TEMPLATES: { label: string; hint: string; form: RuleForm }[] = [
  {
    label: "Strict: block uploads to unsanctioned apps",
    hint: "Restores the old default — nothing leaves to an app nobody has approved",
    form: { ...EMPTY_RULE, name: "Block uploads to unsanctioned apps", activity: "upload", sanctioned: "no", action: "block", priority: 10 },
  },
  {
    label: "Allow uploads to your sanctioned apps",
    hint: "Approved tools stay out of the way of every later rule",
    form: { ...EMPTY_RULE, name: "Allow uploads to sanctioned apps", activity: "upload", sanctioned: "yes", action: "allow", priority: 20 },
  },
  {
    label: "Block uploads to AI tools",
    hint: "Stronger than the built-in alert on AI uploads",
    form: { ...EMPTY_RULE, name: "Block uploads to AI tools", category: "ai_tools", activity: "upload", action: "block", priority: 30 },
  },
];

function matchSummary(rule: CASBRule) {
  const parts: string[] = [];
  if (rule.app) parts.push(`app is ${rule.app}`);
  if (rule.category) parts.push(`category ${rule.category.replace(/_/g, " ")}`);
  if (rule.sanctioned !== null) parts.push(rule.sanctioned ? "sanctioned" : "unsanctioned");
  if (rule.min_risk !== null) parts.push(`risk ≥ ${rule.min_risk}`);
  return parts.length > 0 ? parts.join(" · ") : "any app";
}

function AppControlRules() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editRule, setEditRule] = useState<CASBRule | null>(null);
  const [form, setForm] = useState<RuleForm>(EMPTY_RULE);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);

  const { data, isLoading } = useQuery({
    queryKey: ["casb-rules"],
    queryFn: () => casbApi.listRules(),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["casb-rules"] });

  const saveMut = useMutation({
    mutationFn: (payload: any) =>
      editRule ? casbApi.updateRule(editRule.id, payload) : casbApi.createRule(payload),
    onSuccess: () => { toast.success(editRule ? "Rule updated" : "Rule created"); invalidate(); closeForm(); },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Failed to save rule"),
  });

  const toggleMut = useMutation({
    mutationFn: (id: string) => casbApi.toggleRule(id),
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Failed"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => casbApi.deleteRule(id),
    onSuccess: () => { toast.success("Rule deleted"); setDeleteId(null); invalidate(); },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Failed"),
  });

  const rules: CASBRule[] = Array.isArray(data?.data?.data) ? data.data.data : [];
  const defaults: any[] = Array.isArray(data?.data?.default_rules) ? data.data.default_rules : [];
  const paged = useMemo(() => rules.slice((page - 1) * limit, page * limit), [rules, page, limit]);

  const closeForm = () => { setShowForm(false); setEditRule(null); setForm(EMPTY_RULE); };

  const openCreate = (preset?: RuleForm) => {
    setEditRule(null);
    setForm(preset ?? EMPTY_RULE);
    setShowForm(true);
  };

  const openEdit = (rule: CASBRule) => {
    setEditRule(rule);
    setForm({
      name: rule.name,
      category: rule.category ?? "",
      app: rule.app ?? "",
      activity: rule.activity || "any",
      sanctioned: rule.sanctioned === null ? "any" : rule.sanctioned ? "yes" : "no",
      min_risk: rule.min_risk === null ? "" : String(rule.min_risk),
      action: rule.action,
      priority: rule.priority,
    });
    setShowForm(true);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMut.mutate({
      name: form.name,
      category: form.category || "",
      app: form.app || "",
      activity: form.activity,
      // "any" has to travel as null, not as a value — otherwise the rule would
      // only ever match one side of the sanctioned/unsanctioned split.
      sanctioned: form.sanctioned === "any" ? null : form.sanctioned === "yes",
      min_risk: form.min_risk === "" ? null : Number(form.min_risk),
      action: form.action,
      priority: form.priority,
    });
  };

  return (
    <div className="bg-card rounded-xl border border-border">
      <div className="p-4 border-b border-border flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <ListOrdered className="w-4 h-4 text-brand-500" />
            <h3 className="font-semibold text-foreground">App-control rules</h3>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Your rules run first, in priority order. The first match wins; anything they don&apos;t cover falls
            through to the built-in defaults below.
          </p>
        </div>
        <button
          onClick={() => openCreate()}
          className="flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-white px-3 py-2 rounded-lg text-sm font-medium"
        >
          <Plus className="w-4 h-4" /> New Rule
        </button>
      </div>

      {!isLoading && rules.length === 0 && (
        <div className="px-4 py-3 border-b border-border flex flex-wrap gap-2">
          <span className="text-xs text-muted-foreground w-full">Start from a template:</span>
          {RULE_TEMPLATES.map(t => (
            <button
              key={t.label}
              onClick={() => openCreate(t.form)}
              title={t.hint}
              className="px-3 py-1.5 rounded-lg border border-border text-xs text-body hover:bg-elevated"
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-5 py-3 text-left font-medium">Priority</th>
              <th className="px-5 py-3 text-left font-medium">Rule</th>
              <th className="px-5 py-3 text-left font-medium">Activity</th>
              <th className="px-5 py-3 text-left font-medium">Action</th>
              <th className="px-5 py-3 text-left font-medium">Status</th>
              <th className="px-5 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-elevated">
            {isLoading ? (
              [...Array(3)].map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {[...Array(6)].map((__, j) => (
                    <td key={j} className="px-5 py-4"><div className="h-4 bg-elevated rounded w-3/4" /></td>
                  ))}
                </tr>
              ))
            ) : rules.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-10 text-subtle text-sm">
                  No custom rules yet — only the built-in defaults apply.
                </td>
              </tr>
            ) : (
              paged.map(rule => (
                <tr key={rule.id} className={cn("hover:bg-elevated", !rule.enabled && "opacity-60")}>
                  <td className="px-5 py-3 text-body tabular-nums">{rule.priority}</td>
                  <td className="px-5 py-3">
                    <p className="text-foreground font-medium">{rule.name}</p>
                    <p className="text-xs text-subtle">{matchSummary(rule)}</p>
                  </td>
                  <td className="px-5 py-3 text-body text-xs capitalize">{rule.activity}</td>
                  <td className="px-5 py-3">
                    <span className={cn("px-2.5 py-1 rounded-full text-xs font-medium uppercase border", actionStyle(rule.action))}>
                      {rule.action}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <button
                      onClick={() => toggleMut.mutate(rule.id)}
                      title={rule.enabled ? "Click to disable" : "Click to enable"}
                      className={cn("inline-flex items-center gap-1.5 text-xs font-medium",
                        rule.enabled ? "text-success" : "text-subtle")}
                    >
                      {rule.enabled ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                      {rule.enabled ? "Enabled" : "Disabled"}
                    </button>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openEdit(rule)} title="Edit rule"
                        className="p-1.5 hover:bg-elevated rounded text-subtle hover:text-body">
                        <Edit className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setDeleteId(rule.id)} title="Delete rule"
                        className="p-1.5 hover:bg-red-500/10 rounded text-subtle hover:text-danger">
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

      <Pagination
        page={page}
        totalPages={Math.ceil(rules.length / limit)}
        total={rules.length}
        limit={limit}
        onPageChange={setPage}
        onLimitChange={n => { setLimit(n); setPage(1); }}
      />

      {/* Built-in fallbacks */}
      <div className="px-5 py-4 border-t border-border">
        <div className="flex items-center gap-2 mb-2">
          <Lock className="w-3.5 h-3.5 text-subtle" />
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Built-in defaults (applied last)
          </p>
        </div>
        <div className="space-y-1.5">
          {defaults.map((d, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className={cn("px-2 py-0.5 rounded text-[10px] font-semibold uppercase border", actionStyle(d.action))}>
                {d.action}
              </span>
              <span className="text-muted-foreground">{d.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Create / edit modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-card rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="font-semibold text-foreground">{editRule ? "Edit Rule" : "New App-Control Rule"}</h3>
              <button onClick={closeForm} className="text-subtle hover:text-body"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={submit} className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-body mb-1">Rule name *</label>
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Block uploads to unsanctioned apps"
                  required
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              <p className="text-xs text-muted-foreground">
                Leave a condition on &quot;any&quot; to ignore it. All the conditions you do set must match.
              </p>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-body mb-1">Activity</label>
                  <select
                    value={form.activity}
                    onChange={e => setForm(f => ({ ...f, activity: e.target.value }))}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    <option value="any">Any activity</option>
                    {ACTIVITIES.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-body mb-1">Category</label>
                  <select
                    value={form.category}
                    onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    <option value="">Any category</option>
                    {CATEGORIES.map(c => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-body mb-1">App name</label>
                  <input
                    value={form.app}
                    onChange={e => setForm(f => ({ ...f, app: e.target.value }))}
                    placeholder="Any app"
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-body mb-1">Sanction status</label>
                  <select
                    value={form.sanctioned}
                    onChange={e => setForm(f => ({ ...f, sanctioned: e.target.value as RuleForm["sanctioned"] }))}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    <option value="any">Any</option>
                    <option value="yes">Sanctioned only</option>
                    <option value="no">Unsanctioned only</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-body mb-1">Minimum risk score</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={form.min_risk}
                    onChange={e => setForm(f => ({ ...f, min_risk: e.target.value }))}
                    placeholder="Any risk"
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-body mb-1">Priority (1 = first)</label>
                  <input
                    type="number"
                    min={1}
                    value={form.priority}
                    onChange={e => setForm(f => ({ ...f, priority: Number(e.target.value) }))}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-body mb-1">Action</label>
                <div className="flex gap-2">
                  {["block", "alert", "allow"].map(a => (
                    <button
                      key={a}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, action: a }))}
                      className={cn(
                        "px-4 py-1.5 rounded-lg text-sm font-medium border capitalize transition-all",
                        form.action === a
                          ? a === "block" ? "bg-red-600 text-white border-red-600"
                            : a === "alert" ? "bg-yellow-500 text-white border-yellow-500"
                            : "bg-green-600 text-white border-green-600"
                          : "bg-card text-body border-border hover:bg-elevated"
                      )}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={closeForm}
                  className="flex-1 border border-border text-body py-2 rounded-lg text-sm hover:bg-elevated">
                  Cancel
                </button>
                <button type="submit" disabled={saveMut.isPending || !form.name.trim()}
                  className="flex-1 bg-brand-500 text-white py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60">
                  {saveMut.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  {editRule ? "Save changes" : "Create rule"}
                </button>
              </div>
            </form>
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
            <h3 className="text-center font-semibold text-foreground mb-2">Delete this rule?</h3>
            <p className="text-center text-sm text-muted-foreground mb-6">
              Activity it covered will fall through to your other rules, then to the built-in defaults.
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

function InlineTester() {
  const [form, setForm] = useState({ app: "", category: "file_transfer", activity: "upload", sanctioned: false, risk_score: 60 });
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const r = await casbApi.appControl(form);
      setResult(r.data);
    } catch (e: any) {
      toast.error(e.response?.data?.error || "CASB app-control check failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <div className="flex items-center gap-2 mb-1">
        <ShieldCheck className="w-4 h-4 text-brand-500" />
        <h3 className="font-semibold text-foreground">Inline app-control — test a decision</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-3">See what the inline CASB would do for a given SaaS activity.</p>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <input placeholder="App (optional)" value={form.app} onChange={(e) => setForm({ ...form, app: e.target.value })}
          className="bg-sunken border border-border rounded-lg px-3 py-2 text-sm text-foreground" />
        <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
          className="bg-sunken border border-border rounded-lg px-3 py-2 text-sm text-foreground">
          {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
        </select>
        <select value={form.activity} onChange={(e) => setForm({ ...form, activity: e.target.value })}
          className="bg-sunken border border-border rounded-lg px-3 py-2 text-sm text-foreground">
          {ACTIVITIES.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={form.sanctioned} onChange={(e) => setForm({ ...form, sanctioned: e.target.checked })} className="accent-brand-500" />
          Sanctioned
        </label>
        <button onClick={run} disabled={loading}
          className="flex items-center justify-center gap-2 bg-brand-500 hover:bg-brand-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" />} Evaluate
        </button>
      </div>
      {result && (
        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <span className={cn("px-3 py-1 rounded-full text-xs font-semibold uppercase border", actionStyle(result.action))}>{result.action}</span>
          <span className="text-sm text-muted-foreground">{result.reason}</span>
          {/* Naming the matched rule is the difference between "it blocked" and
              "I know which rule to change". */}
          {result.matched_rule && (
            <span className="text-xs text-subtle">
              matched: <span className="text-body">{result.matched_rule}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

const SAMPLE = `Salary Sheet 2026.xlsx, public
NDA - Acme Corp.pdf, external, competitor.com
Team Offsite Photos.zip, public
payroll-register.csv, internal
Project Roadmap.docx, private`;

function OOBScanner() {
  const [text, setText] = useState(SAMPLE);
  const [report, setReport] = useState<any>(null);
  const [findingsPage, setFindingsPage] = useState(1);
  const [findingsLimit, setFindingsLimit] = useState(10);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const files = text.split("\n").map((line) => {
        const [name, share, ...ext] = line.split(",").map((s) => s.trim());
        if (!name) return null;
        return { name, share_type: share || "private", external_domains: ext.filter(Boolean) };
      }).filter(Boolean);
      const r = await casbApi.oobAnalyze({ provider: "manual", files: files as any[] });
      setReport(r.data);
      setFindingsPage(1);
    } catch (e: any) {
      toast.error(e.response?.data?.error || "CASB OOB scan failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <div className="flex items-center gap-2 mb-1">
        <CloudCog className="w-4 h-4 text-brand-500" />
        <h3 className="font-semibold text-foreground">Out-of-band — cloud share scan</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Paste a file inventory (one per line: <code className="text-body">name, share_type, external_domain…</code>).
        A live connector would fetch this from Google Workspace / M365 via OAuth; this scans whatever inventory you provide.
      </p>
      <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)}
        className="w-full bg-sunken border border-border rounded-lg p-3 text-sm text-foreground font-mono resize-y" />
      <button onClick={run} disabled={loading}
        className="mt-3 flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudCog className="w-4 h-4" />} Scan shares
      </button>

      {report && (
        <div className="mt-4">
          <div className="flex gap-3 mb-3 text-xs">
            <span className="text-muted-foreground">Scanned <b className="text-foreground">{report.scanned}</b></span>
            <span className="text-danger">High {report.counts?.high ?? 0}</span>
            <span className="text-warning">Medium {report.counts?.medium ?? 0}</span>
            <span className="text-info">Low {report.counts?.low ?? 0}</span>
          </div>
          <div className="space-y-2">
            {(report.findings ?? []).length === 0 ? (
              <p className="text-sm text-success">No risky shares found.</p>
            ) : (
              (report.findings as any[])
                .slice((findingsPage - 1) * findingsLimit, findingsPage * findingsLimit)
                .map((f: any, i: number) => (
                <div key={i} className="flex items-start gap-3 bg-sunken rounded-lg p-3">
                  <span className={cn("px-2 py-0.5 rounded text-xs font-semibold uppercase flex-shrink-0", sevStyle(f.severity))}>{f.severity}</span>
                  <div className="min-w-0">
                    <div className="text-sm text-foreground font-mono truncate">{f.file}</div>
                    <div className="text-xs text-muted-foreground">{f.issue}</div>
                    <div className="text-xs text-brand-500 mt-0.5">→ {f.recommendation}</div>
                  </div>
                </div>
              ))
            )}
          </div>

          <Pagination
            page={findingsPage}
            totalPages={Math.ceil((report.findings ?? []).length / findingsLimit)}
            total={(report.findings ?? []).length}
            limit={findingsLimit}
            onPageChange={setFindingsPage}
            onLimitChange={n => { setFindingsLimit(n); setFindingsPage(1); }}
            className="px-0"
          />
        </div>
      )}
    </div>
  );
}

export default function CASBPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">CASB — Cloud Access Security</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Inline control over SaaS activity, and out-of-band scanning of what&apos;s already shared in your cloud apps
        </p>
      </div>

      <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-3 text-xs text-info flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
        Inline app-control layers on the existing proxy (DLP + threat inspection). Out-of-band connectors for Google
        Workspace / M365 need per-tenant OAuth; until configured, use the manual inventory scanner below.
      </div>

      <AppControlRules />
      <InlineTester />
      <OOBScanner />
    </div>
  );
}
