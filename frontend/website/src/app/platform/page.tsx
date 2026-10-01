import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { AppleLogo, ArrowUpRight, LinuxLogo, WindowsLogo } from "@phosphor-icons/react/dist/ssr";
import { Architecture } from "@/components/architecture";
import { CardGrid, FaqSection, FeatureSplit } from "@/components/blocks";
import { BrowserFrame } from "@/components/browser-frame";
import { Button } from "@/components/button";
import { CtaBand } from "@/components/cta-band";
import { ModuleIcon } from "@/components/icons";
import { PageHero } from "@/components/page-hero";
import { Spotlight } from "@/components/motion/spotlight";
import { Reveal, Stagger, StaggerItem } from "@/components/motion/reveal";
import { ScrollTilt } from "@/components/scroll-tilt";
import { Section, SectionHead } from "@/components/section";
import { CTA, modules } from "@/lib/content";
import { moduleShots } from "@/lib/module-shots";
import { JsonLd, SITE_URL, breadcrumbLd, faqLd } from "@/lib/seo";
import { shots } from "@/lib/shots";

export const metadata: Metadata = {
  title: "Platform: Seven Endpoint Security Controls in One Agent",
  description:
    "Explore the Aavishield platform: secure web gateway, data loss prevention, application control, VPN control, malware scanning, device posture and activity monitoring in one lightweight agent.",
  alternates: { canonical: "/platform" },
  openGraph: { url: "/platform" },
};

const os = [
  { I: AppleLogo, name: "macOS", body: "Signed .pkg installer. FileVault, firewall and update checks built in." },
  { I: WindowsLogo, name: "Windows", body: "Native .msi installer. BitLocker, Windows Firewall and Defender status." },
  { I: LinuxLogo, name: "Linux", body: "Packages for Ubuntu, Debian and Fedora. LUKS and firewall checks." },
];

const admin = [
  { title: "Teams and roles", body: "Group employees into teams and give admins, analysts and read-only users the access they need." },
  { title: "Access requests", body: "Employees ask to unblock a site with a reason. Approve or decline in one click." },
  { title: "Built-in assistant", body: "Ask questions about devices, alerts and reports in plain language. It reads, never changes." },
  { title: "Exports everywhere", body: "Reports and lists export to PDF, Excel or CSV for audits and leadership." },
  { title: "Two-factor sign-in", body: "Every sign-in needs an emailed code or an authenticator app. Organisations can require app-based 2FA." },
  { title: "Email alerts", body: "Admins are emailed when malware is blocked or a high-risk DLP finding appears." },
];

const faq = [
  { q: "Do I have to use all seven controls?", a: "No. Turn on the controls you need now and add others later. They all run in the same agent, so it is a policy change, not a reinstall." },
  { q: "How heavy is the agent?", a: "It is a single Rust binary designed to run quietly in the background on everyday laptops." },
  { q: "Where is policy enforced?", a: "On the device. The agent pulls a signed policy bundle and enforces it locally, so it works on any network." },
  { q: "Can employees see what is blocked?", a: "Yes. The employee portal shows their devices and what was blocked, and they can request access to a site." },
];

