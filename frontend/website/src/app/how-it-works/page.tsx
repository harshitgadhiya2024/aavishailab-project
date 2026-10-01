import type { Metadata } from "next";
import { Cloud, Laptop } from "@phosphor-icons/react/dist/ssr";
import { Architecture } from "@/components/architecture";
import { CardGrid, FaqSection, FeatureSplit } from "@/components/blocks";
import { Button } from "@/components/button";
import { CtaBand } from "@/components/cta-band";
import { Reveal, Stagger, StaggerItem } from "@/components/motion/reveal";
import { PageHero } from "@/components/page-hero";
import { ParallaxImage } from "@/components/parallax-image";
import { Section, SectionHead } from "@/components/section";
import { CTA } from "@/lib/content";
import { JsonLd, SITE_URL, breadcrumbLd, faqLd } from "@/lib/seo";
import { shots } from "@/lib/shots";

export const metadata: Metadata = {
  title: "How Aavishield Works: From Install to First Event in an Afternoon",
  description: "How Aavishield is deployed: create your organisation, add employees, install the agent on macOS, Windows or Linux, set policy and watch events arrive.",
  alternates: { canonical: "/how-it-works" },
  openGraph: { url: "/how-it-works" },
};

const timeline = [
  { n: "01", t: "Create your organisation", b: "Sign up, verify your email and set up two-factor sign-in." },
  { n: "02", t: "Add your people", b: "Import employees from CSV or add them one by one, then group them into teams." },
  { n: "03", t: "Install the agent", b: "Employees download a native installer from their portal. The device enrolls itself." },
  { n: "04", t: "Switch on policy", b: "Choose categories, apps and data to watch. Devices pull the signed policy." },
  { n: "05", t: "Watch and refine", b: "Events arrive within minutes. Tune policy from what you actually see." },
];

const onDevice = [
  "Local HTTPS proxy that applies web policy",
  "Application and VPN blocking",
  "Download streaming to the malware scanner",
  "Upload inspection hand-off for DLP",
  "Posture checks from the operating system",
  "Screenshots, only on monitored devices",
];
const inCloud = [
  "Admin console and employee portal",
  "Policy signing with Ed25519",
  "DLP content scanning and AI classification",
  "Malware scoring and threat intelligence",
  "Event storage, reports and alerts",
  "Short-lived signed links for media",
];

const plan = [
  { title: "Day 1: pilot", body: "Enroll five to ten devices, including IT's own. Turn on DLP and the obvious web categories." },
  { title: "Week 1: learn", body: "Review real findings. Talk to the teams most affected before tightening anything." },
  { title: "Week 2: announce", body: "Tell employees what Aavishield does and why. Share your acceptable use policy." },
  { title: "Week 3: roll out", body: "Send the enrollment link to everyone. Track coverage on the overview." },
];

const reqs = [
  { title: "Supported systems", body: "Recent versions of macOS, Windows 10 and 11, and Ubuntu, Debian or Fedora Linux." },
  { title: "Install rights", body: "The installer needs administrator rights once, to set up the agent." },
  { title: "Internet access", body: "Devices need to reach the Aavishield service to pull policy and send events." },
  { title: "No hardware", body: "No appliances, network changes or VPN concentrators." },
];

const faq = [
  { q: "How long does rollout take?", a: "A pilot can be live in an afternoon. Most companies roll out to everyone within two to three weeks, mostly spent communicating with employees." },
  { q: "Does the agent update itself?", a: "Yes. Native installers support automatic updates, so you do not need to reinstall." },
  { q: "What if a device goes offline?", a: "It keeps enforcing the last signed policy it received, and reports events when it reconnects." },
  { q: "Can an employee remove the agent?", a: "Uninstalling requires admin approval, and the uninstall is recorded in the console." },
];

