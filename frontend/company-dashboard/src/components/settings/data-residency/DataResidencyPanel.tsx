"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowRight, Check, CheckCircle2, CircleDashed, Copy, Database, HardDrive,
  Info, Loader2, Lock, MoveRight, Plus, ServerCog, ShieldCheck, Unplug, XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { residencyApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { DATABASES, FILE_STORES, customRequestLink, providerName, type FieldDef, type Provider } from "./catalog";

// Settings → Data residency. A company keeps everything its employees
// generate (activity, DLP findings, sessions, screenshots) in a database and
// bucket it owns. The API is test-first: nothing is saved until Aavishield has
// connected, created its tables and proved read/write/delete, so this page
// mostly has to make each step legible.

type CheckStep = { id: string; label: string; ok: boolean; detail?: string };
type CheckResult = { ok: boolean; steps: CheckStep[]; error?: string };

type ResidencyConfig = {
  enabled: boolean;
  db_provider: string;
  db_summary: Record<string, any> | null;
  db_status: string;
  db_error: string;
  db_verified_at: string | null;
  db_checked_at: string | null;
  files_provider: string;
  files_summary: Record<string, any> | null;
  files_status: string;
  files_error: string;
  files_verified_at: string | null;
  files_checked_at: string | null;
  migration_status: string;
  migration_progress: Record<string, number> | null;
  migration_error: string;
  migration_started_at: string | null;
  migration_finished_at: string | null;
};

type ResidencyState = {
  config: ResidencyConfig;
  routing: { database: "aavishield" | "company"; files: "aavishield" | "company" };
  aavishield_history: { events: number; screenshots: number };
  held_batches: number;
  egress_ips: string[] | null;
};

const inputClass =
  "w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60";

const SUMMARY_LABELS: Record<string, string> = {
  tls: "Encryption", uri: "Connection string", access_key_id: "Access key ID", account_id: "Account ID",
  account_name: "Storage account", path_style: "Path-style addressing", prefix: "Folder",
};
const TLS_LABELS: Record<string, string> = {
  "verify-full": "Encrypted, certificate verified", require: "Encrypted", disable: "Not encrypted",
};

function summaryValue(k: string, v: unknown): string {
  if (k === "tls") return TLS_LABELS[String(v)] ?? String(v);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

function when(iso?: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} disabled={disabled}
      className={cn("relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
        checked ? "bg-brand-500" : "bg-border-strong")}>
      <span className={cn("inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform", checked ? "translate-x-5" : "translate-x-0.5")} />
    </button>
  );
}

function StatusPill({ status, company }: { status: string; company: boolean }) {
  if (!company) {
    return <span className="inline-flex items-center gap-1.5 rounded-[4px] border border-border bg-elevated px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
      <CircleDashed className="h-3 w-3" /> Aavishield storage
    </span>;
  }
  if (status === "unreachable") {
    return <span className="inline-flex items-center gap-1.5 rounded-[4px] border border-red-500/30 bg-red-500/10 px-2.5 py-0.5 text-xs font-medium text-danger">
      <XCircle className="h-3 w-3" /> Unreachable
    </span>;
  }
  return <span className="inline-flex items-center gap-1.5 rounded-[4px] border border-green-500/30 bg-green-500/10 px-2.5 py-0.5 text-xs font-medium text-green-600 dark:text-green-400">
    <CheckCircle2 className="h-3 w-3" /> Connected
  </span>;
}

