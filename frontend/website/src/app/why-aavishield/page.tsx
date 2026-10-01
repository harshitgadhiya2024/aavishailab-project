import type { Metadata } from "next";
import Image from "next/image";
import { Check, Minus, X } from "@phosphor-icons/react/dist/ssr";
import { BeforeAfter, CardGrid, FaqSection, FeatureSplit } from "@/components/blocks";
import { BrowserFrame } from "@/components/browser-frame";
import { Button } from "@/components/button";
import { CtaBand } from "@/components/cta-band";
import { Reveal } from "@/components/motion/reveal";
import { PageHero } from "@/components/page-hero";
import { ScrollText } from "@/components/scroll-text";
import { Section, SectionHead } from "@/components/section";
import { CTA } from "@/lib/content";
import { JsonLd, breadcrumbLd, faqLd } from "@/lib/seo";
import { shots } from "@/lib/shots";

export const metadata: Metadata = {
  title: "Why Aavishield: One Agent Instead of Four Security Tools",
  description: "Why companies choose Aavishield over office firewalls, VPN-based cloud proxies and a stack of separate point tools for web filtering, DLP and device compliance.",
  alternates: { canonical: "/why-aavishield" },
  openGraph: { url: "/why-aavishield" },
};

type V = "yes" | "no" | "part";
const rows: { label: string; fw: V; proxy: V; points: V; ds: V }[] = [
  { label: "Protects laptops off the office network", fw: "no", proxy: "yes", points: "part", ds: "yes" },
  { label: "No VPN or traffic backhaul", fw: "no", proxy: "part", points: "yes", ds: "yes" },
  { label: "Web filtering by category", fw: "yes", proxy: "yes", points: "part", ds: "yes" },
  { label: "DLP across web and desktop apps", fw: "no", proxy: "part", points: "part", ds: "yes" },
  { label: "Application and VPN blocking", fw: "part", proxy: "no", points: "part", ds: "yes" },
  { label: "Device posture checks", fw: "no", proxy: "no", points: "part", ds: "yes" },
  { label: "One agent and one console", fw: "yes", proxy: "part", points: "no", ds: "yes" },
  { label: "Run by one IT person", fw: "part", proxy: "no", points: "no", ds: "yes" },
];

const reasons = [
  { title: "One agent, not four", body: "Web gateway, DLP, application control, VPN blocking, malware scanning, posture and monitoring share one binary and one install." },
  { title: "Policy on the device", body: "Enforcement happens on the laptop, so it works at home, in the office and on the road, with no backhaul." },
  { title: "Visibility before blocking", body: "Monitor-only DLP shows what is happening without stopping work, so you tighten policy based on facts." },
  { title: "Built for small teams", body: "A console designed for one IT person, with plain-language alerts, guided fixes and an assistant." },
  { title: "Cross-platform from day one", body: "macOS, Windows and Linux with the same policy, not a Windows product with a Mac afterthought." },
  { title: "Security of its own", body: "Signed policy bundles, per-organisation isolation, encrypted keys and signed media links." },
];

const stop = ["A separate DLP product", "A cloud proxy contract", "An office firewall subscription for remote staff", "A posture or compliance agent", "Hours collecting audit screenshots"];

const faq = [
  { q: "Does Aavishield replace our firewall?", a: "It replaces the role an office firewall played for laptops, because policy is enforced on the device. Your office network may still have its own firewall for servers and guests." },
  { q: "Does it replace antivirus?", a: "It adds download scanning and malicious site blocking, and checks that an antivirus product is present. Keep your endpoint antivirus running." },
  { q: "How is it different from MDM?", a: "Mobile device management configures devices. Aavishield enforces web, data and application policy and records what happens. Many companies use both." },
  { q: "Is it suitable for large companies?", a: "Yes, but it is designed so smaller teams can run it without a dedicated security department. Talk to us about your fleet size." },
];

const icon = (v: V) =>
  v === "yes" ? (
    <span className="inline-grid size-6 place-items-center rounded-full bg-brand text-on-brand"><Check size={12} weight="bold" /></span>
  ) : v === "part" ? (
    <span className="inline-grid size-6 place-items-center rounded-full bg-bg-2 text-muted"><Minus size={12} weight="bold" /></span>
  ) : (
    <span className="inline-grid size-6 place-items-center rounded-full bg-danger/10 text-danger"><X size={12} weight="bold" /></span>
  );

