"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { settingsApi } from "@/lib/api";
import { Globe, Bell, Shield, Database, Loader2, Check } from "lucide-react";
import { toast } from "sonner";

type SectionKey = "general" | "notifications" | "security_policy" | "data_retention";

const SECTIONS: { key: SectionKey; icon: any; title: string; description: string }[] = [
  { key: "general", icon: Globe, title: "General", description: "Platform name, timezone, and support contact" },
  { key: "notifications", icon: Bell, title: "Notifications", description: "Alert thresholds, email digests, and webhook integrations" },
  { key: "security_policy", icon: Shield, title: "Security Policy", description: "Default policies applied across all organizations" },
  { key: "data_retention", icon: Database, title: "Data Retention", description: "How long activity logs and audit trails are kept" },
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
      {children}
    </div>
  );
}

const inputCls = "w-full border border-border bg-background rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60";

export default function SettingsPage() {
  const qc = useQueryClient();
  const { data: session } = useSession();
  const canEdit = (session?.user?.superadmin_level ?? "full") === "full";

  const { data, isLoading } = useQuery({ queryKey: ["platform-settings"], queryFn: settingsApi.get });
  const [forms, setForms] = useState<Record<SectionKey, Record<string, any>>>({} as any);
  const [openSection, setOpenSection] = useState<SectionKey | null>(null);

  useEffect(() => {
    if (data?.data) setForms(data.data);
  }, [data]);

  const updateMut = useMutation({
    mutationFn: ({ key, value }: { key: SectionKey; value: Record<string, any> }) => settingsApi.update(key, value),
    onSuccess: (res, vars) => {
      toast.success(`${SECTIONS.find(s => s.key === vars.key)?.title} settings saved`);
      qc.invalidateQueries({ queryKey: ["platform-settings"] });
      setOpenSection(null);
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Failed to save"),
  });

  const setField = (section: SectionKey, field: string, value: any) => {
    setForms(f => ({ ...f, [section]: { ...f[section], [field]: value } }));
  };

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-2xl animate-pulse">
        {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-card rounded-xl border border-border" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Settings</h2>
        <p className="text-sm text-muted-foreground mt-1">Platform-level configuration</p>
      </div>

      {!canEdit && (
        <div className="bg-brand-500/10 border border-brand-500/20 rounded-xl p-4 text-sm text-brand-500">
          You have support-level access — you can view these settings but not change them.
        </div>
      )}

      {SECTIONS.map((s) => {
        const isOpen = openSection === s.key;
        const values = forms[s.key] ?? {};
        return (
          <div key={s.key} className="bg-card rounded-xl border border-border shadow-sm">
            <button
              onClick={() => setOpenSection(isOpen ? null : s.key)}
              className="w-full p-5 flex items-start gap-4 text-left"
            >
              <div className="w-10 h-10 bg-brand-500/10 rounded-lg flex items-center justify-center flex-shrink-0">
                <s.icon className="w-5 h-5 text-brand-500" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">{s.title}</h3>
                <p className="text-sm text-muted-foreground mt-0.5">{s.description}</p>
              </div>
            </button>

            {isOpen && (
              <form
                onSubmit={(e) => { e.preventDefault(); updateMut.mutate({ key: s.key, value: values }); }}
                className="px-5 pb-5 space-y-4 border-t border-border pt-4"
              >
                {s.key === "general" && (
                  <>
                    <Field label="Platform Name">
                      <input disabled={!canEdit} className={inputCls} value={values.platform_name ?? ""} onChange={e => setField("general", "platform_name", e.target.value)} />
                    </Field>
                    <Field label="Support Email">
                      <input disabled={!canEdit} type="email" className={inputCls} value={values.support_email ?? ""} onChange={e => setField("general", "support_email", e.target.value)} />
                    </Field>
                    <Field label="Default Timezone">
                      <input disabled={!canEdit} className={inputCls} value={values.default_timezone ?? ""} onChange={e => setField("general", "default_timezone", e.target.value)} />
                    </Field>
                  </>
                )}

                {s.key === "notifications" && (
                  <>
                    <Field label="Seat-Limit Alert Threshold (%)">
                      <input disabled={!canEdit} type="number" min={1} max={100} className={inputCls} value={values.seat_limit_alert_threshold_pct ?? 80} onChange={e => setField("notifications", "seat_limit_alert_threshold_pct", Number(e.target.value))} />
                    </Field>
                    <Field label="Email Digest Frequency">
                      <select disabled={!canEdit} className={inputCls} value={values.email_digest ?? "daily"} onChange={e => setField("notifications", "email_digest", e.target.value)}>
                        <option value="off">Off</option>
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                      </select>
                    </Field>
                    <Field label="Webhook URL">
                      <input disabled={!canEdit} className={inputCls} placeholder="https://…" value={values.webhook_url ?? ""} onChange={e => setField("notifications", "webhook_url", e.target.value)} />
                    </Field>
                  </>
                )}

                {s.key === "security_policy" && (
                  <>
                    <Field label="Default Session Timeout (minutes)">
                      <input disabled={!canEdit} type="number" min={5} className={inputCls} value={values.default_session_timeout_minutes ?? 60} onChange={e => setField("security_policy", "default_session_timeout_minutes", Number(e.target.value))} />
                    </Field>
                    <Field label="Default Minimum Password Length">
                      <input disabled={!canEdit} type="number" min={8} className={inputCls} value={values.default_password_min_length ?? 8} onChange={e => setField("security_policy", "default_password_min_length", Number(e.target.value))} />
                    </Field>
                    <label className="flex items-center gap-2 text-sm text-foreground">
                      <input disabled={!canEdit} type="checkbox" checked={!!values.require_mfa_for_org_admins} onChange={e => setField("security_policy", "require_mfa_for_org_admins", e.target.checked)} />
                      Require MFA for org admins by default
                    </label>
                  </>
                )}

                {s.key === "data_retention" && (
                  <>
                    <Field label="Activity Log Retention (days)">
                      <input disabled={!canEdit} type="number" min={1} className={inputCls} value={values.activity_log_days ?? 180} onChange={e => setField("data_retention", "activity_log_days", Number(e.target.value))} />
                    </Field>
                    <Field label="Audit Log Retention (days)">
                      <input disabled={!canEdit} type="number" min={1} className={inputCls} value={values.audit_log_days ?? 365} onChange={e => setField("data_retention", "audit_log_days", Number(e.target.value))} />
                    </Field>
                    <p className="text-xs text-[#6B6B6B]">
                      Enforced by a daily background sweep — rows older than these windows are permanently deleted.
                    </p>
                  </>
                )}

                {canEdit && (
                  <div className="flex gap-3 pt-2">
                    <button type="button" onClick={() => setOpenSection(null)} className="flex-1 border border-border text-muted-foreground py-2 rounded-lg text-sm hover:bg-muted">
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={updateMut.isPending}
                      className="flex-1 bg-primary text-primary-foreground py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60"
                    >
                      {updateMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      Save
                    </button>
                  </div>
                )}
              </form>
            )}
          </div>
        );
      })}
    </div>
  );
}