export default function HowItWorksPage() {
  return (
    <>
      <JsonLd data={breadcrumbLd([{ name: "Home", path: "" }, { name: "How it works", path: "/how-it-works" }])} />
      <JsonLd data={faqLd(faq)} />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "HowTo",
          name: "Deploy Aavishield endpoint security",
          url: `${SITE_URL}/how-it-works`,
          step: timeline.map((t, i) => ({ "@type": "HowToStep", position: i + 1, name: t.t, text: t.b })),
        }}
      />

      {/* 1. Hero */}
      <PageHero eyebrow="How it works" accent={["afternoon."]} title="From install to first event in an afternoon." body="No appliances, no network changes, no consultants. Here is exactly how Aavishield goes from sign-up to protecting every device.">
        <Button href="/contact" size="lg">{CTA.demo}</Button>
      </PageHero>

      {/* 2. Timeline */}
      <section className="mx-auto max-w-6xl px-4 md:px-6">
        <Stagger className="grid gap-px overflow-hidden rounded-[20px] border border-line bg-line md:grid-cols-5">
          {timeline.map((t) => (
            <StaggerItem key={t.n} className="bg-bg p-6">
              <span className="font-mono text-sm text-brand-ink">{t.n}</span>
              <h2 className="mt-4 text-lg font-semibold text-fg">{t.t}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">{t.b}</p>
            </StaggerItem>
          ))}
        </Stagger>
      </section>

      {/* 3. Step by step */}
      <Section>
        <SectionHead eyebrow="Step by step" title="What each step looks like." />
        <div className="mt-16 grid gap-24">
          <FeatureSplit eyebrow="Step 1" title="Create your organisation" body="Register your company, verify your email and sign in with a second factor. You land on an overview that tells you exactly what to do next." points={["Email verification", "Emailed code or authenticator app", "Guided first steps"]} shot={shots.login} />
          <FeatureSplit eyebrow="Step 2" title="Add your people" body="Import a CSV or add employees by hand. Put them in teams so policy can be targeted later." points={["CSV import and export", "Departments and titles", "Teams for targeting"]} shot={shots.employees} reverse />
          <FeatureSplit eyebrow="Step 3" title="Employees install the agent" body="Each employee signs in to their portal and downloads the installer for their operating system. The device enrolls to your organisation automatically." points={["macOS, Windows and Linux", "No IT visit needed", "Enrolled in minutes"]} shot={shots.portalDownload} />
          <FeatureSplit eyebrow="Step 4" title="Switch on policy" body="Pick the web categories to block, the apps to stop and let DLP watch for sensitive data. The policy is signed and pulled by every device." points={["27 web categories", "Per-app block switches", "DLP on by default"]} shot={shots.categories} reverse />
          <FeatureSplit eyebrow="Step 5" title="Watch the first events arrive" body="Blocks, alerts and posture issues show up on the overview within minutes, tied to the person and the device." points={["Live activity feed", "Needs-attention list", "Email alerts for high risk"]} shot={shots.overview} />
        </div>
      </Section>

      {/* 4. Architecture */}
      <Section>
        <SectionHead eyebrow="Under the hood" title="How the agent and the cloud work together." accent={["together."]} />
        <div className="mt-16"><Architecture /></div>
      </Section>

      {/* 5. Device vs cloud */}
      <Section>
        <div className="grid gap-4 md:grid-cols-2">
          <Reveal className="rounded-[20px] border border-line bg-surface p-8">
            <Laptop size={30} weight="light" className="text-brand-ink" />
            <h3 className="mt-5 text-xl font-semibold text-fg">On the device</h3>
            <ul className="mt-5 grid gap-3">
              {onDevice.map((x) => <li key={x} className="flex gap-3 text-muted"><span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-brand" />{x}</li>)}
            </ul>
          </Reveal>
          <Reveal delay={0.1} className="ink-edge rounded-[20px] bg-ink p-8 text-ink-fg">
            <Cloud size={30} weight="light" className="text-brand" />
            <h3 className="mt-5 text-xl font-semibold">In the Aavishield cloud</h3>
            <ul className="mt-5 grid gap-3">
              {inCloud.map((x) => <li key={x} className="flex gap-3 opacity-80"><span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-brand" />{x}</li>)}
            </ul>
          </Reveal>
        </div>
      </Section>

      {/* 6. Image */}
      <Section wide>
        <ParallaxImage src="/images/company-team.webp" alt="A team collaborating around a large table in a minimal studio office" sizes="(max-width: 1400px) 100vw, 1400px" aspect="aspect-[4/3] sm:aspect-[21/9]" />
      </Section>

      {/* 7. Rollout plan */}
      <Section>
        <SectionHead eyebrow="Rollout plan" title="A rollout your employees will accept." accent={["accept."]} body="Technology is the easy part. This is the plan we recommend to keep trust high." />
        <div className="mt-12"><CardGrid items={plan} cols={4} /></div>
      </Section>

      {/* 8. Requirements */}
      <Section>
        <SectionHead eyebrow="Requirements" title="What you need to get started." />
        <div className="mt-12"><CardGrid items={reqs} cols={4} /></div>
      </Section>

      {/* 9. FAQ */}
      <FaqSection title="Deployment questions" items={faq} />

      <CtaBand />
    </>
  );
}
