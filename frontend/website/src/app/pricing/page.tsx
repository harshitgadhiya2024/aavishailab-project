import type { Metadata } from "next";
import { PricingPlans } from "@/components/pricing-plans";
import { headers } from "next/headers";
import { type Pricing, TAX_NOTE, bothPrices, cheapest, currencyForCountry, formatPrice, minDevices, monthlyPrice, offersLd } from "@/lib/pricing";
import { getPricing } from "@/lib/pricing-data";
import { PlanHero } from "@/components/landing/hero-widgets";
import { Check, Minus } from "@phosphor-icons/react/dist/ssr";
import { CardGrid, FaqSection, FeatureSplit } from "@/components/blocks";
import { Button } from "@/components/button";
import { CtaBand } from "@/components/cta-band";
import { Reveal } from "@/components/motion/reveal";
import { PageHero } from "@/components/page-hero";
import { Section, SectionHead } from "@/components/section";
import { JsonLd, SITE_URL, breadcrumbLd, faqLd } from "@/lib/seo";
import { shots } from "@/lib/shots";

// Prices come from the superadmin panel, so the description is built from them.
export async function generateMetadata(): Promise<Metadata> {
  const { plans, settings } = await getPricing();
  const list = plans.map((p) => `${p.name} ${p.from ? "from " : ""}${formatPrice(p.price.INR, "INR")} / ${formatPrice(p.price.USD, "USD")}`).join(", ");
  return {
    title: "Endpoint Security Pricing in INR and USD, Per Device",
    description: `Aavishield pricing per device per year: ${list}.${settings.pilotDays > 0 ? ` Free ${settings.pilotDays}-day pilot.` : ""}`,
    alternates: { canonical: "/pricing" },
    openGraph: { url: "/pricing" },
  };
}

type Cell = boolean | string;
// Comparison table columns, in order. Column names come from the live plans.
const TABLE_KEYS = ["starter", "professional", "enterprise"] as const;
const table: { group: string; rows: { label: string; v: [Cell, Cell, Cell] }[] }[] = [
  {
    group: "Protection",
    rows: [
      { label: "Web gateway and 27 categories", v: [true, true, true] },
      { label: "VPN and proxy blocking", v: [true, true, true] },
      { label: "Download malware scanning", v: [true, true, true] },
      { label: "Device posture checks", v: [true, true, true] },
      { label: "Data loss prevention", v: [false, true, true] },
      { label: "AI classification and OCR", v: [false, true, true] },
      { label: "Application control", v: [false, true, true] },
      { label: "Activity monitoring and screenshots", v: [false, false, true] },
    ],
  },
  {
    group: "Management",
    rows: [
      { label: "Admin console and employee portal", v: [true, true, true] },
      { label: "Reports with PDF, Excel and CSV export", v: [true, true, true] },
      { label: "Per-team and per-employee policies", v: [false, true, true] },
      { label: "Custom data retention", v: [false, false, true] },
    ],
  },
  {
    group: "Support",
    rows: [
      { label: "Email and in-console support", v: [true, true, true] },
      { label: "Dedicated onboarding", v: [false, false, true] },
      { label: "Priority support", v: [false, false, true] },
    ],
  },
];

const included = [
  { title: "Agent for every OS", body: "macOS, Windows and Linux installers with automatic updates." },
  { title: "Employee portal", body: "Self-enrollment, device list and access requests for every employee." },
  { title: "Two-factor sign-in", body: "Emailed codes or authenticator apps for every admin." },
  { title: "The assistant", body: "Ask questions about your live security data in plain language." },
];

