"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLink, Save, Star } from "lucide-react";
import { pricingApi } from "@/lib/api";
import { cn } from "@/lib/utils";

/*
 * Pricing plans shown on the website's /pricing page. Each plan is tied to an
 * organization plan type (starter, professional, enterprise), so what a
 * visitor sees is what billing charges. Changes reach the website within
 * about a minute, with no redeploy.
 */

type Plan = {
  id: string;
  key: string;
  name: string;
  tagline: string;
  features: string[] | null;
  price_inr: number;
  price_usd_cents: number;
  min_devices: number;
  max_devices: number;
  popular: boolean;
  starts_at: boolean;
  sort_order: number;
  updated_at: string;
};

type Settings = {
  gst_percent: number;
  monthly_uplift_percent: number;
  pilot_days: number;
  pilot_devices: number;
  volume_from: number;
};

const WEBSITE_URL = process.env.NEXT_PUBLIC_WEBSITE_URL || "https://aavishield.com";

const KEY_LABEL: Record<string, string> = {
  starter: "Billing plan: starter",
  professional: "Billing plan: professional",
  enterprise: "Billing plan: enterprise",
};

const input =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500";
const label = "mb-1.5 block text-xs font-medium text-muted-foreground";

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const usd = (n: number) => "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: Number.isInteger(n) ? 0 : 2 });

/** Form state keeps prices as typed text, so a half-typed "39." is not lost. */
type PlanForm = {
  name: string;
  tagline: string;
  features: string;
  price_inr: string;
  price_usd: string;
  min_devices: string;
  max_devices: string;
  popular: boolean;
  starts_at: boolean;
  sort_order: string;
};

const toForm = (p: Plan): PlanForm => ({
  name: p.name,
  tagline: p.tagline,
  features: (p.features ?? []).join("\n"),
  price_inr: String(p.price_inr),
  price_usd: String(p.price_usd_cents / 100),
  min_devices: String(p.min_devices),
  max_devices: String(p.max_devices),
  popular: p.popular,
  starts_at: p.starts_at,
  sort_order: String(p.sort_order),
});

