import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, Eye, Signature, UsersThree } from "@phosphor-icons/react/dist/ssr";
import { FaqSection, FeatureSplit } from "@/components/blocks";
import { ModulesBento } from "@/components/bento";
import { BrowserFrame } from "@/components/browser-frame";
import { Button } from "@/components/button";
import { CountUp } from "@/components/count-up";
import { CtaBand } from "@/components/cta-band";
import { HeroField } from "@/components/hero-field";
import { Marquee } from "@/components/marquee";
import { ParallaxImage } from "@/components/parallax-image";
import { Enter, HeadlineRise } from "@/components/motion/enter";
import { Reveal, Stagger, StaggerItem } from "@/components/motion/reveal";
import { ProductTabs } from "@/components/product-tabs";
import { ScrollText } from "@/components/scroll-text";
import { ScrollTilt } from "@/components/scroll-tilt";
import { Section, SectionHead } from "@/components/section";
import { SolutionIcon } from "@/components/solution-icon";
import { StickySteps, type Step } from "@/components/sticky-steps";
import { CTA, modules } from "@/lib/content";
import { JsonLd, SITE_URL, faqLd } from "@/lib/seo";
import { shots } from "@/lib/shots";
import { industries, solutionsList } from "@/lib/solutions";

export const metadata: Metadata = { alternates: { canonical: "/" } };

const steps: Step[] = [
  {
    verb: "Install",
    icon: "install",
    title: "One agent. Every operating system.",
    body: "A single lightweight binary runs the same way on macOS, Windows and Linux. Employees enroll their own device from a link.",
    detail: ["Native .pkg, .msi and .deb installers", "Self-enrollment portal for employees", "Automatic updates, no reinstalling"],
  },
  {
    verb: "Set policy",
    icon: "policy",
    title: "Choose what is allowed, once.",
    body: "Pick web categories, apps to block and data to watch from the admin console. Devices pull the signed policy and enforce it locally.",
    detail: ["Category and custom domain lists", "Per-employee and per-group rules", "Ed25519-signed policy bundles"],
  },
  {
    verb: "See everything",
    icon: "observe",
    title: "Every decision, in one console.",
    body: "Blocked sites, flagged uploads, stopped downloads and posture gaps arrive in real time, tied to the person and the device.",
    detail: ["Live event stream per device", "Sensitive-data findings with the file", "Posture status across the fleet"],
  },
];

const stats = [
  { n: 1, label: "agent binary", body: "Written in Rust, identical on every platform." },
  { n: 3, label: "operating systems", body: "macOS, Windows and Linux from day one." },
  { n: 7, label: "security controls", body: "From web filtering to device posture." },
  { n: 0, label: "appliances to rack", body: "Enforcement lives on the device itself." },
];

const tour = [
  { id: "overview", label: "Overview", title: "Your whole company on one screen", body: "Devices online, employee coverage, laptops that need a fix and incidents by control, refreshed every minute.", shot: shots.overview },
  { id: "dlp", label: "Data loss", title: "Every sensitive upload, with the file and the person", body: "Gmail, Outlook, Teams, WhatsApp, ChatGPT and more: who sent what, where, and why it was flagged.", shot: shots.dlp },
  { id: "web", label: "Web gateway", title: "Policies you can read", body: "Category and domain policies, who they apply to and what they blocked, with a URL checker to test any address.", shot: shots.urlChecker },
  { id: "apps", label: "Applications", title: "Every installed app, every device", body: "An inventory across macOS, Windows and Linux with a switch to block each app.", shot: shots.applications },
  { id: "activity", label: "Activity", title: "One feed for every control", body: "Blocked and alerted events from web, DLP, apps, downloads and posture, searchable and filterable.", shot: shots.activity },
  { id: "reports", label: "Reports", title: "Reports for leadership and auditors", body: "Executive summary, compliance and risk reports, exported to PDF, Excel or CSV.", shot: shots.reports },
  { id: "monitoring", label: "Monitoring", title: "Activity insight where you need it", body: "Timeline, work sessions and periodic screenshots for the devices you choose to monitor.", shot: shots.screenshots },
];

