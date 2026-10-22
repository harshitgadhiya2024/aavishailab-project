import type { Metadata } from "next";
import { PricingPlans } from "@/components/pricing-plans";
import { plans } from "@/lib/pricing";
import { PlanHero } from "@/components/landing/hero-widgets";
import { Check, Minus } from "@phosphor-icons/react/dist/ssr";
import { CardGrid, FaqSection, FeatureSplit } from "@/components/blocks";
import { Button } from "@/components/button";
import { CtaBand } from "@/components/cta-band";
import { Reveal } from "@/components/motion/reveal";
import { PageHero } from "@/components/page-hero";
import { Section, SectionHead } from "@/components/section";
import { JsonLd, breadcrumbLd, faqLd } from "@/lib/seo";
import { shots } from "@/lib/shots";

export const metadata: Metadata = {
  title: "Endpoint Security Pricing, Per Device",
  description: "Aavishield pricing is per device, billed annually: Essentials or Business for up to 50 devices, Enterprise above 50. Pick your device count and get a quote.",
  alternates: { canonical: "/pricing" },
  openGraph: { url: "/pricing" },
};

type Cell = boolean | string;
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

const how = [
  { title: "Per enrolled device", body: "You pay for devices running the agent, not for every employee in your directory." },
  { title: "Billed annually", body: "One invoice a year, with GST where applicable." },
  { title: "Grow any time", body: "Devices added mid-term are billed pro-rata for the rest of the term." },
];

const faq = [
  { q: "How is Aavishield priced?", a: "Per enrolled device, billed annually. Essentials and Business cover up to 50 devices; more than 50 devices is Enterprise. The quote depends on your plan and device count. Book a demo and we will send one within a day." },
  { q: "Which operating systems are supported?", a: "macOS, Windows and Linux. The same agent binary and the same policy work on all three." },
  { q: "Will DLP block my employees' work?", a: "No. Data loss prevention is monitor-only. It records what sensitive data left and where it went, without ever blocking the upload." },
  { q: "Do we need to route traffic through an office or VPN?", a: "No. Enforcement happens on the device itself, so it works on any network with nothing to route." },
  { q: "Can we start with some controls and add others later?", a: "Yes. Every control runs in the same agent, so moving to a bigger plan is a policy change, not a reinstall." },
  { q: "Can we cancel?", a: "Yes. Cancellation stops renewal, and the service continues until the end of your paid term. See the refund and cancellation policy for details." },
];

function CellView({ v }: { v: Cell }) {
  if (v === true) return <span className="inline-grid size-6 place-items-center rounded-[4px] bg-brand text-on-brand"><Check size={12} weight="bold" /></span>;
  if (v === false) return <Minus size={14} className="inline text-muted" />;
  return <span className="text-sm text-fg">{v}</span>;
}

export default function PricingPage() {
  return (
    <>
      <JsonLd data={faqLd(faq)} />
      <JsonLd data={breadcrumbLd([{ name: "Home", path: "" }, { name: "Pricing", path: "/pricing" }])} />

      {/* 1. Hero */}
      <PageHero visual={<PlanHero />} eyebrow="Endpoint security pricing" accent={["rack."]} title="Pay per device. Nothing to rack." body="Tell us how many devices you have. Essentials and Business cover up to 50; Enterprise is for larger fleets. Every plan includes the agent for macOS, Windows and Linux." />

      {/* 2. Plans, sized by device count */}
      <section className="grid-band px-5 py-16 sm:px-8 md:px-12 md:py-24">
        <PricingPlans />
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
                {plans.map((p) => (
                  <th key={p.name} className={`px-4 py-4 text-center font-medium ${p.name === "Business" ? "text-brand-ink" : "text-fg"}`}>{p.name}</th>
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
                      <td key={i} className={`px-4 py-3.5 text-center ${i === 1 ? "bg-brand/[0.04]" : ""}`}><CellView v={v} /></td>
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
            <h2 className="text-3xl font-normal tracking-tight text-fg md:text-4xl">Not sure which plan? Start with a pilot.</h2>
            <p className="mt-4 max-w-[52ch] text-lg leading-relaxed text-muted">Enroll a handful of devices, see real events from your own team, and choose a plan based on what you actually find.</p>
          </div>
          <div className="flex flex-wrap gap-3 md:justify-end">
            <Button href="/contact" size="lg">Start a pilot</Button>
            <Button href="/refund-and-cancellation" size="lg" variant="ghost">Refund policy</Button>
          </div>
        </Reveal>
      </Section>

      {/* 8. FAQ */}
      <FaqSection title="Pricing questions" items={faq} />

      <CtaBand title="Get a quote for your fleet." />
    </>
  );
}