export default function PlatformPage() {
  return (
    <>
      <JsonLd data={breadcrumbLd([{ name: "Home", path: "" }, { name: "Platform", path: "/platform" }])} />
      <JsonLd data={faqLd(faq)} />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "ItemList",
          itemListElement: modules.map((m, i) => ({ "@type": "ListItem", position: i + 1, name: m.name, url: `${SITE_URL}/platform/${m.slug}` })),
        }}
      />

      {/* 1. Hero */}
      <PageHero accent={["agent."]} eyebrow="Platform" title="Every control your devices need, in one agent." body="Seven security controls share a single lightweight agent and a single console. Turn each one on when you are ready.">
        <Button href="/contact" size="lg">{CTA.demo}</Button>
        <Button href="/product-tour" size="lg" variant="ghost">Product tour</Button>
      </PageHero>

      {/* 2. Console */}
      <section className="mx-auto max-w-6xl px-4 md:px-6">
        <ScrollTilt>
          <BrowserFrame shot={shots.activity} priority sizes="(max-width: 1200px) 100vw, 1150px" />
        </ScrollTilt>
      </section>

      {/* 3. Modules */}
      <Section>
        <SectionHead eyebrow="The seven controls" title="Pick what you need. Add the rest later." accent={["later."]} />
        <Stagger className="mt-12 grid gap-4 md:grid-cols-2">
          {modules.map((m, i) => (
            <StaggerItem key={m.slug} className={i === modules.length - 1 ? "md:col-span-2" : ""}>
              <Spotlight className="h-full">
                <Link href={`/platform/${m.slug}`} className={`grid h-full ${i === modules.length - 1 ? "md:grid-cols-2" : ""}`}>
                  <div className={`relative m-2 overflow-hidden rounded-[14px] bg-bg-2 ${i === modules.length - 1 ? "aspect-[16/9] md:aspect-auto md:min-h-[260px]" : "aspect-[16/9]"}`}>
                    <Image
                      src={shots[moduleShots[m.slug].hero].src}
                      alt={shots[moduleShots[m.slug].hero].alt}
                      fill
                      sizes="(max-width: 768px) 100vw, 560px"
                      className="object-cover object-left-top transition-transform duration-[1.1s] ease-out-expo group-hover:scale-[1.05]"
                    />
                  </div>
                  <div className="flex flex-col justify-between gap-8 p-6 md:p-8">
                    <div className="flex items-start justify-between">
                      <span className="grid size-12 place-items-center rounded-2xl border border-line text-fg transition-colors duration-300 group-hover:border-brand group-hover:bg-brand group-hover:text-on-brand">
                        <ModuleIcon icon={m.icon} size={24} />
                      </span>
                      <ArrowUpRight size={20} className="text-muted transition-[transform,color] duration-300 ease-out-expo group-hover:-translate-y-1 group-hover:translate-x-1 group-hover:text-brand-ink" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-semibold tracking-tight text-fg">{m.name}</h2>
                      <p className="mt-2 max-w-[48ch] leading-relaxed text-muted">{m.short}</p>
                    </div>
                  </div>
                </Link>
              </Spotlight>
            </StaggerItem>
          ))}
        </Stagger>
      </Section>

      {/* 4. Architecture */}
      <Section>
        <SectionHead eyebrow="Architecture" title="How the pieces fit together." accent={["together."]} />
        <div className="mt-16"><Architecture /></div>
      </Section>

      {/* 5. One console */}
      <Section>
        <SectionHead eyebrow="One console" title="Everything the agent sees, in one place." />
        <div className="mt-16 grid gap-24">
          <FeatureSplit eyebrow="Overview" title="The security overview" body="Devices online, employee coverage, laptops that need a fix, and incidents for every control, compared with the previous period." points={["Refreshes every minute", "Needs-attention list with fixes", "Any date range"]} shot={shots.overview} />
          <FeatureSplit eyebrow="Reports" title="Reports that answer real questions" body="Executive summary, all incidents, data protection, web filtering, application control, employee risk, device compliance and policy effectiveness." points={["PDF, Excel and CSV export", "AI-written briefing of the numbers", "Compared with the previous period"]} shot={shots.reports} reverse />
          <FeatureSplit eyebrow="People" title="Employees, teams and devices" body="Import employees from CSV, organise them into teams and see each person's devices and risk in one directory." points={["CSV import and export", "Team-based policies", "Per-employee device list"]} shot={shots.employees} />
        </div>
      </Section>

      {/* 6. Operating systems */}
      <Section>
        <div className="grid items-center gap-12 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <SectionHead eyebrow="Cross-platform" title="One agent for macOS, Windows and Linux." accent={["One", "agent"]} body="Employees download a native installer from their portal. The same policy works on every operating system." />
            <div className="mt-10 grid gap-3">
              {os.map(({ I, name, body }, i) => (
                <Reveal key={name} delay={i * 0.06} className="flex items-start gap-4 rounded-[18px] border border-line bg-surface p-5">
                  <I size={26} weight="fill" className="shrink-0 text-fg" />
                  <span>
                    <span className="block font-semibold text-fg">{name}</span>
                    <span className="mt-1 block text-sm text-muted">{body}</span>
                  </span>
                </Reveal>
              ))}
            </div>
          </div>
          <Reveal y={40} className="min-w-0"><BrowserFrame shot={shots.portalDownload} crop={{ x: 0, y: 0, scale: 1.7 }} aspect="aspect-[16/11]" sizes="(max-width: 1024px) 100vw, 600px" /></Reveal>
        </div>
      </Section>

      {/* 7. Admin features */}
      <Section>
        <SectionHead eyebrow="For admins" title="The details that make it easy to run." accent={["easy"]} />
        <div className="mt-12"><CardGrid items={admin} /></div>
      </Section>

      {/* 8. Access requests */}
      <Section>
        <FeatureSplit eyebrow="Employee experience" title="A fair way to ask for exceptions" body="When a site is blocked, employees can request access with a reason. Admins see every request with the policy that blocked it." points={["Reason captured with each request", "Approve or decline per domain", "Full history kept"]} shot={shots.accessRequests} reverse />
      </Section>

      {/* 9. FAQ */}
      <FaqSection title="Platform questions" items={faq} />

      <CtaBand />
    </>
  );
}