/** Billing cards and pricing FAQs, written from the live prices and rules. */
function pricingCopy({ plans, settings: s }: Pricing) {
  const min = minDevices(plans);
  const featured = plans.find((p) => p.popular) ?? plans[0];
  const priced = plans.filter((p) => !p.from);
  const quoted = plans.filter((p) => p.from);
  const monthly = (p: Pricing["plans"][number]) =>
    `${p.name} is ${formatPrice(monthlyPrice(p.price.INR, "INR", s), "INR")} (${formatPrice(monthlyPrice(p.price.USD, "USD", s), "USD")})`;
  const open = plans.find((p) => !p.max);

  const how = [
    { title: "Per enrolled device", body: `You pay for devices running the agent, not for every employee in your directory. The minimum is ${min} devices.` },
    {
      title: "Annual or monthly",
      body: `One invoice a year, with GST in India, or pay monthly for about ${s.monthlyUpliftPercent}% more (${featured.name} is ${formatPrice(monthlyPrice(featured.price.INR, "INR", s), "INR")} or ${formatPrice(monthlyPrice(featured.price.USD, "USD", s), "USD")} per device per month).`,
    },
    { title: "Grow any time", body: `Devices added mid-term are billed pro-rata for the rest of the term.${s.volumeFrom > 0 ? ` Volume pricing applies above ${s.volumeFrom} devices.` : ""}` },
  ];

  const faq = [
    {
      q: "How much does Aavishield cost?",
      a: [
        `Per device per year, billed annually: ${priced.map((p) => `${p.name} is ${bothPrices(p.price)}`).join(" and ")}.`,
        ...quoted.map((p) => `${p.name}${p.min > min ? `, for ${p.min} or more devices,` : ""} starts at ${bothPrices(p.price)}.`),
        `Indian prices are plus ${s.gstPercent}% GST.`,
        `The minimum is ${min} devices, so ${featured.name} for ${min} devices costs ${formatPrice(featured.price.INR * min, "INR")} plus GST, or ${formatPrice(featured.price.USD * min, "USD")}, a year.`,
      ].join(" "),
    },
    ...(s.pilotDays > 0
      ? [{ q: "Is there a free trial?", a: `Yes. Every company can run a free ${s.pilotDays}-day pilot on up to ${s.pilotDevices} devices before buying. No card is needed.` }]
      : []),
    {
      q: "Do prices include GST?",
      a: `No. Indian prices are shown before GST. We add ${s.gstPercent}% GST and send a GST invoice, so registered businesses can claim input tax credit. Outside India we bill in US dollars.`,
    },
    { q: "Can we pay monthly?", a: `Yes. Monthly billing costs about ${s.monthlyUpliftPercent}% more than paying annually. Per device per month, ${priced.map(monthly).join(" and ")}.` },
    ...(s.volumeFrom > 0
      ? [{ q: "Do you offer volume discounts?", a: `Yes. Fleets of more than ${s.volumeFrom} devices get volume pricing${open ? ` on ${open.name}` : ""}. Tell us your device count and we will send a quote within a day.` }]
      : []),
  { q: "Which operating systems are supported?", a: "macOS, Windows and Linux. The same agent binary and the same policy work on all three." },
  { q: "Will DLP block my employees' work?", a: "No. Data loss prevention is monitor-only. It records what sensitive data left and where it went, without ever blocking the upload." },
  { q: "Do we need to route traffic through an office or VPN?", a: "No. Enforcement happens on the device itself, so it works on any network with nothing to route." },
  { q: "Can we start with some controls and add others later?", a: "Yes. Every control runs in the same agent, so moving to a bigger plan is a policy change, not a reinstall." },
  { q: "Can we cancel?", a: "Yes. Cancellation stops renewal, and the service continues until the end of your paid term. See the refund and cancellation policy for details." },
  ];
  return { how, faq };
}

function CellView({ v }: { v: Cell }) {
  // Icons carry an sr-only word so screen readers and AI parsers can read the table.
  if (v === true) return <span className="inline-grid size-6 place-items-center rounded-[4px] bg-brand text-on-brand"><Check size={12} weight="bold" aria-hidden /><span className="sr-only">Included</span></span>;
  if (v === false) return <span><Minus size={14} className="inline text-muted" aria-hidden /><span className="sr-only">Not included</span></span>;
  return <span className="text-sm text-fg">{v}</span>;
}