export default function WhyPage() {
  return (
    <>
      <JsonLd data={breadcrumbLd([{ name: "Home", path: "" }, { name: "Why Aavishield", path: "/why-aavishield" }])} />
      <JsonLd data={faqLd(faq)} />

      {/* 1. Hero */}
      <PageHero eyebrow="Why Aavishield" accent={["four."]} title="One agent instead of four." body="Most companies protect laptops with a patchwork: an office firewall, a VPN, a DLP tool and a compliance checker. Aavishield replaces the patchwork with one agent and one console.">
        <Button href="/contact" size="lg">{CTA.demo}</Button>
      </PageHero>

      {/* 2. Before/after */}
      <section className="mx-auto max-w-6xl px-4 md:px-6">
        <BeforeAfter
          beforeTitle="The patchwork"
          afterTitle="Aavishield"
          before={["Firewall only protects the office", "VPN backhaul slows everyone down", "DLP in one tool, posture in another", "Four consoles, four agents, four bills"]}
          after={["Policy on every device, every network", "Direct internet with enforcement intact", "Seven controls in one agent", "One console, one bill"]}
        />
      </section>

      {/* 3. Comparison */}
      <Section>
        <SectionHead eyebrow="Compared" title="How the common approaches stack up." body="A general comparison of approaches, not of specific vendors. Your needs may differ, and we are happy to walk through them." />
        <Reveal className="mt-12 overflow-x-auto rounded-[20px] border border-line bg-surface">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-line bg-bg-2">
                <th className="px-5 py-4 font-medium text-fg">Capability</th>
                <th className="px-4 py-4 text-center font-medium text-muted">Office firewall</th>
                <th className="px-4 py-4 text-center font-medium text-muted">VPN + cloud proxy</th>
                <th className="px-4 py-4 text-center font-medium text-muted">Separate point tools</th>
                <th className="px-4 py-4 text-center font-semibold text-brand-ink">Aavishield</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="border-b border-line last:border-0">
                  <td className="px-5 py-3.5 text-fg">{r.label}</td>
                  <td className="px-4 py-3.5 text-center">{icon(r.fw)}</td>
                  <td className="px-4 py-3.5 text-center">{icon(r.proxy)}</td>
                  <td className="px-4 py-3.5 text-center">{icon(r.points)}</td>
                  <td className="bg-brand/[0.04] px-4 py-3.5 text-center">{icon(r.ds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Reveal>
        <p className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted">
          <span className="flex items-center gap-2">{icon("yes")} Yes</span>
          <span className="flex items-center gap-2">{icon("part")} Partly, or depends on setup</span>
          <span className="flex items-center gap-2">{icon("no")} No</span>
        </p>
      </Section>

      {/* 4. Reasons */}
      <Section>
        <SectionHead eyebrow="Six reasons" title="Why teams switch." accent={["switch."]} />
        <div className="mt-12"><CardGrid items={reasons} /></div>
      </Section>

      {/* 5. Manifesto */}
      <section className="mx-auto max-w-5xl px-4 py-28 md:px-6 md:py-36">
        <ScrollText className="text-3xl font-medium leading-[1.2] tracking-tight text-fg md:text-5xl" text="Every extra agent is another thing to install, update and debug. Every extra console is another place to forget to look. We kept it to one of each." />
      </section>

      {/* 6. One console */}
      <Section className="!mt-0">
        <FeatureSplit eyebrow="One console" title="Every control reports to the same overview" body="Incidents from web, data, apps, VPN, downloads and posture land side by side, so nothing hides in a console nobody opens." points={["One security overview", "One activity feed", "One set of reports"]} shot={shots.overview} />
      </Section>

      {/* 7. What you stop paying for */}
      <Section>
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <Reveal y={40} className="relative aspect-[4/3] overflow-hidden rounded-[28px] bg-ink">
            <Image src="/images/home-agent.webp" alt="Close-up of a glowing orange chip embedded in a dark laptop chassis" fill sizes="(max-width: 1024px) 100vw, 560px" className="object-cover" />
          </Reveal>
          <div>
            <SectionHead eyebrow="Consolidation" title="What you can stop paying for." accent={["stop"]} />
            <ul className="mt-8 grid gap-3">
              {stop.map((s, i) => (
                <Reveal key={s} delay={i * 0.05}>
                  <li className="flex items-center gap-4 rounded-[16px] border border-line bg-surface p-4 text-fg-2">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-danger/10 text-danger"><X size={11} weight="bold" /></span>
                    <span className="line-through decoration-muted/60">{s}</span>
                  </li>
                </Reveal>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      {/* 8. Visual proof */}
      <Section>
        <div className="grid gap-4 md:grid-cols-2">
          <Reveal className="min-w-0"><BrowserFrame shot={shots.dlp} sizes="(max-width: 768px) 100vw, 560px" /></Reveal>
          <Reveal delay={0.1} className="min-w-0"><BrowserFrame shot={shots.reportsCompliance} sizes="(max-width: 768px) 100vw, 560px" /></Reveal>
        </div>
      </Section>

      {/* 9. FAQ */}
      <FaqSection title="Comparing options" items={faq} />

      <CtaBand title="See if one agent can replace your stack." />
    </>
  );
}