function PlanEditor({ plan, settings }: { plan: Plan; settings: Settings }) {
  const qc = useQueryClient();
  const [f, setF] = useState<PlanForm>(() => toForm(plan));
  useEffect(() => setF(toForm(plan)), [plan]);
  const set = <K extends keyof PlanForm>(k: K, v: PlanForm[K]) => setF((s) => ({ ...s, [k]: v }));

  const priceInr = Number(f.price_inr) || 0;
  const priceUsd = Number(f.price_usd) || 0;
  const uplift = 1 + settings.monthly_uplift_percent / 100;
  const dirty = JSON.stringify(f) !== JSON.stringify(toForm(plan));

  const save = useMutation({
    mutationFn: () =>
      pricingApi.updatePlan(plan.key, {
        name: f.name.trim(),
        tagline: f.tagline.trim(),
        features: f.features.split("\n").map((s) => s.trim()).filter(Boolean),
        price_inr: Math.round(priceInr),
        price_usd_cents: Math.round(priceUsd * 100),
        min_devices: Math.round(Number(f.min_devices) || 0),
        max_devices: Math.round(Number(f.max_devices) || 0),
        popular: f.popular,
        starts_at: f.starts_at,
        sort_order: Math.round(Number(f.sort_order) || 0),
      }),
    onSuccess: () => {
      toast.success(`${f.name} saved. The website updates within a minute.`);
      qc.invalidateQueries({ queryKey: ["pricing"] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Failed to save plan"),
  });

  return (
    <div className={cn("flex flex-col rounded-xl border bg-card p-5 shadow-sm", f.popular ? "border-brand-500/50" : "border-border")}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">{KEY_LABEL[plan.key] ?? plan.key}</p>
          <h3 className="mt-1 text-lg font-semibold text-foreground">{f.name || "Untitled plan"}</h3>
        </div>
        {f.popular && (
          <span className="inline-flex items-center gap-1 rounded-[4px] bg-brand-500/10 px-2 py-0.5 text-xs font-medium text-brand-500">
            <Star className="h-3 w-3" /> Most popular
          </span>
        )}
      </div>

      <div className="mt-5 space-y-4">
        <div>
          <label className={label}>Plan name</label>
          <input className={input} value={f.name} maxLength={60} onChange={(e) => set("name", e.target.value)} />
        </div>
        <div>
          <label className={label}>Who it is for</label>
          <input className={input} value={f.tagline} maxLength={200} onChange={(e) => set("tagline", e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>India price (₹ / device / year)</label>
            <input className={input} inputMode="numeric" value={f.price_inr} onChange={(e) => set("price_inr", e.target.value.replace(/[^\d]/g, ""))} />
          </div>
          <div>
            <label className={label}>Other countries ($ / device / year)</label>
            <input className={input} inputMode="decimal" value={f.price_usd} onChange={(e) => set("price_usd", e.target.value.replace(/[^\d.]/g, ""))} />
          </div>
        </div>
        <p className="-mt-1 text-xs text-muted-foreground">
          Monthly billing: {inr((priceInr / 12) * uplift)} / {usd(Math.round((priceUsd / 12) * uplift * 100) / 100)} per device per month. With {settings.gst_percent}% GST: {inr(priceInr * (1 + settings.gst_percent / 100))} per device per year.
        </p>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={label}>Min devices</label>
            <input className={input} inputMode="numeric" value={f.min_devices} onChange={(e) => set("min_devices", e.target.value.replace(/[^\d]/g, ""))} />
          </div>
          <div>
            <label className={label}>Max devices</label>
            <input className={input} inputMode="numeric" value={f.max_devices} onChange={(e) => set("max_devices", e.target.value.replace(/[^\d]/g, ""))} />
          </div>
          <div>
            <label className={label}>Order</label>
            <input className={input} inputMode="numeric" value={f.sort_order} onChange={(e) => set("sort_order", e.target.value.replace(/[^\d-]/g, ""))} />
          </div>
        </div>
        <p className="-mt-1 text-xs text-muted-foreground">Max devices 0 means no upper limit.</p>

        <div>
          <label className={label}>Features (one per line)</label>
          <textarea className={cn(input, "min-h-[130px] font-mono text-[13px]")} value={f.features} onChange={(e) => set("features", e.target.value)} />
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={f.popular} onChange={(e) => set("popular", e.target.checked)} className="accent-[#FF7000]" />
            Show &ldquo;Most popular&rdquo; tag <span className="text-xs text-muted-foreground">(only one plan can have it)</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={f.starts_at} onChange={(e) => set("starts_at", e.target.checked)} className="accent-[#FF7000]" />
            Show as &ldquo;From&rdquo; price <span className="text-xs text-muted-foreground">(final price is quoted)</span>
          </label>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between gap-3 border-t border-border pt-4">
        <span className="text-xs text-muted-foreground">{dirty ? "Unsaved changes" : `Saved ${new Date(plan.updated_at).toLocaleString()}`}</span>
        <div className="flex gap-2">
          {dirty && (
            <button onClick={() => setF(toForm(plan))} className="rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-muted">
              Reset
            </button>
          )}
          <button
            onClick={() => save.mutate()}
            disabled={!dirty || save.isPending || !f.name.trim() || priceInr <= 0 || priceUsd <= 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            <Save className="h-4 w-4" /> {save.isPending ? "Saving…" : "Save plan"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingsEditor({ settings }: { settings: Settings }) {
  const qc = useQueryClient();
  const toStrings = (s: Settings) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, String(v)])) as Record<keyof Settings, string>;
  const [f, setF] = useState(() => toStrings(settings));
  useEffect(() => setF(toStrings(settings)), [settings]);
  const dirty = JSON.stringify(f) !== JSON.stringify(toStrings(settings));

  const save = useMutation({
    mutationFn: () =>
      pricingApi.updateSettings({
        gst_percent: Number(f.gst_percent) || 0,
        monthly_uplift_percent: Number(f.monthly_uplift_percent) || 0,
        pilot_days: Math.round(Number(f.pilot_days) || 0),
        pilot_devices: Math.round(Number(f.pilot_devices) || 0),
        volume_from: Math.round(Number(f.volume_from) || 0),
      }),
    onSuccess: () => {
      toast.success("Pricing settings saved. The website updates within a minute.");
      qc.invalidateQueries({ queryKey: ["pricing"] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Failed to save settings"),
  });

  const fields: { k: keyof Settings; label: string; hint: string }[] = [
    { k: "gst_percent", label: "GST (%)", hint: "Added to Indian prices" },
    { k: "monthly_uplift_percent", label: "Monthly billing surcharge (%)", hint: "Extra over annual" },
    { k: "pilot_days", label: "Free pilot length (days)", hint: "0 hides the pilot offer" },
    { k: "pilot_devices", label: "Free pilot devices", hint: "Devices allowed in the pilot" },
    { k: "volume_from", label: "Volume pricing above (devices)", hint: "Shown in the FAQ" },
  ];

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-foreground">Pricing rules</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">Apply to every plan on the pricing page.</p>
        </div>
        <button
          onClick={() => save.mutate()}
          disabled={!dirty || save.isPending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
        >
          <Save className="h-4 w-4" /> {save.isPending ? "Saving…" : "Save rules"}
        </button>
      </div>
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {fields.map(({ k, label: l, hint }) => (
          <div key={k}>
            <label className={label}>{l}</label>
            <input className={input} inputMode="decimal" value={f[k]} onChange={(e) => setF((s) => ({ ...s, [k]: e.target.value.replace(/[^\d.]/g, "") }))} />
            <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PricingPage() {
  const { data, isLoading, isError } = useQuery({ queryKey: ["pricing"], queryFn: pricingApi.get });
  const plans: Plan[] = data?.data?.plans ?? [];
  const settings: Settings | undefined = data?.data?.settings;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="page-eyebrow">Revenue</p>
          <h2 className="mt-2 text-[2rem] font-normal leading-[1.1] tracking-[-0.035em] text-foreground">Pricing Plans</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Prices on the website&apos;s pricing page. Visitors in India see rupees plus GST; everyone else sees US dollars. Changes go live within a minute.
          </p>
        </div>
        <a
          href={`${WEBSITE_URL}/pricing`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-muted"
        >
          View pricing page <ExternalLink className="h-4 w-4" />
        </a>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[640px] animate-pulse rounded-xl border border-border bg-card" />
          ))}
        </div>
      ) : isError || !settings ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">Could not load pricing plans.</div>
      ) : (
        <>
          <SettingsEditor settings={settings} />
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            {plans.map((p) => (
              <PlanEditor key={p.id} plan={p} settings={settings} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
