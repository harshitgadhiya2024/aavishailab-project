import type { Metadata } from "next";
import Link from "next/link";
import {
  AirplaneTilt,
  AppleLogo,
  AppWindow,
  Detective,
  FileArrowUp,
  DropboxLogo,
  GithubLogo,
  GoogleDriveLogo,
  GoogleLogo,
  LinuxLogo,
  MicrosoftOutlookLogo,
  MicrosoftTeamsLogo,
  WhatsappLogo,
  OpenAiLogo,
  PlayCircle,
  SlackLogo,
  WindowsLogo,
} from "@phosphor-icons/react/dist/ssr";
import { DitherField } from "@/components/landing/dither-field";
import { GridButton } from "@/components/landing/grid-button";
import { GridFrame, GridHeading, GridRow, H1Kicker, Label } from "@/components/landing/grid";
import { WhyGrid } from "@/components/landing/why-grid";
import { EarlyAccess, MidCta, OBJECTIONS, Objections, Reassurance, TrustSection } from "@/components/landing/conversion";
import { StickyCta } from "@/components/landing/sticky-cta";
import { LiveFeed } from "@/components/landing/live-feed";
import { AgentTag, AppControlVisual, DlpVisual, FlowDiagram, PixelPanel, PostureVisual, WebGatewayVisual } from "@/components/landing/visuals";
import { ConsoleShowcase, type ConsoleScreen } from "@/components/landing/console-showcase";
import { Enter } from "@/components/motion/enter";
import { Reveal, Stagger, StaggerItem } from "@/components/motion/reveal";
import { CTA, modules } from "@/lib/content";
import { JsonLd, SITE_URL, faqLd } from "@/lib/seo";
import { shots } from "@/lib/shots";

export const metadata: Metadata = { alternates: { canonical: "/" } };

const coverage = [
  { I: AppleLogo, name: "macOS" },
  { I: WindowsLogo, name: "Windows" },
  { I: LinuxLogo, name: "Linux" },
  { I: GoogleLogo, name: "Gmail" },
  { I: MicrosoftOutlookLogo, name: "Outlook" },
  { I: MicrosoftTeamsLogo, name: "Teams" },
  { I: OpenAiLogo, name: "ChatGPT" },
  { I: SlackLogo, name: "Slack" },
  { I: WhatsappLogo, name: "WhatsApp" },
  { I: GoogleDriveLogo, name: "Google Drive" },
  { I: DropboxLogo, name: "Dropbox" },
  { I: GithubLogo, name: "GitHub" },
];

const problems = [
  { I: FileArrowUp, title: "Data Leaving Through AI Tools", body: "Customer lists pasted into ChatGPT and contracts uploaded to personal drives happen every day, unseen." },
  { I: Detective, title: "VPNs That Switch Policy Off", body: "One free VPN client or browser extension, and every web rule you set quietly stops applying." },
  { I: AppWindow, title: "Apps Nobody Approved", body: "People install whatever gets the job done. IT finds out when something breaks or leaks." },
  { I: AirplaneTilt, title: "Laptops Off The Office Network", body: "The office firewall protects the office. Home Wi-Fi, hotels and airports get nothing." },
];

const platform = [
  {
    kicker: "Block risky sites anywhere",
    title: "The Web Your Company Approves, On Any Network",
    body: "Every request leaves the laptop through the agent, so category and domain rules hold at home, in hotels and on hotspots.",
    points: ["Social, AI, gambling and custom lists", "Every visit logged to the person", "No appliance or VPN to route through"],
    href: "/platform/web-gateway",
    Visual: WebGatewayVisual,
  },
  {
    kicker: "See what leaves",
    title: "Know Exactly What Left The Building",
    body: "Uploads, messages and email to Gmail, Teams, ChatGPT and any other site are read inside, including PDFs and photographed pages.",
    points: ["Card numbers, PAN, bank details, API keys", "AI spots salary sheets and contracts", "Monitor-only: work is never blocked"],
    href: "/platform/data-loss-prevention",
    Visual: DlpVisual,
  },
  {
    kicker: "Stop the workarounds",
    title: "No Unapproved Apps. No VPN Loopholes.",
    body: "Block desktop apps by name or from what is installed, while VPN clients, downloads and extensions stay blocked by default.",
    points: ["Installed-app inventory per device", "VPNs blocked with zero setup", "One switch per app"],
    href: "/platform/application-control",
    Visual: AppControlVisual,
  },
  {
    kicker: "Keep every laptop healthy",
    title: "Healthy Devices, Clean Downloads",
    body: "Posture checks run on every device, and downloads are scanned for malware before they finish landing on disk.",
    points: ["Encryption, firewall, antivirus, patches", "Malware scored and stopped in transit", "Gaps listed by device and owner"],
    href: "/platform/device-posture",
    Visual: PostureVisual,
  },
];

