"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authApi, companyApi, enforcementApi, mfaApi, monitoringApi, settingsApi } from "@/lib/api";
import {
  Lock, ShieldCheck, Bell, Loader2, Save, ArrowRight, KeyRound,
  LogOut, AlertTriangle, ChevronRight, Building2, Clock, Trash2, Camera, Eye, EyeOff,
} from "lucide-react";
import { ScheduleEditor, EnforcementBadge, defaultSchedule, type ScheduleValue } from "@/components/enforcement/ScheduleEditor";
import { cn } from "@/lib/utils";
import { usePermissions, PERMISSIONS } from "@/lib/permissions";
import { MFACard } from "@/components/security/MFACard";
import { toast } from "sonner";

const inputClass =
  "w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60";

function Panel({
  title, description, children, action,
}: { title: string; description: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="bg-card rounded-xl border border-border shadow-sm">
      <div className="p-5 border-b border-border flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold text-foreground">{title}</h3>
          <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Toggle({
  checked, onChange, disabled, label,
}: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={cn(
        "relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
        checked ? "bg-brand-500" : "bg-border-strong"
      )}
    >
      <span className={cn("inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
        checked ? "translate-x-4" : "translate-x-0.5")} />
    </button>
  );
}

// ─── Password ─────────────────────────────────────────────────────────────────

function PasswordPanel() {
  const [form, setForm] = useState({ current_password: "", new_password: "", confirm: "" });
  const [error, setError] = useState("");

  const mut = useMutation({
    mutationFn: authApi.changePassword,
    onSuccess: () => {
      toast.success("Password changed — every other session has been signed out");
      setForm({ current_password: "", new_password: "", confirm: "" });
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Could not change the password"),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (form.new_password !== form.confirm) return setError("The new passwords don't match");
    if (form.new_password.length < 8) return setError("Use at least 8 characters");
    setError("");
    mut.mutate({ current_password: form.current_password, new_password: form.new_password });
  };

  return (
    <Panel title="Password" description="Changing your password signs out every other device">
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-danger rounded-lg px-3 py-2 mb-4 text-sm">{error}</div>
      )}
      <form onSubmit={submit} className="space-y-4 max-w-md">
        {[
          { key: "current_password", label: "Current password" },
          { key: "new_password", label: "New password" },
          { key: "confirm", label: "Confirm new password" },
        ].map(f => (
          <div key={f.key}>
            <label className="block text-xs font-medium text-body mb-1">{f.label}</label>
            <input
              type="password"
              value={(form as any)[f.key]}
              onChange={e => { setForm(s => ({ ...s, [f.key]: e.target.value })); setError(""); }}
              className={inputClass}
              required
            />
          </div>
        ))}
        <button
          type="submit"
          disabled={mut.isPending}
          className="flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-on-brand px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60"
        >
          {mut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
          Change password
        </button>
      </form>
    </Panel>
  );
}

// ─── Notifications ────────────────────────────────────────────────────────────

const NOTIFICATION_ROWS = [
  { key: "security_alerts", label: "Immediate security alerts", description: "Malware blocked, or sensitive data stopped on its way out" },
  { key: "incident_digest", label: "Incident digest", description: "One email when incidents build up, instead of one per event" },
  { key: "access_requests", label: "Access requests", description: "When an employee asks for a blocked site" },
  { key: "device_enrolment", label: "New device enrolled", description: "A machine registered with your organization" },
  { key: "inactivity_alerts", label: "Inactivity warnings", description: "Agents have stopped reporting — silence isn't safety" },
  { key: "weekly_summary", label: "Weekly summary", description: "Sent every week, even a quiet one" },
];

function NotificationsPanel({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const [prefs, setPrefs] = useState<any>(null);
  const [dirty, setDirty] = useState(false);

  const { data } = useQuery({ queryKey: ["company-profile"], queryFn: () => companyApi.get() });

  useEffect(() => {
    if (data?.data?.notification_prefs) {
      setPrefs(data.data.notification_prefs);
      setDirty(false);
    }
  }, [data]);

  const mut = useMutation({
    mutationFn: (payload: any) => companyApi.updateNotifications(payload),
    onSuccess: () => {
      toast.success("Notification preferences saved");
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["company-profile"] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Could not save"),
  });

  return (
    <Panel title="Email notifications" description="Which emails your administrators and analysts receive">
      {!prefs ? (
        <Loader2 className="w-4 h-4 animate-spin text-subtle" />
      ) : (
        <>
          <div className="divide-y divide-elevated">
            {NOTIFICATION_ROWS.map(row => (
              <div key={row.key} className="flex items-start justify-between gap-4 py-3 first:pt-0">
                <div className="min-w-0">
                  <p className="text-sm text-foreground">{row.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{row.description}</p>
                </div>
                <Toggle
                  label={row.label}
                  checked={!!prefs[row.key]}
                  disabled={!canWrite}
                  onChange={v => { setPrefs((p: any) => ({ ...p, [row.key]: v })); setDirty(true); }}
                />
              </div>
            ))}
            <div className="flex items-start justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="text-sm text-foreground">Digest threshold</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  How many incidents must pile up before the digest is sent
                </p>
              </div>
              <input
                type="number"
                min={1}
                max={500}
                value={prefs.digest_threshold ?? 10}
                disabled={!canWrite || !prefs.incident_digest}
                onChange={e => { setPrefs((p: any) => ({ ...p, digest_threshold: Number(e.target.value) })); setDirty(true); }}
                className="w-20 bg-background border border-border rounded-lg px-2 py-1.5 text-sm text-foreground text-center focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-50"
              />
            </div>
          </div>

          {canWrite && (
            <button
              onClick={() => mut.mutate(prefs)}
              disabled={!dirty || mut.isPending}
              className="mt-4 flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-on-brand px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {mut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save preferences
            </button>
          )}
        </>
      )}
    </Panel>
  );
}

// ─── Organization security ────────────────────────────────────────────────────

function OrgSecurityPanel({ canManageUsers }: { canManageUsers: boolean }) {
  const qc = useQueryClient();

  const { data: mfaData } = useQuery({
    queryKey: ["org-mfa-policy"],
    queryFn: () => mfaApi.orgPolicy(),
    enabled: canManageUsers,
  });
  const policy = mfaData?.data ?? {};

  const { data: sslData } = useQuery({ queryKey: ["settings-mitm"], queryFn: () => settingsApi.getMITM() });
  const ssl = sslData?.data ?? {};

  const mfaMut = useMutation({
    mutationFn: (required: boolean) => mfaApi.setOrgPolicy(required),
    onSuccess: (_r, required) => {
      toast.success(required ? "Two-factor is now required for everyone" : "Two-factor requirement removed");
      qc.invalidateQueries({ queryKey: ["org-mfa-policy"] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Could not change the setting"),
  });

  return (
    <Panel title="Organization security" description="Rules that apply to everyone in this organization">
      <div className="divide-y divide-elevated">
        {canManageUsers && (
          <div className="flex items-start justify-between gap-4 py-3 first:pt-0">
            <div className="min-w-0">
              <p className="text-sm text-foreground">Require two-factor authentication</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {policy.enrolled_users ?? 0} of {policy.total_users ?? 0} dashboard users have it enabled
              </p>
            </div>
            <Toggle
              label="Require two-factor authentication"
              checked={!!policy.required}
              disabled={mfaMut.isPending}
              onChange={v => mfaMut.mutate(v)}
            />
          </div>
        )}

        <div className="flex items-start justify-between gap-4 py-3">
          <div className="min-w-0">
            <p className="text-sm text-foreground">SSL inspection</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {ssl.enabled
                ? `On — ${(ssl.bypass_domains ?? []).length} domains excluded from decryption`
                : "Off — DLP can only inspect plain HTTP uploads"}
            </p>
          </div>
          <Link href="/dashboard/ssl-inspection"
            className="flex items-center gap-1 text-xs text-brand-500 hover:text-brand-400 whitespace-nowrap">
            Manage <ArrowRight className="w-3 h-3" />
          </Link>
        </div>

        <div className="flex items-start justify-between gap-4 py-3">
          <div className="min-w-0">
            <p className="text-sm text-foreground">Who can sign in</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Roles, permissions and team scoping for dashboard users
            </p>
          </div>
          <Link href="/dashboard/users"
            className="flex items-center gap-1 text-xs text-brand-500 hover:text-brand-400 whitespace-nowrap">
            Team &amp; Access <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      </div>
    </Panel>
  );
}


// ─── Working hours ────────────────────────────────────────────────────────────

/**
 * The organization-wide default. This is the setting that makes BYOD workable:
 * without it every enrolled laptop is intercepted around the clock, including
 * somebody's own machine at midnight.
 */
function WorkingHoursPanel({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<ScheduleValue | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["enforcement-schedule"],
    queryFn: () => enforcementApi.getOrgSchedule(),
  });
  const { data: tzData } = useQuery({
    queryKey: ["timezones"],
    queryFn: () => companyApi.timezones(),
  });

  const saved = data?.data?.schedule ?? null;
  const state = data?.data?.state ?? null;
  const orgTimezone = data?.data?.org_timezone || "UTC";
  const timezones: string[] = tzData?.data?.timezones ?? tzData?.data ?? [];

  useEffect(() => {
    if (draft !== null) return;
    if (saved) {
      setDraft({
        timezone: saved.timezone,
        windows: saved.windows ?? [],
        holidays: saved.holidays ?? [],
        off_hours_mode: saved.off_hours_mode ?? "full_pause",
        enabled: saved.enabled ?? true,
      });
    }
  }, [saved, draft]);

  const saveMut = useMutation({
    mutationFn: (value: ScheduleValue) => enforcementApi.putOrgSchedule(value),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["enforcement-schedule"] });
      qc.invalidateQueries({ queryKey: ["devices"] });
      toast.success("Working hours saved — devices pick this up within a minute");
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Could not save the schedule"),
  });

  const removeMut = useMutation({
    mutationFn: () => enforcementApi.deleteOrgSchedule(),
    onSuccess: () => {
      setDraft(null);
      qc.invalidateQueries({ queryKey: ["enforcement-schedule"] });
      qc.invalidateQueries({ queryKey: ["devices"] });
      toast.success("Schedule removed — agents enforce continuously again");
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Could not remove the schedule"),
  });

  if (isLoading) {
    return <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Working hours</h2>
        <p className="text-sm text-muted-foreground mt-1">
          When the agent is allowed to enforce. Applies to every device unless a team or a single
          device overrides it.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex gap-3">
          <AlertTriangle className="w-4 h-4 text-brand-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-muted-foreground space-y-1.5">
            <p>
              With <span className="text-body font-medium">no schedule</span>, agents enforce 24×7 —
              which is what a company-owned laptop should do, and what every device does today.
            </p>
            <p>
              A schedule matters for laptops people own themselves. Outside the hours you set, the
              agent takes itself out of the network path entirely: no interception, no blocking,
              nothing recorded. Their evening is their own.
            </p>
          </div>
        </div>
      </div>

      {saved && (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
          <EnforcementBadge state={state} />
          <span className="text-sm text-muted-foreground">{state?.reason}</span>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card p-5">
        <ScheduleEditor
          value={draft ?? defaultSchedule(orgTimezone)}
          onChange={setDraft}
          timezones={timezones}
          disabled={!canWrite}
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <div>
          {saved && canWrite && (
            <button
              onClick={() => removeMut.mutate()}
              disabled={removeMut.isPending}
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-danger"
            >
              <Trash2 className="w-4 h-4" /> Remove schedule (enforce 24×7)
            </button>
          )}
        </div>
        <button
          onClick={() => draft && saveMut.mutate(draft)}
          disabled={!canWrite || !draft || draft.windows.length === 0 || saveMut.isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-brand-600 disabled:opacity-60"
        >
          {saveMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save working hours
        </button>
      </div>
    </div>
  );
}


// ─── Monitoring (screenshots & activity) ──────────────────────────────────────

/**
 * Screenshot + activity capture. Off by default and deliberately blunt about
 * what it does: this records people's screens. It obeys the same working-hours
 * gate as everything else, so a personal device outside its window captures
 * nothing regardless of this switch.
 */
function MonitoringPanel({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<any | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["monitoring-settings"],
    queryFn: () => monitoringApi.getSettings(),
  });
  const saved = data?.data?.settings;
  const storage = data?.data?.storage;

  useEffect(() => {
    if (draft === null && saved) setDraft({ ...saved });
  }, [saved, draft]);

  const saveMut = useMutation({
    mutationFn: (v: any) => monitoringApi.updateSettings({
      enabled: v.enabled,
      min_interval_seconds: v.min_interval_seconds,
      max_interval_seconds: v.max_interval_seconds,
      idle_threshold_percent: v.idle_threshold_percent,
      blur: v.blur,
      retention_days: v.retention_days,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["monitoring-settings"] }); toast.success("Monitoring settings saved"); },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Could not save settings"),
  });

  if (isLoading || !draft) {
    return <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  }

  const set = (patch: any) => setDraft({ ...draft, ...patch });
  const mins = (s: number) => (s / 60).toFixed(s % 60 === 0 ? 0 : 1);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Screenshots &amp; activity</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Periodic screenshots and an activity level from keyboard, mouse and scroll input.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex gap-3">
          <AlertTriangle className="w-4 h-4 text-brand-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-muted-foreground space-y-1.5">
            <p>This records employees&apos; screens. Turn it on deliberately, and tell your team.</p>
            <p>
              Capture follows <b className="text-body">Working hours</b>: on a personal device outside its
              window, or while enforcement is paused, nothing is captured — this switch only decides
              <i> whether</i>, not <i>when</i>. Screens are stored in
              {" "}<b className="text-body">{storage === "r2" ? "Cloudflare R2" : "local storage"}</b>.
            </p>
          </div>
        </div>
      </div>

      <label className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3">
        <div>
          <div className="text-sm font-medium text-body">Capture screenshots</div>
          <div className="text-xs text-muted-foreground">Off means no screens are taken on any device.</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={draft.enabled}
          disabled={!canWrite}
          onClick={() => set({ enabled: !draft.enabled })}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${draft.enabled ? "bg-brand-500" : "bg-elevated border border-border-strong"}`}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${draft.enabled ? "translate-x-6" : "translate-x-1"}`} />
        </button>
      </label>

      <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4 ${draft.enabled ? "" : "opacity-50 pointer-events-none"}`}>
        <div className="rounded-xl border border-border bg-card p-4">
          <label className="block text-sm font-medium text-body mb-1">Capture interval</label>
          <p className="text-xs text-subtle mb-3">
            A screenshot is taken at a random point between these, so it can&apos;t be predicted. Currently
            every {mins(draft.min_interval_seconds)}–{mins(draft.max_interval_seconds)} min.
          </p>
          <div className="flex items-center gap-2">
            <NumberField label="Min (min)" value={draft.min_interval_seconds / 60}
              onChange={v => set({ min_interval_seconds: Math.max(1, Math.round(v * 60)) })} />
            <NumberField label="Max (min)" value={draft.max_interval_seconds / 60}
              onChange={v => set({ max_interval_seconds: Math.max(1, Math.round(v * 60)) })} />
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <label className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-body inline-flex items-center gap-2">
                {draft.blur ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />} Blur screenshots
              </div>
              <div className="text-xs text-muted-foreground">Prove presence without reading the screen.</div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={draft.blur}
              disabled={!canWrite}
              onClick={() => set({ blur: !draft.blur })}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${draft.blur ? "bg-brand-500" : "bg-elevated border border-border-strong"}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${draft.blur ? "translate-x-6" : "translate-x-1"}`} />
            </button>
          </label>
          <div>
            <label className="block text-sm font-medium text-body mb-1">Keep images for</label>
            <div className="flex items-center gap-2">
              <NumberField label="Days" value={draft.retention_days}
                onChange={v => set({ retention_days: Math.max(0, Math.round(v)) })} />
              <span className="text-xs text-subtle">0 keeps forever</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={() => saveMut.mutate(draft)}
          disabled={!canWrite || saveMut.isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-brand-600 disabled:opacity-60"
        >
          {saveMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save monitoring settings
        </button>
      </div>
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex-1">
      <span className="block text-[11px] text-subtle mb-0.5">{label}</span>
      <input
        type="number"
        min={0}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-brand-500"
      />
    </label>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type TabId = "password" | "two-factor" | "notifications" | "working-hours" | "monitoring" | "org-security" | "sessions";

const TABS: { id: TabId; label: string; description: string; icon: React.ElementType; orgLevel?: boolean }[] = [
  { id: "password", label: "Password", description: "Sign-in credentials", icon: Lock },
  { id: "two-factor", label: "Two-factor", description: "Authenticator app", icon: ShieldCheck },
  { id: "notifications", label: "Notifications", description: "Email preferences", icon: Bell, orgLevel: true },
  { id: "working-hours", label: "Working hours", description: "When agents enforce", icon: Clock, orgLevel: true },
  { id: "monitoring", label: "Monitoring", description: "Screenshots & activity", icon: Camera, orgLevel: true },
  { id: "org-security", label: "Organization security", description: "Org-wide rules", icon: Building2, orgLevel: true },
  { id: "sessions", label: "Sessions", description: "Signed-in devices", icon: LogOut },
];

export default function SettingsPage() {
  const { can } = usePermissions();
  const canWriteSettings = can(PERMISSIONS.settingsWrite);
  const canManageUsers = can(PERMISSIONS.usersWrite);
  const canReadOrg = can(PERMISSIONS.settingsRead);

  // The selected section is kept in the URL hash, so a link to a specific
  // settings page works and a refresh doesn't bounce you back to the first tab.
  const [active, setActive] = useState<TabId>("password");

  useEffect(() => {
    const fromHash = () => {
      const id = window.location.hash.replace("#", "") as TabId;
      if (TABS.some(t => t.id === id)) setActive(id);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

  const select = (id: TabId) => {
    setActive(id);
    window.history.replaceState(null, "", `#${id}`);
  };

  const tabs = TABS.filter(t => !t.orgLevel || canReadOrg);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Settings</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Your sign-in security, and how this organization is configured
        </p>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Section list — the settings equivalent of a sidebar */}
        <aside className="lg:w-64 flex-shrink-0">
          <nav className="bg-card rounded-xl border border-border shadow-sm p-2 lg:sticky lg:top-6 space-y-1">
            {tabs.map(tab => {
              const selected = active === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => select(tab.id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors border-l-2",
                    selected
                      ? "bg-brand-500/10 border-brand-500"
                      : "border-transparent hover:bg-elevated"
                  )}
                >
                  <tab.icon className={cn("w-4 h-4 flex-shrink-0", selected ? "text-brand-500" : "text-subtle")} />
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-sm font-medium truncate",
                      selected ? "text-foreground" : "text-body")}>
                      {tab.label}
                    </span>
                    <span className="block text-[11px] text-subtle truncate">{tab.description}</span>
                  </span>
                  <ChevronRight className={cn("w-3.5 h-3.5 flex-shrink-0",
                    selected ? "text-brand-500" : "text-faint")} />
                </button>
              );
            })}
          </nav>

          {/* Company details live on their own page, so this points there
              instead of duplicating the form inside Settings. */}
          <Link
            href="/dashboard/profile"
            className="mt-3 bg-card rounded-xl border border-border shadow-sm p-3 flex items-center gap-3 hover:bg-elevated transition-colors"
          >
            <Building2 className="w-4 h-4 text-subtle flex-shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-body">Company profile</span>
              <span className="block text-[11px] text-subtle">GST, address, contacts</span>
            </span>
            <ArrowRight className="w-3.5 h-3.5 text-faint flex-shrink-0" />
          </Link>
        </aside>

        {/* Detail for the selected section */}
        <div className="flex-1 min-w-0 space-y-4">
          {active === "password" && <PasswordPanel />}
          {active === "two-factor" && <MFACard />}
          {active === "notifications" && <NotificationsPanel canWrite={canWriteSettings} />}
          {active === "working-hours" && <WorkingHoursPanel canWrite={canWriteSettings} />}
          {active === "monitoring" && <MonitoringPanel canWrite={canWriteSettings} />}
          {active === "org-security" && <OrgSecurityPanel canManageUsers={canManageUsers} />}
          {active === "sessions" && (
            <Panel title="Sessions" description="Sign out of this browser">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <p className="text-sm text-muted-foreground max-w-lg">
                  Changing your password ends every other session automatically. To leave just this browser,
                  sign out here.
                </p>
                <button
                  onClick={() => { window.location.href = "/api/auth/signout"; }}
                  className="flex items-center gap-2 border border-border text-danger hover:bg-red-500/10 px-3 py-2 rounded-lg text-sm whitespace-nowrap"
                >
                  <LogOut className="w-4 h-4" /> Sign out
                </button>
              </div>
            </Panel>
          )}

          {(active === "notifications" || active === "org-security" || active === "working-hours" || active === "monitoring") && !canWriteSettings && (
            <div className="bg-brand-500/10 border border-brand-500/30 rounded-xl p-4 flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-brand-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-muted-foreground">
                Your role can view these settings but not change them.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
