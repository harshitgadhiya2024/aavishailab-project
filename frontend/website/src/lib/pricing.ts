/*
 * Pricing plans and the rules around them. The live values are edited in the
 * superadmin panel (Revenue → Pricing Plans) and read with getPricing() in
 * lib/pricing-data.ts; DEFAULT_PRICING is what the site shows when admin-api
 * can't be reached. This file has no server imports, so client components can
 * use the types and helpers.
 *
 * Prices are per device per year, billed annually, before tax: rupees for
 * visitors in India (plus GST) and US dollars everywhere else.
 */

export type Currency = "INR" | "USD";
export const CURRENCIES: Currency[] = ["INR", "USD"];

export type Plan = {
  /** Organization plan type in admin-api: starter, professional or enterprise. */
  key: string;
  name: string;
  for: string;
  features: string[];
  price: Record<Currency, number>;
  min: number;
  /** Upper device limit; null means no limit. */
  max: number | null;
  popular: boolean;
  /** Shown as "From …": the final price is quoted. */
  from: boolean;
};

export type PricingSettings = {
  gstPercent: number;
  monthlyUpliftPercent: number;
  pilotDays: number;
  pilotDevices: number;
  volumeFrom: number;
};

export type Pricing = { plans: Plan[]; settings: PricingSettings };

export const DEFAULT_PRICING: Pricing = {
  plans: [
    {
      key: "starter",
      name: "Essentials",
      for: "For small teams getting their first policy in place.",
      features: ["Web Gateway", "VPN Control", "Malware Scanning", "Device Posture", "Admin console"],
      price: { INR: 1799, USD: 39 },
      min: 10,
      max: 50,
      popular: false,
      from: false,
    },
    {
      key: "professional",
      name: "Business",
      for: "For companies that handle customer or financial data.",
      features: ["Everything in Essentials", "Data Loss Prevention", "Application Control", "AI classification of files", "Per-group policies"],
      price: { INR: 3599, USD: 79 },
      min: 10,
      max: 50,
      popular: true,
      from: false,
    },
    {
      key: "enterprise",
      name: "Enterprise",
      for: "For fleets of more than 50 devices, with audit and monitoring needs.",
      features: ["Everything in Business", "Activity Monitoring", "Custom data retention", "Dedicated onboarding", "Priority support"],
      price: { INR: 5499, USD: 119 },
      min: 51,
      max: null,
      popular: false,
      from: true,
    },
  ],
  settings: { gstPercent: 18, monthlyUpliftPercent: 20, pilotDays: 14, pilotDevices: 10, volumeFrom: 100 },
};

/** INR for visitors in India, USD for everyone else. `country` is an ISO 3166 code such as Cloudflare's CF-IPCountry. */
export const currencyForCountry = (country: string | null | undefined): Currency => (country?.toUpperCase() === "IN" ? "INR" : "USD");

export const formatPrice = (n: number, c: Currency) =>
  c === "INR"
    ? `₹${Math.round(n).toLocaleString("en-IN")}`
    : `$${n.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;

/** How tax is described next to a price. */
export const TAX_NOTE: Record<Currency, string> = { INR: "+ GST", USD: "+ applicable taxes" };

/** Per-month price when billed monthly instead of annually. Whole rupees; cents for dollars. */
export const monthlyPrice = (annual: number, c: Currency, s: PricingSettings) => {
  const m = (annual / 12) * (1 + s.monthlyUpliftPercent / 100);
  return c === "INR" ? Math.round(m) : Math.round(m * 100) / 100;
};

/** "₹1,799 in India ($39 elsewhere)" for text that crawlers and AI tools read. */
export const bothPrices = (p: Record<Currency, number>) => `${formatPrice(p.INR, "INR")} in India (${formatPrice(p.USD, "USD")} elsewhere)`;

/** Device-range label such as "10 to 50 devices" or "51+ devices". */
export const rangeLabel = (p: Plan) => (p.max ? `${p.min} to ${p.max} devices` : `${p.min}+ devices`);

/** Smallest device count any plan is sold for. */
export const minDevices = (plans: Plan[]) => Math.min(...plans.map((p) => p.min));

/** The cheapest plan, for "from ₹…" lines. */
export const cheapest = (plans: Plan[]) => plans.reduce((a, b) => (b.price.INR < a.price.INR ? b : a), plans[0]);

/** schema.org Offers for the SoftwareApplication node, one per plan per currency. Prices exclude tax. */
export const offersLd = (siteUrl: string, plans: Plan[]) =>
  plans.flatMap((p) =>
    CURRENCIES.map((c) => ({
      "@type": "Offer",
      name: `Aavishield ${p.name}`,
      url: `${siteUrl}/pricing`,
      price: p.price[c],
      priceCurrency: c,
      ...(c === "INR" ? { eligibleRegion: { "@type": "Country", name: "IN" } } : { ineligibleRegion: { "@type": "Country", name: "IN" } }),
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: p.price[c],
        priceCurrency: c,
        unitText: "device per year",
        referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitText: "device", unitCode: "C62" },
        billingDuration: { "@type": "QuantitativeValue", value: 1, unitCode: "ANN" },
        valueAddedTaxIncluded: false,
        ...(p.from ? { minPrice: p.price[c] } : {}),
      },
      eligibleQuantity: { "@type": "QuantitativeValue", minValue: p.min, ...(p.max ? { maxValue: p.max } : {}), unitText: "devices" },
    })),
  );
