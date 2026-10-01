import type { Metadata } from "next";
import { FeatureSplit } from "@/components/blocks";
import { BrowserFrame } from "@/components/browser-frame";
import { Button } from "@/components/button";
import { CtaBand } from "@/components/cta-band";
import { Reveal } from "@/components/motion/reveal";
import { PageHero } from "@/components/page-hero";
import { ScrollTilt } from "@/components/scroll-tilt";
import { Section, SectionHead } from "@/components/section";
import { CTA } from "@/lib/content";
import { JsonLd, SITE_URL, breadcrumbLd } from "@/lib/seo";
import { type ShotKey, shots } from "@/lib/shots";

export const metadata: Metadata = {
  title: "Product Tour: The Aavishield Console, Screen by Screen",
  description: "Walk through the real Aavishield console: security overview, data loss prevention, web gateway, application control, activity, monitoring, reports and the employee portal.",
  alternates: { canonical: "/product-tour" },
  openGraph: { url: "/product-tour" },
};

type Stop = { shot: ShotKey; title: string; body: string; points: string[]; crop?: { x: number; y: number; scale: number } };
const chapters: { id: string; label: string; title: string; body: string; stops: Stop[] }[] = [
  {
    id: "protect",
    label: "Protect",
    title: "Set the policy once.",
    body: "Web categories, custom domains, blocked applications and data detection, all from one place.",
    stops: [
      { shot: "webGateway", title: "Web gateway policies", body: "Each policy shows what it matches, the action, who it applies to and whether it is enabled. Counts of blocked and logged requests sit above.", points: ["Category and domain policies", "Everyone, a team or one person", "Edit, pause or delete"] },
      { shot: "urlChecker", title: "URL checker", body: "Type any address to see what would happen to it and which policy decides, before an employee asks.", points: ["Instant verdict", "Names the matching policy", "Handy for support questions"], crop: { x: 0, y: 12, scale: 1.55 } },
      { shot: "categories", title: "Policy categories", body: "27 ready-made categories with their risk level and domain count. Add your own domains or hide categories you never use.", points: ["AI tools, social, gambling, VPN and more", "Custom domains per category", "Risk levels at a glance"] },
      { shot: "applications", title: "Application control", body: "Every installed application across the fleet, with a network block and an app block switch for each.", points: ["macOS, Windows and Linux", "Filter by employee or category", "Scope rules to one person"] },
    ],
  },
  {
    id: "detect",
    label: "Detect",
    title: "See what actually happens.",
    body: "Sensitive data leaving, malicious downloads stopped and devices drifting out of compliance.",
    stops: [
      { shot: "dlp", title: "Data loss prevention", body: "Each incident shows the employee, browser or app, destination, file or text, the detectors that matched and a risk score.", points: ["Monitor-only, never blocks", "OCR on images and scans", "Search by destination or file"] },
      { shot: "activityDownloads", title: "Blocked downloads", body: "Malicious files stopped in flight, with the source domain, signature and risk score.", points: ["Trojans, phishing pages, macros", "Scored from 0 to 100", "Admin email alerts"] },
      { shot: "activityPosture", title: "Posture alerts", body: "Devices with the firewall off, updates pending or encryption disabled, with plain-language fixes.", points: ["Encryption, firewall, updates", "Screen lock and antivirus", "Fix instructions per OS"] },
    ],
  },
  {
    id: "observe",
    label: "Observe",
    title: "One feed, one overview.",
    body: "Everything the agents report, together, with the context to act.",
    stops: [
      { shot: "overview", title: "Security overview", body: "Protection status, incidents by control and a needs-attention list, for any date range.", points: ["Compared with the previous period", "Refreshes every minute", "Click through to detail"] },
      { shot: "overviewScroll", title: "Incidents over time", body: "A daily chart of incidents per control and the open items that need someone's attention.", points: ["Spot spikes quickly", "Every control, stacked", "Needs-attention list"] },
      { shot: "activity", title: "Activity feed", body: "Every blocked and alerted event from every control, filterable by source, time and outcome.", points: ["Web, DLP, apps, downloads, posture, devices", "24 hours to 30 days", "Blocked, alerted, incidents"] },
      { shot: "screenshots", title: "Activity monitoring", body: "For monitored devices: tracked and active time, a colour-coded timeline, work sessions and periodic screenshots.", points: ["Opt-in per device", "Blur and retention settings", "Permission-based deletion"] },
    ],
  },
  {
    id: "people",
    label: "People and devices",
    title: "Know every person and device.",
    body: "The directory behind every policy and every finding.",
    stops: [
      { shot: "employees", title: "Employees", body: "Every employee with department, title, status and devices. Import or export by CSV.", points: ["CSV import and export", "Filter by status, team, department", "Per-person detail"] },
      { shot: "teams", title: "Teams", body: "Teams group people for policy targeting and reporting.", points: ["Colour-coded teams", "Member counts", "Use in any policy"] },
      { shot: "devices", title: "Devices", body: "Every enrolled device with OS, agent version, status, ownership, enforcement and posture score.", points: ["Online and offline status", "Company or personal ownership", "Revoke in one click"] },
    ],
  },
  {
    id: "report",
    label: "Report",
    title: "Evidence on demand.",
    body: "Reports for leadership, clients and auditors, exported in the format they want.",
    stops: [
      { shot: "reports", title: "Executive summary", body: "Incidents, devices protected, coverage and open items, with an AI briefing and a chart of incidents by control.", points: ["Any period", "AI-written briefing", "PDF, Excel, CSV"] },
      { shot: "reportsCompliance", title: "Device compliance", body: "Each device, its owner, state, check-ins and settings that are off, ready for auditors.", points: ["Searchable table", "Sorted by risk", "Export in one click"] },
      { shot: "reportsRisk", title: "Employee risk", body: "Employees ranked by incidents across every control.", points: ["Spot repeat behaviour", "Target coaching", "Compare periods"] },
    ],
  },
  {
    id: "admin",
    label: "Admin",
    title: "Run it without a security team.",
    body: "The tools that make Aavishield easy for one person to operate.",
    stops: [
      { shot: "ai", title: "Assistant", body: "Ask what needs attention, which devices are offline or who had the most incidents. Answers come from live data.", points: ["Read-only", "Suggested questions", "Exports reports on request"] },
      { shot: "accessRequests", title: "Access requests", body: "Employees ask to unblock a domain with a reason. Review and decide.", points: ["Reason with every request", "Policy shown", "Pending and history"] },
      { shot: "settings", title: "Settings", body: "Password, two-factor, notifications, working hours, monitoring, block page, organisation security and sessions.", points: ["Require 2FA for everyone", "Custom block page", "Signed-in sessions"] },
    ],
  },
  {
    id: "portal",
    label: "Employee portal",
    title: "A portal for your people.",
    body: "Employees install the agent, see their devices and understand what was blocked.",
    stops: [
      { shot: "portalLogin", title: "Employee sign-in", body: "Employees activate their own account with their work email.", points: ["Self-service activation", "Password reset", "Privacy notice"] },
      { shot: "portalDownload", title: "Download the agent", body: "Native installers for macOS, Windows and Linux. No technical knowledge needed.", points: ["One-click installers", "Auto-enrollment", "Automatic updates"] },
    ],
  },
];