export default async function PricingPage() {
  // Cloudflare adds CF-IPCountry to every request: India sees rupees, everyone else dollars.
  const currency = currencyForCountry((await headers()).get("cf-ipcountry"));
  const pricing = await getPricing();
  const { plans, settings } = pricing;
  const { how, faq } = pricingCopy(pricing);
  const entry = cheapest(plans);
  const from = formatPrice(entry.price[currency], currency);
  const limited = plans.filter((p) => p.max);
  const open = plans.find((p) => !p.max);
  const featured = plans.find((p) => p.popular) ?? plans[0];
  return (
    <>
      <JsonLd data={faqLd(faq)} />
      {/* Same @id as the homepage node, so the offers attach to one product. */}
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          "@id": `${SITE_URL}/#software`,
          name: "Aavishield",
          applicationCategory: "SecurityApplication",
          operatingSystem: "macOS, Windows, Linux",
          offers: offersLd(SITE_URL, plans),
        }}
      />
      <JsonLd data={breadcrumbLd([{ name: "Home", path: "" }, { name: "Pricing", path: "/pricing" }])} />

      {/* 1. Hero */}
      <PageHero
        visual={<PlanHero currency={currency} price={featured.price} planNames={plans.map((p) => p.name)} featuredName={featured.name} minDevices={minDevices(plans)} />}
        eyebrow="Endpoint security pricing"
        accent={["rack."]}
        title="Pay per device. Nothing to rack."
        body={[
          `From ${from} per device per year ${TAX_NOTE[currency]}.`,
          limited.length && open ? `${limited.map((p) => p.name).join(" and ")} cover ${minDevices(plans)} to ${Math.max(...limited.map((p) => p.max ?? 0))} devices; ${open.name} is for larger fleets.` : "",
          `Every plan includes the agent for macOS, Windows and Linux${settings.pilotDays > 0 ? `, and starts with a free ${settings.pilotDays}-day pilot` : ""}.`,
        ]
          .filter(Boolean)
          .join(" ")}
      />

      {/* 2. Plans, sized by device count */}
      <section className="grid-band px-5 py-16 sm:px-8 md:px-12 md:py-24">
        <PricingPlans pricing={pricing} currency={currency} />
      </section>

      {/* 3. Included */}
      <Section>
        <SectionHead eyebrow="In every plan" title="Included, whatever you choose." accent={["Included,"]} />
        <div className="mt-12"><CardGrid items={included} cols={4} /></div>
      </Section>

      {/* 4. Comparison */}
      <Section id="compare">
        <SectionHead eyebrow="Compare plans" title="Everything, side by side." />
        <Reveal className="mt-12 overflow-x-auto rounded-[6px] border border-line bg-surface">
          <table className="w-full min-w-[640px] text-left">
            <thead>
              <tr className="border-b border-line bg-bg-2 text-sm">
                <th className="px-5 py-4 font-medium text-fg">Feature</th>
                {TABLE_KEYS.map((key) => plans.find((x) => x.key === key)).map((p, i) => (
                  <th key={TABLE_KEYS[i]} className={`px-4 py-4 text-center font-medium ${p?.popular ? "text-brand-ink" : "text-fg"}`}>{p?.name ?? TABLE_KEYS[i]}</th>
                ))}
              </tr>
            </thead>
            {table.map((g) => (
              <tbody key={g.group}>
                <tr className="border-b border-line">
                  <td colSpan={4} className="px-5 pb-2 pt-6 text-[12px] font-medium uppercase tracking-[0.14em] text-brand-ink">{g.group}</td>
                </tr>
                {g.rows.map((r) => (
                  <tr key={r.label} className="border-b border-line text-[15px] last:border-0">
                    <td className="px-5 py-3.5 text-fg-2">{r.label}</td>
                    {r.v.map((v, i) => (
                      <td key={i} className={`px-4 py-3.5 text-center ${plans.find((x) => x.key === TABLE_KEYS[i])?.popular ? "bg-brand/[0.04]" : ""}`}><CellView v={v} /></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </Reveal>
      </Section>

      {/* 5. How pricing works */}
      <Section>
        <SectionHead eyebrow="How billing works" title="Simple, predictable, per device." />
        <div className="mt-12"><CardGrid items={how} /></div>
      </Section>

      {/* 6. What you get */}
      <Section>
        <FeatureSplit eyebrow="What you get" title="A console your team will actually use" body="Every plan includes the security overview, activity feed and reports. Higher plans unlock more controls in the same console, with nothing new to install." points={["Same agent on every plan", "Upgrade with a policy change", "Reports on every plan"]} shot={shots.overview}>
          <Button href="/product-tour" variant="ghost">Take the product tour</Button>
        </FeatureSplit>
      </Section>

      {/* 7. Pilot */}
      <Section>
        <Reveal className="grid gap-8 rounded-[6px] border border-line bg-surface p-8 md:grid-cols-[1.4fr_1fr] md:items-center md:p-12">
          <div>
            <h2 className="text-3xl font-normal tracking-tight text-fg md:text-4xl">{settings.pilotDays > 0 ? `Try it free for ${settings.pilotDays} days.` : "Not sure which plan? Start with a pilot."}</h2>
            <p className="mt-4 max-w-[52ch] text-lg leading-relaxed text-muted">Enroll {settings.pilotDevices > 0 ? `up to ${settings.pilotDevices}` : "a handful of"} devices, see real events from your own team, and choose a plan based on what you actually find. No card needed.</p>
          </div>
          <div className="flex flex-wrap gap-3 md:justify-end">
            <Button href="/contact" size="lg">Start a free pilot</Button>
            <Button href="/refund-and-cancellation" size="lg" variant="ghost">Refund policy</Button>
          </div>
        </Reveal>
      </Section>

      {/* 8. FAQ */}
      <FaqSection title="Pricing questions" items={faq} />

      <CtaBand title="Start your free pilot." />
    </>
  );
}
