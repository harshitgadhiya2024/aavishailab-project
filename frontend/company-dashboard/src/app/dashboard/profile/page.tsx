"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { companyApi } from "@/lib/api";
import {
  Building2, Loader2, Save, Users, Monitor, UsersRound, FileText, UserCog,
  Globe, MapPin, Phone, Mail, Clock, Hash, Lock,
} from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import { usePermissions, PERMISSIONS } from "@/lib/permissions";
import { toast } from "sonner";

const INDUSTRIES = [
  "Technology / Software", "Financial Services", "Healthcare", "Manufacturing",
  "Retail / E-commerce", "Education", "Government / Public sector", "Legal",
  "Professional services", "Media", "Logistics", "Energy", "Non-profit", "Other",
];

const COMPANY_SIZES = ["1–10", "11–50", "51–200", "201–500", "501–1000", "1001–5000", "5000+"];

type Field = {
  key: string;
  label: string;
  placeholder?: string;
  type?: "text" | "email" | "select" | "textarea";
  options?: string[];
  hint?: string;
  wide?: boolean;
};

const SECTIONS: { title: string; description: string; icon: React.ElementType; fields: Field[] }[] = [
  {
    title: "Identity",
    description: "How this organization is named across the dashboard, reports and email",
    icon: Building2,
    fields: [
      { key: "name", label: "Company name", placeholder: "Acme Corporation" },
      { key: "legal_name", label: "Registered legal name", placeholder: "Acme Corporation Pvt. Ltd.", hint: "Used on exports and compliance reports" },
      { key: "industry", label: "Industry", type: "select", options: INDUSTRIES },
      { key: "company_size", label: "Employees", type: "select", options: COMPANY_SIZES },
      { key: "logo_url", label: "Logo URL", placeholder: "https://…/logo.png" },
    ],
  },
  {
    title: "Registration & tax",
    description: "The numbers your company is asked for on invoices, contracts and compliance exports",
    icon: Hash,
    fields: [
      { key: "gst_number", label: "GST number (GSTIN)", placeholder: "24AABCA1234A1Z5", hint: "15 characters, as issued" },
      { key: "pan_number", label: "PAN", placeholder: "AABCA1234A" },
      { key: "registration_number", label: "Company registration number (CIN)", placeholder: "U72200GJ2020PTC123456" },
      { key: "tax_id", label: "Other tax ID", placeholder: "VAT / EIN / TIN", hint: "For companies registered outside India" },
      { key: "billing_email", label: "Billing email", type: "email", placeholder: "accounts@company.com" },
    ],
  },
  {
    title: "Contact",
    description: "Who to reach about security matters at this company",
    icon: Mail,
    fields: [
      { key: "contact_name", label: "Primary security contact", placeholder: "Full name" },
      { key: "contact_email", label: "Contact email", type: "email", placeholder: "security@company.com" },
      { key: "phone", label: "Phone", placeholder: "+91 98765 43210" },
      { key: "website", label: "Website", placeholder: "https://company.com" },
      { key: "domain", label: "Primary email domain", placeholder: "company.com", hint: "Used to tell company accounts from personal ones" },
    ],
  },
  {
    title: "Address",
    description: "Registered address, as it should appear on reports",
    icon: MapPin,
    fields: [
      { key: "address_line1", label: "Address line 1", wide: true },
      { key: "address_line2", label: "Address line 2", wide: true },
      { key: "city", label: "City" },
      { key: "state", label: "State / province" },
      { key: "postal_code", label: "Postal code" },
      { key: "country", label: "Country" },
    ],
  },
];