function CopyBlock({ title, code }: { title: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-lg border border-border bg-background">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">{title}</span>
        <button type="button" onClick={() => { navigator.clipboard?.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-2 text-xs leading-5 text-body"><code>{code}</code></pre>
    </div>
  );
}

function CheckList({ check }: { check: CheckResult }) {
  return (
    <ul className={cn("space-y-2 rounded-lg border p-3", check.ok ? "border-green-500/30 bg-green-500/5" : "border-red-500/30 bg-red-500/5")}>
      {check.steps.map((s) => (
        <li key={s.id} className="flex items-start gap-2 text-sm">
          {s.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-500" /> : <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-danger" />}
          <span className="min-w-0">
            <span className="text-foreground">{s.label}</span>
            {s.detail && <span className="mt-0.5 block break-words text-xs text-danger">{s.detail}</span>}
          </span>
        </li>
      ))}
      {check.ok && <li className="pl-6 text-xs text-green-600 dark:text-green-400">Everything Aavishield needs works.</li>}
    </ul>
  );
}

// A typed confirmation for the changes that move where data goes.
function ConfirmDialog({ open, title, body, word, cta, danger, busy, onConfirm, onClose }: {
  open: boolean; title: string; body: React.ReactNode; word: string; cta: string; danger?: boolean; busy?: boolean;
  onConfirm: () => void; onClose: () => void;
}) {
  const [typed, setTyped] = useState("");
  useEffect(() => { if (open) setTyped(""); }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <div className="mt-2 space-y-2 text-sm text-muted-foreground">{body}</div>
        <label className="mt-4 block text-xs font-medium text-body">Type <b className="font-mono text-foreground">{word}</b> to confirm</label>
        <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} className={cn(inputClass, "mt-1 font-mono")} />
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-elevated hover:text-foreground">Cancel</button>
          <button disabled={typed !== word || busy} onClick={onConfirm}
            className={cn("flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50",
              danger ? "bg-red-600 hover:bg-red-700" : "bg-brand-500 hover:bg-brand-600")}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} {cta}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── One connector (database or file storage) ────────────────────────────────

function Field({ def, value, error, onChange, disabled, hasSaved }: {
  def: FieldDef; value: any; error?: string; onChange: (v: any) => void; disabled?: boolean; hasSaved?: boolean;
}) {
  const id = `dr-${def.key}`;
  if (def.type === "checkbox") {
    return (
      <label className="flex items-start gap-2 text-sm text-body sm:col-span-2">
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} disabled={disabled} className="mt-0.5" />
        {def.label}
      </label>
    );
  }
  return (
    <div className={cn(def.half ? "" : "sm:col-span-2")}>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-body">
        {def.label}{def.optional && !def.label.includes("optional") && <span className="font-normal text-subtle"> (optional)</span>}
      </label>
      {def.type === "select" ? (
        <select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value)} disabled={disabled} className={inputClass}>
          {def.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <input id={id} type={def.type === "password" ? "password" : def.type === "number" ? "number" : "text"}
          value={value ?? ""} onChange={(e) => onChange(e.target.value)} disabled={disabled} autoComplete="off" spellCheck={false}
          placeholder={def.secret && hasSaved ? "Saved — leave blank to keep it" : def.placeholder}
          aria-invalid={!!error} className={cn(inputClass, error && "border-red-500")} />
      )}
      {error ? <p className="mt-1 text-xs text-danger">{error}</p> : def.help && <p className="mt-1 text-xs text-subtle">{def.help}</p>}
    </div>
  );
}