const trust = [
  { I: Signature, title: "Signed policy", body: "Policy bundles are signed with Ed25519 and verified on every device." },
  { I: Eye, title: "Monitor-only DLP", body: "DLP records findings and never blocks anyone's work." },
  { I: UsersThree, title: "Isolated per company", body: "Every organisation's data is scoped to that organisation alone." },
];

const faq = [
  { q: "What is Aavishield?", a: "Aavishield is endpoint security for companies. One lightweight agent on each laptop enforces web filtering, data loss prevention, application control, VPN blocking, malware scanning, device posture checks and optional activity monitoring, all managed from one console." },
  { q: "Which operating systems does it support?", a: "macOS, Windows and Linux. The same agent binary and the same policy work on all three." },
  { q: "Do we need a VPN or office firewall?", a: "No. Enforcement runs on the device itself, so it works on any network with nothing to route." },
  { q: "Will DLP interrupt employees?", a: "No. Data loss prevention is monitor-only. It records what sensitive data left and where it went, without blocking the upload." },
  { q: "How long does setup take?", a: "Most teams install the agent and switch on their first policy in an afternoon." },
];

export default function Home() {
  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "Aavishield",
          applicationCategory: "SecurityApplication",
          operatingSystem: "macOS, Windows, Linux",
          url: SITE_URL,
          screenshot: `${SITE_URL}${shots.overview.src}`,
          description: "Endpoint security agent with web gateway, data loss prevention, application control, VPN control, malware scanning, device posture and activity monitoring.",
          featureList: modules.map((m) => m.name),
          offers: { "@type": "Offer", url: `${SITE_URL}/pricing`, availability: "https://schema.org/InStock" },
          publisher: { "@id": `${SITE_URL}/#org` },
        }}
      />
      <JsonLd data={faqLd(faq)} />

      {/* 1. Hero */}
      <section className="relative overflow-hidden">
        <div className="dot-field absolute inset-0 -z-10" aria-hidden />
        <div className="mx-auto grid min-h-[92dvh] max-w-6xl items-center gap-12 px-4 pb-10 pt-28 md:px-6 xl:grid-cols-[1.12fr_1fr] xl:pt-24">
          <div>
            <Enter>
              <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface/60 px-3 py-1 text-[12px] text-fg-2 backdrop-blur">
                <span className="size-1.5 rounded-full bg-signal" />
                Endpoint security for modern companies
              </span>
            </Enter>
            <h1 className="mt-6 text-[2.6rem] font-semibold leading-[1.02] tracking-[-0.035em] text-fg sm:text-6xl xl:text-[3.6rem]">
              <HeadlineRise text="Security that travels with every laptop." accent={["laptop."]} />
            </h1>
            <Enter delay={0.15}>
              <p className="mt-6 max-w-[46ch] text-lg leading-relaxed text-muted">
                One agent enforces your web, data and application policy on every device, on any network. One console shows you everything it sees.
              </p>
            </Enter>
            <Enter delay={0.25} className="mt-9 flex flex-wrap gap-3">
              <Button href="/contact" size="lg">{CTA.demo}</Button>
              <Button href="/product-tour" size="lg" variant="ghost">Take the product tour</Button>
            </Enter>
            <Enter delay={0.35} className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
              <span>macOS · Windows · Linux</span>
              <span>No VPN or appliance</span>
              <span>Live in an afternoon</span>
            </Enter>
          </div>
          <Reveal delay={0.2} y={40} className="flex h-[370px] min-w-0 justify-center overflow-hidden sm:h-auto sm:overflow-visible">
            {/* Below sm the field renders at desktop size and is scaled, so chips never collide. */}
            <div className="w-[520px] shrink-0 origin-top scale-[0.68] sm:w-full sm:shrink sm:scale-100">
              <HeroField />
            </div>
          </Reveal>
        </div>
      </section>

      {/* 2. The console */}
      <section className="relative mx-auto max-w-6xl px-4 md:px-6">
        <div aria-hidden className="absolute inset-x-10 top-20 -z-10 h-[60%] rounded-full bg-brand/15 blur-3xl" />
        <ScrollTilt>
          <BrowserFrame shot={shots.overview} sizes="(max-width: 1200px) 100vw, 1150px" />
        </ScrollTilt>
        <Reveal className="mt-6 text-center text-sm text-muted">The real Aavishield console. Every screenshot on this site is the product, with demo data.</Reveal>
      </section>

      {/* 3. Coverage */}
      <Section>
        <p className="mb-8 text-center text-sm text-muted">Enforces policy across the platforms and apps your people already use</p>
        <Marquee />
      </Section>

      {/* 4. Problems */}
      <Section>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <SectionHead eyebrow="Problems we solve" title="Start from the problem keeping you up at night." accent={["night."]} />
          <Reveal><Button href="/solutions" variant="ghost">All solutions</Button></Reveal>
        </div>
        <Stagger className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {solutionsList.map((s) => (
            <StaggerItem key={s.slug}>
              <Link href={`/solutions/${s.slug}`} className="group flex h-full items-start gap-4 rounded-[20px] border border-line bg-surface p-5 transition-colors duration-300 hover:border-brand/50">
                <span className="grid size-11 shrink-0 place-items-center rounded-2xl border border-line text-fg transition-colors duration-300 group-hover:border-brand group-hover:bg-brand group-hover:text-on-brand">
                  <SolutionIcon icon={s.icon} size={20} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-fg">{s.name}</span>
                  <span className="mt-1 block text-sm leading-relaxed text-muted">{s.menu}</span>
                </span>
                <ArrowUpRight size={16} className="mt-1 shrink-0 text-muted transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </Link>
            </StaggerItem>
          ))}
        </Stagger>
      </Section>

      {/* 5. Manifesto */}
      <section className="mx-auto max-w-5xl px-4 py-32 md:px-6 md:py-44">
        <ScrollText
          className="text-3xl font-medium leading-[1.2] tracking-tight text-fg md:text-5xl"
          text="Your people work from home, from airports and from coffee shops. The office firewall never left the office. Aavishield puts the policy on the device itself, so it goes wherever they go."
        />
      </section>

      {/* 6. Anywhere */}
      <section className="mx-auto max-w-[1400px] px-3 sm:px-4 md:px-6">
        <ParallaxImage
          src="/images/home-anywhere.webp"
          alt="An employee working on a laptop in an airport lounge at dusk, the laptop edged with an orange protective glow"
          sizes="(max-width: 1400px) 100vw, 1400px"
          aspect="aspect-[4/3] sm:aspect-[21/9]"
          strength={70}
        />
      </section>

      {/* 7. Modules */}
      <Section>
        <SectionHead eyebrow="Platform" title="Seven controls. One agent." accent={["agent."]} body="Turn on what you need today. Everything runs in the same agent and reports to the same console." />
        <div className="mt-12"><ModulesBento /></div>
      </Section>

      {/* 8. Product tour tabs */}
      <Section>
        <SectionHead center eyebrow="Inside the console" title="Click through the real product." accent={["real"]} body="No mock-ups. These are live screens from Aavishield, captured with demo data." />
        <div className="mt-12"><ProductTabs tabs={tour} /></div>
      </Section>

      {/* 9. How it works */}
      <Section>
        <SectionHead eyebrow="How it works" title="Live in an afternoon." accent={["afternoon."]} />
        <div className="mt-12"><StickySteps steps={steps} /></div>
        <Reveal className="mt-10"><Button href="/how-it-works" variant="ghost">The full rollout guide</Button></Reveal>
      </Section>

      {/* 10. DLP spotlight */}
      <Section>
        <FeatureSplit
          eyebrow="Data loss prevention"
          title="Know exactly what left the building."
          body="Aavishield reads inside uploads and messages to Gmail, Outlook, Teams, WhatsApp, ChatGPT and any other site or app, including scanned images, and records every sensitive finding without blocking anyone."
          points={["Card numbers, PAN, Aadhaar, bank details", "API keys, tokens and source code", "AI classification of contracts, salary sheets and IDs"]}
          shot={shots.dlp}
        >
          <Button href="/platform/data-loss-prevention" variant="ghost">Explore DLP</Button>
        </FeatureSplit>
      </Section>

      {/* 11. Assistant spotlight */}
      <Section>
        <FeatureSplit
          eyebrow="Built-in assistant"
          title="Ask your security data a question."
          body="The Aavishield assistant answers in plain language from your live data: which laptops need a fix, who had the most incidents this week, what the latest DLP alerts were. It reads, it never changes anything."
          points={["Answers from live console data", "Exports reports on request", "Read-only by design"]}
          shot={shots.ai}
          reverse
        />
      </Section>

      {/* 12. Light and dark */}
      <Section>
        <SectionHead center eyebrow="Designed for daily use" title="Light by day. Dark by night." accent={["Dark"]} body="A console people actually want to open, in the theme they prefer." />
        <div className="mt-12 grid gap-4 md:grid-cols-2">
          <Reveal className="min-w-0"><BrowserFrame shot={shots.reports} sizes="(max-width: 768px) 100vw, 560px" /></Reveal>
          <Reveal delay={0.1} className="min-w-0"><BrowserFrame shot={shots.reportsDark} sizes="(max-width: 768px) 100vw, 560px" /></Reveal>
        </div>
      </Section>

      {/* 13. Industries */}
      <Section>
        <SectionHead eyebrow="Industries" title="Shaped around the data you handle." />
        <Stagger className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {industries.map((ind) => (
            <StaggerItem key={ind.slug}>
              <Link href={`/industries/${ind.slug}`} className="group block h-full rounded-[20px] border border-line bg-surface p-6 transition-colors duration-300 hover:border-brand/50">
                <SolutionIcon icon={ind.icon} size={26} className="text-brand-ink" />
                <h3 className="mt-6 font-semibold text-fg">{ind.name}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{ind.menu}</p>
              </Link>
            </StaggerItem>
          ))}
        </Stagger>
      </Section>

      {/* 14. Agent */}
      <Section className="grid items-center gap-10 lg:grid-cols-[1fr_1.1fr]">
        <Reveal y={40} className="relative aspect-[4/3] overflow-hidden rounded-[28px] bg-ink">
          <Image
            src="/images/home-agent.webp"
            alt="Close-up of a glowing orange chip embedded in a dark laptop chassis with light traces radiating outward"
            fill
            sizes="(max-width: 1024px) 100vw, 540px"
            className="object-cover transition-transform duration-[1.2s] ease-out-expo hover:scale-105"
          />
        </Reveal>
        <div>
          <SectionHead title="Small agent. Serious engineering." accent={["Serious"]} body="Built in Rust as a single binary, the agent intercepts traffic locally and verifies every policy it receives." />
          <div className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-[20px] border border-line bg-line">
            {stats.map((s, i) => (
              <Reveal key={s.label} delay={i * 0.08} className="bg-bg p-6">
                <p className="text-5xl font-semibold tracking-tighter text-fg">
                  <CountUp to={s.n} />
                  <span className="text-brand">.</span>
                </p>
                <p className="mt-2 text-sm font-medium text-fg">{s.label}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-muted">{s.body}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </Section>

      {/* 15. Trust */}
      <Section>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <SectionHead eyebrow="Trust" title="A security product has to earn trust first." accent={["trust"]} />
          <Reveal><Button href="/security" variant="ghost">How we protect your data</Button></Reveal>
        </div>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {trust.map(({ I, title, body }, i) => (
            <Reveal key={title} delay={i * 0.06} className="rounded-[20px] border border-line bg-surface p-7">
              <span className="grid size-12 place-items-center rounded-2xl bg-brand text-on-brand"><I size={22} weight="light" /></span>
              <h3 className="mt-6 text-lg font-semibold text-fg">{title}</h3>
              <p className="mt-2 leading-relaxed text-muted">{body}</p>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* 16. FAQ */}
      <FaqSection title="Questions, answered." items={faq} />

      <CtaBand />
    </>
  );
}