export default function CompanyProfilePage() {
  const qc = useQueryClient();
  const { can } = usePermissions();
  const canWrite = can(PERMISSIONS.settingsWrite);

  const [form, setForm] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["company-profile"],
    queryFn: () => companyApi.get(),
  });

  const { data: tzData } = useQuery({
    queryKey: ["company-timezones"],
    queryFn: () => companyApi.timezones(),
  });
  const timezones: string[] = tzData?.data?.timezones ?? [];

  const org = data?.data?.organization ?? {};
  const usage = data?.data?.usage ?? {};

  // Seed the form from the server once, then leave the user's edits alone —
  // "once" has to mean once per actual edit session, not once per fetch:
  // react-query refetches this in the background (window refocus, staleTime
  // expiry) independent of anything the user is doing, and re-seeding on
  // every one of those would silently overwrite in-progress typing with
  // whatever was last saved. dirtyRef (kept in sync below) lets this effect
  // read the current dirty flag without depending on it directly — depending
  // on `dirty` here would re-run this effect on every keystroke.
  const dirtyRef = useRef(false);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);

  useEffect(() => {
    if (!data?.data?.organization) return;
    if (dirtyRef.current) return;
    const o = data.data.organization;
    setForm({
      name: o.name ?? "", legal_name: o.legal_name ?? "", domain: o.domain ?? "",
      gst_number: o.gst_number ?? "", pan_number: o.pan_number ?? "",
      registration_number: o.registration_number ?? "", billing_email: o.billing_email ?? "",
      logo_url: o.logo_url ?? "", industry: o.industry ?? "", company_size: o.company_size ?? "",
      website: o.website ?? "", phone: o.phone ?? "", contact_email: o.contact_email ?? "",
      contact_name: o.contact_name ?? "", address_line1: o.address_line1 ?? "",
      address_line2: o.address_line2 ?? "", city: o.city ?? "", state: o.state ?? "",
      postal_code: o.postal_code ?? "", country: o.country ?? "", timezone: o.timezone ?? "UTC",
      tax_id: o.tax_id ?? "", notes: o.notes ?? "",
    });
    setDirty(false);
  }, [data]);

  const saveMut = useMutation({
    mutationFn: (payload: Record<string, string>) => companyApi.update(payload),
    onSuccess: () => {
      toast.success("Company profile saved");
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["company-profile"] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Could not save"),
  });

  const set = (key: string, value: string) => {
    setForm(f => ({ ...f, [key]: value }));
    setDirty(true);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMut.mutate(form);
  };

  const inputClass =
    "w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60";

  const completeness = (() => {
    const keys = SECTIONS.flatMap(s => s.fields.map(f => f.key));
    const filled = keys.filter(k => (form[k] ?? "").trim() !== "").length;
    return Math.round((filled / keys.length) * 100);
  })();

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Company Profile</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Your organization's details, registration numbers and contacts — used across reports,
            exports and email
          </p>
        </div>
        {!canWrite && (
          <span className="flex items-center gap-1.5 text-xs text-subtle">
            <Lock className="w-3.5 h-3.5" /> View only
          </span>
        )}
      </div>

      {/* Plan and usage — read-only facts an admin looks for on this page */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {[
          { label: "Employees", value: usage.employees ?? 0, icon: Users },
          { label: "Devices", value: usage.devices ?? 0, icon: Monitor },
          { label: "Teams", value: usage.teams ?? 0, icon: UsersRound },
          { label: "Policies", value: usage.policies ?? 0, icon: FileText },
          { label: "Dashboard users", value: `${usage.dashboard_users ?? 0}${usage.max_users ? ` / ${usage.max_users}` : ""}`, icon: UserCog },
        ].map(s => (
          <div key={s.label} className="bg-card rounded-xl border border-border p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <s.icon className="w-3.5 h-3.5" />
              <span className="text-xs">{s.label}</span>
            </div>
            <p className="text-xl font-bold text-foreground tabular-nums">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-card rounded-xl border border-border p-4 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap text-sm">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Hash className="w-3.5 h-3.5" /> Workspace
            <code className="text-foreground font-mono text-xs">{org.slug ?? "—"}</code>
          </span>
          <span className="text-subtle">·</span>
          <span className="text-muted-foreground">
            Plan <span className="text-foreground font-medium capitalize">{org.plan ?? "—"}</span>
          </span>
          <span className="text-subtle">·</span>
          <span className="text-muted-foreground">
            Status <span className="text-foreground font-medium capitalize">{org.status ?? "—"}</span>
          </span>
          {org.trial_ends_at && (
            <>
              <span className="text-subtle">·</span>
              <span className="text-muted-foreground">Trial ends {formatDate(org.trial_ends_at)}</span>
            </>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          Profile {completeness}% complete
        </span>
      </div>

      <form onSubmit={submit} className="space-y-4">
        {SECTIONS.map(section => (
          <div key={section.title} className="bg-card rounded-xl border border-border shadow-sm p-5">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-9 h-9 rounded-lg bg-brand-500/10 text-brand-500 flex items-center justify-center flex-shrink-0">
                <section.icon className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground text-sm">{section.title}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">{section.description}</p>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              {section.fields.map(field => (
                <div key={field.key} className={cn(field.wide && "md:col-span-2")}>
                  <label className="block text-xs font-medium text-body mb-1">{field.label}</label>
                  {field.type === "select" ? (
                    <select
                      value={form[field.key] ?? ""}
                      onChange={e => set(field.key, e.target.value)}
                      disabled={!canWrite || isLoading}
                      className={inputClass}
                    >
                      <option value="">Not set</option>
                      {(field.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input
                      type={field.type === "email" ? "email" : "text"}
                      value={form[field.key] ?? ""}
                      onChange={e => set(field.key, e.target.value)}
                      placeholder={field.placeholder}
                      disabled={!canWrite || isLoading}
                      className={inputClass}
                    />
                  )}
                  {field.hint && <p className="text-[11px] text-subtle mt-1">{field.hint}</p>}
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Locale + notes */}
        <div className="bg-card rounded-xl border border-border shadow-sm p-5">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-9 h-9 rounded-lg bg-brand-500/10 text-brand-500 flex items-center justify-center flex-shrink-0">
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground text-sm">Locale &amp; notes</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Timezone decides how report periods and scheduled emails are dated
              </p>
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-body mb-1">Timezone</label>
              <select
                value={form.timezone ?? "UTC"}
                onChange={e => set("timezone", e.target.value)}
                disabled={!canWrite || isLoading}
                className={inputClass}
              >
                {timezones.map(tz => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-body mb-1">Internal notes</label>
              <textarea
                rows={3}
                value={form.notes ?? ""}
                onChange={e => set("notes", e.target.value)}
                placeholder="Anything your team should know about this organization"
                disabled={!canWrite || isLoading}
                className={cn(inputClass, "resize-y")}
              />
            </div>
          </div>
        </div>

        {canWrite && (
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={!dirty || saveMut.isPending}
              className="flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-on-brand px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {saveMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save changes
            </button>
            {dirty && <span className="text-xs text-warning">Unsaved changes</span>}
          </div>
        )}
      </form>
    </div>
  );
}