function Connector({ kind, providers, state, canWrite, egressIPs }: {
  kind: "database" | "files";
  providers: Provider[];
  state: ResidencyState;
  canWrite: boolean;
  egressIPs: string[];
}) {
  const qc = useQueryClient();
  const cfg = state.config;
  const savedProvider = kind === "database" ? cfg.db_provider : cfg.files_provider;
  const summary = (kind === "database" ? cfg.db_summary : cfg.files_summary) ?? {};
  const status = kind === "database" ? cfg.db_status : cfg.files_status;
  const lastError = kind === "database" ? cfg.db_error : cfg.files_error;
  const checkedAt = kind === "database" ? cfg.db_checked_at : cfg.files_checked_at;
  const connected = !!savedProvider && status !== "not_configured";
  const company = kind === "database" ? state.routing.database === "company" : state.routing.files === "company";
  const noun = kind === "database" ? "database" : "file storage";

  const [editing, setEditing] = useState(!connected);
  const [providerId, setProviderId] = useState<string>(savedProvider || "");
  const [other, setOther] = useState(false);
  const [values, setValues] = useState<Record<string, any>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  useEffect(() => { if (!connected) setEditing(true); }, [connected]);

  const provider = providers.find((p) => p.id === providerId);
  const editingSaved = connected && providerId === savedProvider;

  const choose = (id: string) => {
    setOther(false);
    setProviderId(id);
    setCheck(null);
    setFieldErrors({});
    const p = providers.find((x) => x.id === id)!;
    // Editing the saved connection starts from what's saved (never secrets).
    setValues(id === savedProvider ? { ...(p.defaults ?? {}), ...summary } : { ...(p.defaults ?? {}) });
  };

  const payload = () => {
    const out: Record<string, any> = { provider: providerId };
    for (const f of provider?.fields ?? []) {
      let v = values[f.key];
      if (f.type === "number") v = v === "" || v === undefined ? 0 : Number(v);
      if (f.type === "checkbox") v = !!v;
      if (typeof v === "string") v = v.trim();
      if (v !== undefined) out[f.key] = v;
    }
    return out;
  };

  const handleError = (e: any) => {
    const d = e.response?.data;
    if (d?.fields) setFieldErrors(d.fields);
    if (d?.check) setCheck(d.check);
    toast.error(d?.error ?? `Could not reach the ${noun}`);
  };

  const testMut = useMutation({
    mutationFn: () => (kind === "database" ? residencyApi.testDatabase(payload()) : residencyApi.testFiles(payload())),
    onMutate: () => { setCheck(null); setFieldErrors({}); },
    onSuccess: (res) => setCheck(res.data),
    onError: handleError,
  });

  const saveMut = useMutation({
    mutationFn: () => (kind === "database" ? residencyApi.saveDatabase(payload()) : residencyApi.saveFiles(payload())),
    onMutate: () => { setCheck(null); setFieldErrors({}); },
    onSuccess: (res) => {
      setCheck(res.data.check);
      qc.setQueryData(["data-residency"], { data: res.data.state });
      setEditing(false);
      toast.success(kind === "database"
        ? "Database connected — new employee data now goes there"
        : "File storage connected — new screenshots now go there");
    },
    onError: handleError,
  });

  const disconnectMut = useMutation({
    mutationFn: () => (kind === "database" ? residencyApi.disconnectDatabase() : residencyApi.disconnectFiles()),
    onSuccess: (res) => {
      qc.setQueryData(["data-residency"], { data: res.data });
      setConfirmDisconnect(false);
      setProviderId("");
      setValues({});
      setCheck(null);
      toast.success(`Disconnected. New data goes to Aavishield's storage; your ${noun} was left as it is.`);
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Could not disconnect"),
  });

  const busy = testMut.isPending || saveMut.isPending;
  const Icon = kind === "database" ? Database : HardDrive;

  return (
    <section className="rounded-xl border border-border bg-card shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500/10"><Icon className="h-4 w-4 text-brand-500" /></div>
          <div>
            <h3 className="font-semibold text-foreground">{kind === "database" ? "Database" : "File storage"}</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {kind === "database"
                ? "Activity and incident logs, DLP findings, work sessions and screenshot records."
                : "Screenshot images. Records about them go to the database above."}
            </p>
          </div>
        </div>
        <StatusPill status={status} company={company} />
      </header>

      <div className="space-y-5 p-5">
        {/* Saved connection */}
        {connected && !editing && (
          <div className="space-y-3">
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-subtle">Provider</dt><dd className="text-foreground">{providerName(providers, savedProvider)}</dd></div>
              {Object.entries(summary).filter(([k]) => k !== "provider").map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-xs text-subtle">{SUMMARY_LABELS[k] ?? k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, " ")}</dt>
                  <dd className="truncate font-mono text-xs text-body" title={summaryValue(k, v)}>{summaryValue(k, v)}</dd>
                </div>
              ))}
            </dl>
            {status === "unreachable" ? (
              <div className="flex gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-danger" />
                <span className="text-body">
                  Aavishield couldn&apos;t reach this {noun} at {when(checkedAt)}. {kind === "database" && "New security events are being held and will be delivered when it's back. "}
                  <span className="mt-1 block break-words text-xs text-danger">{lastError}</span>
                </span>
              </div>
            ) : (
              <p className="flex items-center gap-1.5 text-xs text-subtle"><ShieldCheck className="h-3.5 w-3.5" /> Last checked {when(checkedAt)}. Credentials are encrypted and never shown again.</p>
            )}
            {canWrite && (
              <div className="flex flex-wrap gap-2">
                <button onClick={() => { setEditing(true); choose(savedProvider); }}
                  className="rounded-lg border border-border px-3 py-2 text-sm text-body hover:bg-elevated">Edit connection</button>
                <button onClick={() => setConfirmDisconnect(true)}
                  className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-danger hover:bg-red-500/10">
                  <Unplug className="h-4 w-4" /> Disconnect
                </button>
              </div>
            )}
          </div>
        )}

        {/* Choose and configure */}
        {editing && canWrite && (
          <>
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-foreground">Choose your {noun}</legend>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {providers.map((p) => (
                  <button key={p.id} type="button" onClick={() => choose(p.id)} aria-pressed={providerId === p.id && !other}
                    className={cn("flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                      providerId === p.id && !other ? "border-brand-500 bg-brand-500/5 ring-1 ring-brand-500" : "border-border hover:bg-elevated")}>
                    <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-elevated font-mono text-[11px] font-semibold text-body">{p.mark}</span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-foreground">{p.name}</span>
                      <span className="block text-[11px] leading-4 text-muted-foreground">{p.tagline}</span>
                    </span>
                  </button>
                ))}
                <button type="button" onClick={() => { setOther(true); setProviderId(""); setCheck(null); }} aria-pressed={other}
                  className={cn("flex items-start gap-3 rounded-lg border border-dashed p-3 text-left transition-colors",
                    other ? "border-brand-500 bg-brand-500/5 ring-1 ring-brand-500" : "border-border hover:bg-elevated")}>
                  <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-elevated"><Plus className="h-4 w-4 text-body" /></span>
                  <span>
                    <span className="block text-sm font-medium text-foreground">Other</span>
                    <span className="block text-[11px] leading-4 text-muted-foreground">Something not listed here</span>
                  </span>
                </button>
              </div>
            </fieldset>

            {other && (
              <div className="rounded-lg border border-border bg-elevated p-4">
                <p className="text-sm text-body">
                  {kind === "database"
                    ? "Using Oracle, Cassandra, DynamoDB, Snowflake or another database? "
                    : "Using another object store or a file server? "}
                  Tell us what you run and our engineers will scope a connector for it.
                </p>
                <Link href={customRequestLink(kind === "database" ? "database" : "file storage")}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-4 py-2 font-mono text-[12px] font-medium uppercase tracking-[0.06em] text-white hover:bg-brand-600">
                  Request a custom integration <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            )}

            {provider && !other && (
              <form onSubmit={(e) => { e.preventDefault(); saveMut.mutate(); }} className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  {provider.fields.map((f) => (
                    <Field key={f.key} def={f} value={values[f.key]} error={fieldErrors[f.key]} disabled={busy} hasSaved={editingSaved}
                      onChange={(v) => { setValues((s) => ({ ...s, [f.key]: v })); setFieldErrors((e) => ({ ...e, [f.key]: "" })); }} />
                  ))}
                </div>

                {/* What the account needs, and how to set it up */}
                <div className="space-y-3 rounded-lg border border-brand-500/30 bg-brand-500/5 p-4">
                  <p className="flex gap-2 text-sm text-body">
                    <Lock className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-500" />
                    <span><b className="text-foreground">Permissions needed: read, write and delete.</b> {provider.permissions}</span>
                  </p>
                  {kind === "database" && (
                    <p className="pl-6 text-xs text-muted-foreground">
                      Aavishield only creates and uses its own tables (named <code className="font-mono">aavishield_*</code>) and never reads anything else in your database.
                      Use a dedicated account rather than an administrator.
                    </p>
                  )}
                  {provider.snippet && <CopyBlock title={provider.snippet.title} code={provider.snippet.code} />}
                  <p className="flex gap-2 text-xs text-muted-foreground">
                    <ServerCog className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                    <span>
                      Aavishield connects over the internet, so the server must accept connections from Aavishield
                      {egressIPs.length > 0 ? <> — allow <b className="font-mono text-body">{egressIPs.join(", ")}</b> in your firewall</> : " (ask support for the IP addresses to allow)"}.
                      Private and internal addresses are refused.
                    </span>
                  </p>
                </div>

                {check && <CheckList check={check} />}

                <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
                  {connected && (
                    <button type="button" onClick={() => { setEditing(false); setCheck(null); }}
                      className="mr-auto rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-elevated hover:text-foreground">Cancel</button>
                  )}
                  <button type="button" onClick={() => testMut.mutate()} disabled={busy}
                    className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 font-mono text-[12px] font-medium uppercase tracking-[0.06em] text-body hover:bg-elevated disabled:opacity-60">
                    {testMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Test connection
                  </button>
                  <button type="submit" disabled={busy}
                    className="flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 font-mono text-[12px] font-medium uppercase tracking-[0.06em] text-white hover:bg-brand-600 disabled:opacity-60">
                    {saveMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save &amp; connect
                  </button>
                </div>
                {busy && <p className="text-right text-xs text-subtle">Connecting, creating tables and checking permissions — this can take up to a minute.</p>}
              </form>
            )}
          </>
        )}

        {!connected && !canWrite && (
          <p className="text-sm text-muted-foreground">Not connected — {kind === "database" ? "employee data" : "screenshots"} are kept in Aavishield&apos;s storage.</p>
        )}
      </div>

      <ConfirmDialog open={confirmDisconnect} word="DISCONNECT" cta="Disconnect" danger busy={disconnectMut.isPending}
        title={`Disconnect your ${noun}?`}
        body={<>
          <p>New {kind === "database" ? "employee data" : "screenshots"} will go to Aavishield&apos;s storage again.</p>
          <p>Nothing in your {noun} is deleted — but what&apos;s there will no longer appear on the dashboard.</p>
        </>}
        onConfirm={() => disconnectMut.mutate()} onClose={() => setConfirmDisconnect(false)} />
    </section>
  );
}