const tour: ConsoleScreen[] = [
  { id: "overview", label: "Security overview", title: "Your whole company on one screen", body: "Devices online, employee coverage, laptops that need a fix and incidents by control, refreshed every minute.", shot: shots.overview, callouts: ["23 of 24 devices online", "Incidents by control"] },
  { id: "dlp", label: "Data loss prevention", title: "Every sensitive upload, with the file and the person", body: "Who sent what, to which site or app, which detectors fired and the risk score.", shot: shots.dlp, callouts: ["Who, what and where", "Risk score per finding"] },
  { id: "web", label: "Web gateway", title: "Policies you can read and test", body: "Category and domain policies, with a URL checker that tests any address against them.", shot: shots.urlChecker, callouts: ["Test any address", "Blocked by category"] },
  { id: "apps", label: "Application control", title: "Every installed app, every device", body: "An inventory across macOS, Windows and Linux with one switch to block each app.", shot: shots.applications, callouts: ["Inventory per device", "One switch to block"] },
  { id: "activity", label: "Activity feed", title: "One feed for every control", body: "Blocked and alerted events from web, DLP, apps, downloads and posture, searchable by person.", shot: shots.activity, callouts: ["Every control, one feed", "Filter by person"] },
];

const stats = [
  { value: "1", label: "Agent On Every Device" },
  { value: "7", label: "Security Controls" },
  { value: "0", label: "Appliances To Rack" },
];

