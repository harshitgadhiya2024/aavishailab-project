import type { Metadata } from "next";
import Image from "next/image";
import { ModulesBento } from "@/components/bento";
import { Button } from "@/components/button";
import { CountUp } from "@/components/count-up";
import { CtaBand } from "@/components/cta-band";
import { HeroField } from "@/components/hero-field";
import { Marquee } from "@/components/marquee";
import { ParallaxImage } from "@/components/parallax-image";
import { Enter, HeadlineRise } from "@/components/motion/enter";
import { Reveal, WordRise } from "@/components/motion/reveal";
import { ScrollText } from "@/components/scroll-text";
import { StickySteps, type Step } from "@/components/sticky-steps";
import { CTA, modules } from "@/lib/content";
import { JsonLd, SITE_URL } from "@/lib/seo";

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

export default function Home() {
  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "DelSecure",
          applicationCategory: "SecurityApplication",
          operatingSystem: "macOS, Windows, Linux",
          url: SITE_URL,
          description: "Endpoint security agent with web gateway, data loss prevention, application control, VPN control, malware scanning, device posture and activity monitoring.",
          featureList: modules.map((m) => m.name),
          offers: { "@type": "Offer", url: `${SITE_URL}/pricing`, availability: "https://schema.org/InStock" },
          publisher: { "@id": `${SITE_URL}/#org` },
        }}
      />
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="dot-field absolute inset-0 -z-10" aria-hidden />
        <div className="mx-auto grid min-h-[100dvh] max-w-6xl items-center gap-12 px-4 pb-16 pt-28 md:px-6 xl:grid-cols-[1.12fr_1fr] xl:pt-24">
          <div>
            <Enter>
              <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface/60 px-3 py-1 text-[12px] text-fg-2 backdrop-blur">
                <span className="size-1.5 rounded-full bg-signal" />
                Endpoint security for modern companies
              </span>
            </Enter>
            <h1 className="mt-6 text-[2.6rem] font-semibold leading-[1.02] tracking-[-0.035em] text-fg sm:text-6xl xl:text-[3.6rem]">
              <HeadlineRise text="Security that travels with every laptop." accent={["laptop"]} />
            </h1>
            <Enter delay={0.15}>
              <p className="mt-6 max-w-[44ch] text-lg leading-relaxed text-muted">
                One agent enforces your web, data and application policy on every device, on any network.
              </p>
            </Enter>
            <Enter delay={0.25} className="mt-9 flex flex-wrap gap-3">
              <Button href="/contact" size="lg">{CTA.demo}</Button>
              <Button href="/platform" size="lg" variant="ghost">{CTA.explore}</Button>
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

      {/* Coverage */}
      <section className="mx-auto max-w-6xl px-4 md:px-6">
        <p className="mb-8 text-center text-sm text-muted">Enforces policy across the platforms and apps your people already use</p>
        <Marquee />
      </section>

      {/* Manifesto */}
      <section className="mx-auto max-w-5xl px-4 py-32 md:px-6 md:py-44">
        <ScrollText
          className="text-3xl font-medium leading-[1.2] tracking-tight text-fg md:text-5xl"
          text="Your people work from home, from airports and from coffee shops. The office firewall never left the office. DelSecure puts the policy on the device itself, so it goes wherever they go."
        />
      </section>

      {/* Anywhere */}
      <section className="mx-auto max-w-[1400px] px-3 sm:px-4 md:px-6">
        <ParallaxImage
          src="/images/home-anywhere.webp"
          alt="An employee working on a laptop in an airport lounge at dusk, the laptop edged with an orange protective glow"
          sizes="(max-width: 1400px) 100vw, 1400px"
          aspect="aspect-[4/3] sm:aspect-[21/9]"
          strength={70}
        />
      </section>

      {/* Modules */}
      <section className="mx-auto mt-32 max-w-6xl px-4 md:mt-40 md:px-6">
        <div className="mb-12 max-w-2xl">
          <h2 className="text-4xl font-semibold leading-[1.05] tracking-tight md:text-5xl">
            <WordRise text="Seven controls. One agent." accent={["agent"]} />
          </h2>
          <Reveal delay={0.2}>
            <p className="mt-5 text-lg leading-relaxed text-muted">Turn on what you need today. Everything runs in the same agent and reports to the same console.</p>
          </Reveal>
        </div>
        <ModulesBento />
      </section>

      {/* How it works */}
      <section className="mx-auto mt-40 max-w-6xl px-4 md:px-6">
        <div className="mb-12 max-w-2xl">
          <Reveal>
            <span className="text-[12px] font-medium uppercase tracking-[0.16em] text-brand-ink">How it works</span>
          </Reveal>
          <h2 className="mt-4 text-4xl font-semibold leading-[1.05] tracking-tight md:text-5xl">
            <WordRise text="Live in an afternoon." accent={["afternoon"]} />
          </h2>
        </div>
        <StickySteps steps={steps} />
      </section>

      {/* Agent */}
      <section className="mx-auto mt-32 grid max-w-6xl items-center gap-10 px-4 md:px-6 lg:grid-cols-[1fr_1.1fr]">
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
          <h2 className="text-4xl font-semibold leading-[1.05] tracking-tight md:text-5xl">
            <WordRise text="Small agent. Serious engineering." accent={["Serious"]} />
          </h2>
          <Reveal delay={0.2}>
            <p className="mt-5 max-w-[48ch] text-lg leading-relaxed text-muted">
              Built in Rust as a single binary, the agent intercepts traffic locally and verifies every policy it receives.
            </p>
          </Reveal>
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
      </section>

      <CtaBand />
    </>
  );
}
