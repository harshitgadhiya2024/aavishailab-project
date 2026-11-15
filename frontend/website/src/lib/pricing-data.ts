import { api } from "@/lib/cms";
import { DEFAULT_PRICING, type Plan, type Pricing } from "@/lib/pricing";

/*
 * Live pricing from admin-api's /public/pricing, edited in the superadmin
 * panel. The pricing page renders per request (it picks the currency from
 * the visitor's country), so the result is kept in memory for a minute
 * rather than asking admin-api on every page view. Any failure falls back to
 * the last good copy, then to DEFAULT_PRICING, so the page never breaks.
 */

type ApiPlan = {
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
};

type ApiSettings = {
  gst_percent: number;
  monthly_uplift_percent: number;
  pilot_days: number;
  pilot_devices: number;
  volume_from: number;
};

const TTL_MS = 60_000;
let cache: { at: number; value: Pricing } | null = null;

const toPlan = (p: ApiPlan): Plan => ({
  key: p.key,
  name: p.name,
  for: p.tagline,
  features: p.features ?? [],
  price: { INR: p.price_inr, USD: p.price_usd_cents / 100 },
  min: Math.max(1, p.min_devices),
  max: p.max_devices > 0 ? p.max_devices : null,
  popular: p.popular,
  from: p.starts_at,
});

export async function getPricing(): Promise<Pricing> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  if (!process.env.ADMIN_API_INTERNAL_URL) return DEFAULT_PRICING;

  const data = await api<{ plans: ApiPlan[]; settings: ApiSettings }>("/public/pricing");
  if (!data?.plans?.length || !data.settings) return cache?.value ?? DEFAULT_PRICING;

  const s = data.settings;
  const value: Pricing = {
    plans: data.plans.map(toPlan),
    settings: {
      gstPercent: s.gst_percent,
      monthlyUpliftPercent: s.monthly_uplift_percent,
      pilotDays: s.pilot_days,
      pilotDevices: s.pilot_devices,
      volumeFrom: s.volume_from,
    },
  };
  cache = { at: Date.now(), value };
  return value;
}
