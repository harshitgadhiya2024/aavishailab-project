import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "@phosphor-icons/react/dist/ssr";
import { Faq } from "@/components/faq";
import { Reveal, Stagger, StaggerItem, WordRise } from "@/components/motion/reveal";
import { PageHero } from "@/components/page-hero";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Per-device pricing for DelSecure. Start with the controls you need and add more later.",
};

const plans = [
  {
    name: "Essentials",
    for: "For small teams getting their first policy in place.",
    features: ["Web Gateway", "VPN Control", "Malware Scanning", "Device Posture", "Admin console"],
  },
  {
    name: "Business",
    for: "For companies that handle customer or financial data.",
    features: ["Everything in Essentials", "Data Loss Prevention", "Application Control", "AI classification of files", "Per-group policies"],
    featured: true,
  },
  {
    name: "Enterprise",
    for: "For large fleets with audit and monitoring needs.",
    features: ["Everything in Business", "Activity Monitoring", "Custom data retention", "Dedicated onboarding", "Priority support"],
  },
];

const faq = [
  { q: "How is DelSecure priced?", a: "Per enrolled device, billed annually. The quote depends on your plan and the number of devices. Book a demo and we will send one within a day." },
  { q: "Which operating systems are supported?", a: "macOS, Windows and Linux. The same agent binary and the same policy work on all three." },
  { q: "Will DLP block my employees' work?", a: "No. Data loss prevention is monitor-only. It records what sensitive data left and where it went, without ever blocking the upload." },
  { q: "Do we need to route traffic through an office or VPN?", a: "No. Enforcement happens on the device itself, so it works on any network with nothing to route." },
  { q: "Can we start with some controls and add others later?", a: "Yes. Every control runs in the same agent, so moving to a bigger plan is a policy change, not a reinstall." },
];

export default function PricingPage() {
  return (
    <>
      <PageHero
        eyebrow="Pricing"
        title="Pay per device. Nothing to rack."
        body="Every plan includes the agent for macOS, Windows and Linux, the admin console, and employee self-enrollment."
        aside={false}
      />

      <section className="mx-auto max-w-6xl px-4 md:px-6">
        <Stagger className="grid gap-4 lg:grid-cols-3" gap={0.1}>
          {plans.map((p) => (
            <StaggerItem key={p.name} className="h-full">
              <div
                className={`flex h-full flex-col rounded-[20px] p-8 transition-transform duration-500 ease-out-expo hover:-translate-y-1.5 ${
                  p.featured ? "ink-edge bg-ink text-ink-fg shadow-[0_40px_80px_-30px_rgb(0_0_0/0.45)] lg:-my-4 lg:py-12" : "border border-line bg-surface text-fg"
                }`}
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-semibold tracking-tight">{p.name}</h2>
                  {p.featured && <span className="rounded-full border border-ink-fg/25 px-3 py-1 text-[12px]">Most chosen</span>}
                </div>
                <p className={`mt-3 leading-relaxed ${p.featured ? "opacity-70" : "text-muted"}`}>{p.for}</p>
                <p className="mt-8 text-4xl font-semibold tracking-tight">Custom</p>
                <p className={`mt-1 text-sm ${p.featured ? "opacity-60" : "text-muted"}`}>per device, billed annually</p>
                <ul className="mb-10 mt-8 grid gap-3">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-center gap-3 text-[15px]">
                      <Check size={16} weight="bold" className="shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/contact"
                  className={`mt-auto inline-flex h-12 shrink-0 items-center justify-center rounded-full text-[15px] font-medium transition-transform duration-200 active:scale-[0.97] ${
                    p.featured ? "bg-ink-fg text-ink" : "border border-line-strong text-fg hover:bg-bg-2"
                  }`}
                >
                  Get a quote
                </Link>
              </div>
            </StaggerItem>
          ))}
        </Stagger>
      </section>

      <section className="mx-auto mt-40 grid max-w-6xl gap-12 px-4 md:grid-cols-[0.8fr_1.2fr] md:px-6">
        <h2 className="text-4xl font-semibold leading-[1.05] tracking-tight md:text-5xl">
          <WordRise text="Questions, answered." />
        </h2>
        <Reveal delay={0.1}>
          <Faq items={faq} />
        </Reveal>
      </section>
    </>
  );
}