const steps = [
  { title: "Install The Agent", body: "Employees enroll their own laptop from a link. Native installers for macOS, Windows and Linux." },
  { title: "Set Policy Once", body: "Pick web categories, apps to block and data to watch. Devices pull the signed policy and enforce it locally." },
  { title: "See Every Decision", body: "Blocked sites, flagged uploads, stopped downloads and posture gaps arrive live, tied to the person and device." },
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
      <JsonLd data={faqLd(OBJECTIONS)} />

      <div>
        <GridFrame>
          {/* 1. Hero */}
          <GridRow className="overflow-hidden">
            {/* At least one screen tall (between 720px and 900px) so the copy has room to breathe. */}
            <div className="relative min-h-[680px] md:min-h-[clamp(720px,calc(100dvh-64px),900px)]">
              {/* The terrain stays in the lower right, clear of the copy. */}
              <div className="absolute inset-x-0 bottom-0 h-[30%] md:left-[30%] md:h-[52%]">
                <DitherField variant="hero" />
              </div>
              <div className="relative z-10 px-5 pt-16 sm:px-8 md:px-12 md:pt-24 xl:pt-28">
                {/* The category leads the H1, so search and ad visitors (and search engines) know what this is. */}
                <h1 className="enter max-w-[15ch] text-[2.75rem] font-normal leading-[1.02] tracking-[-0.04em] text-fg sm:text-[4rem] lg:max-w-[17ch] lg:text-[4.75rem] xl:text-[5.25rem]">
                  <H1Kicker>Endpoint security · Web filtering · DLP · App &amp; VPN control</H1Kicker>
                  Every laptop <span className="text-brand">deserves</span> the same security <span className="text-brand">as the office.</span>
                </h1>
                <Enter delay={0.15}>
                  <p className="mt-8 max-w-[40ch] text-base leading-relaxed text-fg-2 md:text-[17px]">
                    Enforce web, data and app policy on every device, on any network, and see everything it blocks.
                  </p>
                </Enter>
                <Enter delay={0.25} className="mt-10">
                  <div id="hero-cta" className="flex flex-wrap gap-3">
                    <GridButton href="/contact">{CTA.demo}</GridButton>
                    <GridButton href="/product-tour" variant="ghost" icon={PlayCircle}>View the tour</GridButton>
                  </div>
                  <Reassurance className="mt-6" />
                </Enter>
              </div>
              {/* Beside the copy only from 1280px; on narrower screens it sits below, so they never collide. */}
              <Enter delay={0.4} className="relative z-10 mt-14 px-5 pb-12 sm:px-8 md:px-12 lg:ml-auto lg:w-[460px] xl:absolute xl:bottom-16 xl:right-12 xl:mt-0 xl:w-[400px] xl:p-0">
                <AgentTag className="-top-9 left-6 hidden xl:flex">Aavishield agent</AgentTag>
                <LiveFeed />
              </Enter>
            </div>
          </GridRow>

          {/* 2. Coverage */}
          <GridRow>
            <div className="border-b border-line px-5 py-4 sm:px-8 md:px-12">
              <Label>Works with the tools your team already uses</Label>
            </div>
            {/* Two copies of the list scroll as one strip; the second is hidden from assistive tech. */}
            <div className="group overflow-hidden py-8 [mask-image:linear-gradient(90deg,transparent,#000_8%,#000_92%,transparent)]">
              <div className="flex w-max animate-marquee group-hover:[animation-play-state:paused]">
                {[0, 1].map((copy) => (
                  <ul key={copy} aria-hidden={copy === 1} className="flex shrink-0 items-center gap-16 pr-16">
                    {coverage.map(({ I, name }) => (
                      <li key={name} className="flex items-center gap-2 whitespace-nowrap text-fg">
                        <I size={26} weight="fill" />
                        <span className="font-display text-lg font-bold tracking-[-0.02em]">{name}</span>
                      </li>
                    ))}
                  </ul>
                ))}
              </div>
            </div>
          </GridRow>

          {/* 3. The problem */}
          <GridRow>
            <div className="grid gap-10 px-5 py-16 sm:px-8 md:grid-cols-[0.85fr_1.15fr] md:gap-16 md:px-12 md:py-20">
              <GridHeading
                label="The problem"
                title="What Keeps IT Teams Up At Night"
                body="Companies set web, data and app rules on the office network. Then everyone took their laptop home."
              />
              <ol>
                {problems.map(({ I, title, body }, i) => (
                  <li key={title} className="border-b border-line first:pt-0 last:border-b-0">
                    <Reveal delay={i * 0.05} className="grid grid-cols-[2.5rem_1fr_auto] items-start gap-4 py-6">
                      <span className="font-mono text-[15px] text-brand-ink">{String(i + 1).padStart(2, "0")}</span>
                      <div>
                        <h3 className="text-lg font-normal tracking-[-0.015em] text-fg">{title}</h3>
                        <p className="mt-2 max-w-[44ch] text-sm leading-relaxed text-muted">{body}</p>
                      </div>
                      <span className="grid size-8 place-items-center rounded-[4px] border border-brand/30 bg-brand-soft text-brand-ink">
                        <I size={16} />
                      </span>
                    </Reveal>
                  </li>
                ))}
              </ol>
            </div>
          </GridRow>

          {/* 4. The platform: one row per control, each with a product visual */}
          <GridRow>
            <div className="border-b border-line px-5 py-16 sm:px-8 md:px-12 md:py-20">
              <GridHeading
                label="Our solution"
                title="Layered Protection For Every Device"
                body="From the websites people open to the files they upload, one agent covers every route data can take off a laptop."
              />
            </div>
            {platform.map((p, i) => (
              <div key={p.title} className={`grid grid-cols-1 border-line md:grid-cols-2 ${i < platform.length - 1 ? "border-b" : ""}`}>
                <Reveal className={`flex flex-col px-5 py-12 sm:px-8 md:px-12 md:py-16 ${i % 2 ? "md:order-2" : ""}`}>
                  <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-fg">
                    <span className="text-brand-ink">{String(i + 1).padStart(2, "0")}</span>&nbsp;&nbsp;{p.kicker}
                  </span>
                  <h3 className="mt-5 max-w-[18ch] text-[1.9rem] font-normal leading-[1.08] tracking-[-0.03em] text-fg md:text-[2.25rem]">{p.title}</h3>
                  <p className="mt-4 max-w-[42ch] text-[15px] leading-relaxed text-muted">{p.body}</p>
                  <ul className="mt-6 grid gap-2">
                    {p.points.map((pt) => (
                      <li key={pt} className="flex items-center gap-2.5 text-sm text-fg-2">
                        <span className="size-1.5 bg-brand" />
                        {pt}
                      </li>
                    ))}
                  </ul>
                  <Link href={p.href} className="mt-auto w-fit pt-10 font-mono text-[11px] uppercase tracking-[0.1em] text-fg underline decoration-fg/40 underline-offset-4 hover:text-brand-ink">
                    Learn more
                  </Link>
                </Reveal>
                <Reveal delay={0.1} className={`border-line p-4 sm:p-6 md:p-8 ${i % 2 ? "md:order-1 md:border-r" : "md:border-l"}`}>
                  <p.Visual />
                </Reveal>
              </div>
            ))}
          </GridRow>

          {/* 4b. Mid-page call to action, after the product has been shown */}
          <GridRow>
            <MidCta title="See It On Your Own Laptops" body="Start with a small pilot group before rolling out. A pilot can be live in an afternoon." />
          </GridRow>

          {/* 5. Numbers */}
          <GridRow>
            <div className="grid sm:grid-cols-3">
              {stats.map((s, i) => (
                <Reveal key={s.label} delay={i * 0.06} className={`border-line px-5 py-10 sm:px-8 md:px-12 md:py-14 ${i < 2 ? "border-b sm:border-b-0 sm:border-r" : ""}`}>
                  <p className="font-mono text-[4.5rem] leading-none tracking-[-0.04em] text-fg md:text-[5.5rem]">{s.value}</p>
                  <p className="mt-4 text-sm text-muted">{s.label}</p>
                </Reveal>
              ))}
            </div>
          </GridRow>

          {/* 5b. Inside the console: real screenshots */}
          <GridRow>
            <div className="px-5 pt-16 sm:px-8 md:px-12 md:pt-20">
              <GridHeading
                label="Inside the console"
                title="Every Decision, In One Place"
                body="Every screen here is the real Aavishield console, captured with demo data. No mock-ups."
              />
            </div>
            <div className="px-5 pb-16 pt-10 sm:px-8 md:px-12 md:pb-20">
              <ConsoleShowcase screens={tour} />
            </div>
          </GridRow>

          {/* 6. Why companies choose us */}
          <GridRow>
            <div className="px-5 py-16 sm:px-8 md:px-12 md:pb-12 md:pt-20">
              <GridHeading
                label="Why Aavishield"
                title="Why Companies Choose Us"
                body="Enforcement runs on the laptop, not on a box in the server room, so policy is on wherever the laptop is open."
              />
            </div>
            <WhyGrid />
          </GridRow>

          {/* 6b. Trust: how the product protects customer data */}
          <GridRow>
            <TrustSection />
          </GridRow>

          {/* 7. How it works */}
          <GridRow>
            <div className="px-5 pt-16 sm:px-8 md:px-12 md:pt-20">
              <GridHeading label="How it works" title="Three Steps To Protection, Zero Workflow Disruption" />
            </div>
            <Reveal className="mx-5 mt-10 sm:mx-8 md:mx-12">
              <PixelPanel className="px-10 py-10">
                <FlowDiagram />
              </PixelPanel>
            </Reveal>
            <Stagger className="grid px-5 pb-16 pt-12 sm:px-8 md:grid-cols-3 md:px-12 md:pb-20">
              {steps.map((s, i) => (
                <StaggerItem key={s.title} className={`border-line py-6 md:py-0 ${i > 0 ? "border-t md:border-l md:border-t-0 md:pl-8" : ""} ${i < 2 ? "md:pr-8" : ""}`}>
                  <span className="grid size-8 place-items-center rounded-[4px] bg-brand font-mono text-[12px] text-on-brand">{String(i + 1).padStart(2, "0")}</span>
                  <h3 className="mt-6 text-lg font-normal tracking-[-0.015em] text-fg">{s.title}</h3>
                  <p className="mt-2 max-w-[36ch] text-sm leading-relaxed text-muted">{s.body}</p>
                </StaggerItem>
              ))}
            </Stagger>
          </GridRow>

          {/* 7b. Early access, then the questions buyers ask before a pilot */}
          <GridRow>
            <EarlyAccess />
          </GridRow>
          <GridRow>
            <Objections />
          </GridRow>

          {/* 8. Closing call to action */}
          <GridRow className="overflow-hidden">
            <div className="relative min-h-[520px] md:min-h-[600px]">
              <div className="absolute inset-x-0 bottom-0 h-[62%]">
                <DitherField variant="band" />
              </div>
              <div className="relative z-10 px-5 pt-14 sm:px-8 md:px-12 md:pt-20">
                <Reveal>
                  <h2 className="max-w-[16ch] text-[2.75rem] font-normal leading-[1] tracking-[-0.045em] text-fg md:text-[5.25rem]">
                    See What Every Laptop Is Really Doing
                  </h2>
                </Reveal>
              </div>
              <div className="absolute inset-x-0 bottom-0 z-10 px-5 pb-12 sm:px-8 md:px-12 md:pb-16">
                <Reveal>
                  <p className="max-w-[40ch] text-[15px] leading-relaxed text-fg-2">
                    Install the agent, choose a policy, and see every decision in one console. A pilot can be live in an afternoon.
                  </p>
                  <div className="mt-6 flex flex-wrap gap-3">
                    <GridButton href="/contact">{CTA.demo}</GridButton>
                    <GridButton href="/pricing" variant="ghost">See pricing</GridButton>
                  </div>
                  <Reassurance className="mt-5" />
                  <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.08em] text-muted">Priced per device, billed annually</p>
                </Reveal>
              </div>
            </div>
          </GridRow>
        </GridFrame>
      </div>
      <StickyCta />
    </>
  );
}