// ─── Moving earlier history ──────────────────────────────────────────────────

function HistoryCard({ state, canWrite }: { state: ResidencyState; canWrite: boolean }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const cfg = state.config;
  const running = cfg.migration_status === "running";
  const p = cfg.migration_progress ?? {};
  const held = state.aavishield_history;
  const anything = held.events > 0 || held.screenshots > 0;

  const mut = useMutation({
    mutationFn: () => residencyApi.moveHistory(),
    onSuccess: (res) => { qc.setQueryData(["data-residency"], { data: res.data }); setConfirm(false); toast.success("Moving your history — you can leave this page"); },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Could not start the move"),
  });

  if (!running && !anything && cfg.migration_status !== "failed" && cfg.migration_status !== "done") return null;

  const total = (p.events_total ?? 0) + (p.screenshots_total ?? 0);
  const done = (p.events_copied ?? 0) + (p.screenshots_copied ?? 0);
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500/10"><MoveRight className="h-4 w-4 text-brand-500" /></div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-foreground">Earlier history</h3>
          {running ? (
            <>
              <p className="mt-0.5 text-sm text-muted-foreground">Copying to your storage… Aavishield&apos;s copy is deleted only after everything has arrived.</p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-elevated"><div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${pct}%` }} /></div>
              <p className="mt-1.5 text-xs text-subtle">
                {(p.events_copied ?? 0).toLocaleString()} of {(p.events_total ?? 0).toLocaleString()} activity records ·{" "}
                {(p.screenshots_copied ?? 0).toLocaleString()} of {(p.screenshots_total ?? 0).toLocaleString()} screenshots
              </p>
            </>
          ) : anything ? (
            <>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Aavishield still holds <b className="text-body">{held.events.toLocaleString()}</b> activity records and{" "}
                <b className="text-body">{held.screenshots.toLocaleString()}</b> screenshots from before you connected. They aren&apos;t shown on the
                dashboard while your own storage is in use. Move them over to keep one complete history — in your storage, and nowhere else.
              </p>
              {cfg.migration_status === "failed" && (
                <p className="mt-2 break-words text-xs text-danger">The last attempt stopped: {cfg.migration_error}. Nothing was deleted; you can retry.</p>
              )}
              {canWrite && (
                <button onClick={() => setConfirm(true)} className="mt-3 flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 font-mono text-[12px] font-medium uppercase tracking-[0.06em] text-white hover:bg-brand-600">
                  Move history to my storage <ArrowRight className="h-4 w-4" />
                </button>
              )}
            </>
          ) : (
            <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-green-500" /> All history is in your storage{cfg.migration_finished_at ? ` (moved ${when(cfg.migration_finished_at)})` : ""}. Aavishield holds none of it.
            </p>
          )}
        </div>
      </div>
      <ConfirmDialog open={confirm} word="MOVE" cta="Move history" busy={mut.isPending} title="Move history to your storage?"
        body={<>
          <p>Every activity record, work session and screenshot Aavishield holds for your company is copied to your storage, checked, and then deleted from Aavishield.</p>
          <p>This runs in the background and can take a while for a large history. It can&apos;t be undone from here.</p>
        </>}
        onConfirm={() => mut.mutate()} onClose={() => setConfirm(false)} />
    </section>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function DataResidencyPanel({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const [confirmOff, setConfirmOff] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["data-residency"],
    queryFn: () => residencyApi.get(),
    refetchInterval: (q) => ((q.state.data as any)?.data?.config?.migration_status === "running" ? 3000 : 60000),
  });
  const state: ResidencyState | undefined = data?.data;

  const toggle = useMutation({
    mutationFn: ({ enabled, confirm }: { enabled: boolean; confirm?: string }) => residencyApi.setEnabled(enabled, confirm),
    onSuccess: (res, v) => {
      qc.setQueryData(["data-residency"], { data: res.data });
      setConfirmOff(false);
      toast.success(v.enabled ? "Turned on — now connect your database and file storage" : "Turned off — new data goes to Aavishield's storage");
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Could not change this setting"),
  });

  const egress = useMemo(() => state?.egress_ips ?? [], [state]);

  if (isLoading) return <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (isError || !state) return <p className="py-8 text-center text-sm text-danger">Could not load data residency settings.</p>;

  const cfg = state.config;
  const anyCompany = state.routing.database === "company" || state.routing.files === "company";

  const onToggle = (v: boolean) => {
    if (!v && anyCompany) return setConfirmOff(true);
    toggle.mutate({ enabled: v });
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Data residency</h2>
        <p className="mt-1 text-sm text-muted-foreground">Keep your employees&apos; data on infrastructure your company owns and controls.</p>
      </div>

      {/* Master switch */}
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-medium text-foreground">Store employee data in my own database and storage</p>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Activity logs, DLP findings, work sessions and screenshots are written to — and read back from — your servers.
              Until you connect them, data keeps going to Aavishield&apos;s storage so nothing is lost.
            </p>
          </div>
          <Toggle checked={cfg.enabled} onChange={onToggle} disabled={!canWrite || toggle.isPending} label="Store employee data in my own database and storage" />
        </div>

        {cfg.enabled && (
          <div className="mt-4 grid gap-2 border-t border-border pt-4 sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-lg bg-elevated px-3 py-2 text-sm">
              <span className="flex items-center gap-2 text-body"><Database className="h-4 w-4 text-subtle" /> Employee data</span>
              <StatusPill status={cfg.db_status} company={state.routing.database === "company"} />
            </div>
            <div className="flex items-center justify-between rounded-lg bg-elevated px-3 py-2 text-sm">
              <span className="flex items-center gap-2 text-body"><HardDrive className="h-4 w-4 text-subtle" /> Screenshots</span>
              <StatusPill status={cfg.files_status} company={state.routing.files === "company"} />
            </div>
          </div>
        )}
        {state.held_batches > 0 && (
          <p className="mt-3 flex items-start gap-2 text-xs text-warning">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            {state.held_batches} batch{state.held_batches === 1 ? "" : "es"} of security events are held (encrypted, for up to 72 hours) until your database is reachable again.
          </p>
        )}
      </div>

      {/* What moves, what stays */}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground"><ShieldCheck className="h-4 w-4 text-green-500" /> Goes to your storage</p>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            <li>Web, app, device and VPN activity and every incident</li>
            <li>DLP findings, including masked evidence of what was detected</li>
            <li>Work sessions, active time and screenshot records</li>
            <li>Screenshot images</li>
          </ul>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground"><Info className="h-4 w-4 text-subtle" /> Stays with Aavishield</p>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            <li>Your account, admins and their sign-in security</li>
            <li>Employee and device list — agents sign in against it</li>
            <li>Policies, access requests, billing and support tickets</li>
            <li>An encrypted queue of new events, only while your database is unreachable</li>
          </ul>
        </div>
      </div>

      {cfg.enabled ? (
        <>
          <Connector kind="database" providers={DATABASES} state={state} canWrite={canWrite} egressIPs={egress} />
          <Connector kind="files" providers={FILE_STORES} state={state} canWrite={canWrite} egressIPs={egress} />
          {anyCompany && <HistoryCard state={state} canWrite={canWrite} />}
        </>
      ) : (
        canWrite && (
          <p className="text-sm text-muted-foreground">Turn this on to connect a database and file storage.</p>
        )
      )}

      <ConfirmDialog open={confirmOff} word="DISABLE" cta="Turn off" danger busy={toggle.isPending}
        title="Stop using your own storage?"
        body={<>
          <p>New employee data and screenshots will go to Aavishield&apos;s storage again.</p>
          <p>Nothing in your database or bucket is deleted, but it will no longer appear on the dashboard. Your connection settings are kept, so you can turn this back on.</p>
        </>}
        onConfirm={() => toggle.mutate({ enabled: false, confirm: "DISABLE" })} onClose={() => setConfirmOff(false)} />
    </div>
  );
}