export default function ProductTourPage() {
  return (
    <>
      <JsonLd data={breadcrumbLd([{ name: "Home", path: "" }, { name: "Product tour", path: "/product-tour" }])} />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "ImageGallery",
          name: "Aavishield console screenshots",
          url: `${SITE_URL}/product-tour`,
          image: chapters.flatMap((c) => c.stops.map((s) => ({ "@type": "ImageObject", contentUrl: `${SITE_URL}${shots[s.shot].src}`, caption: s.title }))),
        }}
      />

      <PageHero eyebrow="Product tour" accent={["screen."]} title="The whole console, screen by screen." body="No mock-ups and no slides. Every image here is the real Aavishield console, captured with demo data from a fictional company." aside={false}>
        <Button href="#protect" size="lg">Start the tour</Button>
        <Button href="/contact" size="lg" variant="ghost">{CTA.demo}</Button>
      </PageHero>

      <section className="mx-auto max-w-6xl px-4 md:px-6">
        <ScrollTilt>
          <BrowserFrame shot={shots.overview} priority sizes="(max-width: 1200px) 100vw, 1150px" />
        </ScrollTilt>
      </section>

      {/* Chapter index */}
      <nav aria-label="Tour chapters" className="sticky top-[76px] z-30 mx-auto mt-16 max-w-6xl px-4 md:top-[84px] md:px-6">
        <ul className="glass flex gap-1 overflow-x-auto rounded-full p-1 [scrollbar-width:none]">
          {chapters.map((c, i) => (
            <li key={c.id} className="shrink-0">
              <a href={`#${c.id}`} className="block rounded-full px-4 py-2 text-sm text-muted transition-colors hover:bg-bg-2 hover:text-fg">
                <span className="mr-1.5 font-mono text-xs text-brand-ink">0{i + 1}</span>
                {c.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {chapters.map((c, ci) => (
        <Section key={c.id} id={c.id}>
          <SectionHead eyebrow={`Chapter 0${ci + 1} · ${c.label}`} title={c.title} body={c.body} />
          <div className="mt-16 grid gap-24">
            {c.stops.map((s, i) => (
              <FeatureSplit key={s.title} title={s.title} body={s.body} points={s.points} shot={shots[s.shot]} crop={s.crop} reverse={i % 2 === 1} />
            ))}
          </div>
        </Section>
      ))}

      {/* Dark mode gallery */}
      <Section>
        <SectionHead center eyebrow="Dark mode" title="Every screen, in dark mode too." accent={["dark"]} />
        <div className="mt-12 grid gap-4 md:grid-cols-2">
          {(["overviewDark", "dlpDark", "activityDark", "screenshotsDark"] as const).map((k, i) => (
            <Reveal key={k} delay={(i % 2) * 0.08} className="min-w-0">
              <BrowserFrame shot={shots[k]} sizes="(max-width: 768px) 100vw, 560px" />
            </Reveal>
          ))}
        </div>
      </Section>

      <CtaBand title="Now see it with your own devices." />
    </>
  );
}
