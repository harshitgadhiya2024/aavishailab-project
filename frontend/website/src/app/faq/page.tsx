import type { Metadata } from "next";
import Link from "next/link";
import { Faq } from "@/components/faq";
import { Button } from "@/components/button";
import { CtaBand } from "@/components/cta-band";
import { Reveal } from "@/components/motion/reveal";
import { PageHero } from "@/components/page-hero";
import { Section, SectionHead } from "@/components/section";
import { CTA } from "@/lib/content";
import { JsonLd, breadcrumbLd, faqLd } from "@/lib/seo";

export const metadata: Metadata = {
  title: "FAQ: Aavishield Endpoint Security Questions Answered",
  description: "Answers about Aavishield deployment, supported operating systems, data loss prevention, web filtering, monitoring, privacy, security and pricing.",
  alternates: { canonical: "/faq" },
  openGraph: { url: "/faq" },
};

const groups: { id: string; title: string; items: { q: string; a: string }[] }[] = [
  {
    id: "general",
    title: "General",
    items: [
      { q: "What is Aavishield?", a: "Endpoint security for companies. One agent on each laptop enforces web filtering, data loss prevention, application control, VPN blocking, malware scanning, device posture and optional activity monitoring, managed from one console." },
      { q: "Who makes Aavishield?", a: "Aavishield is built by Aavish AI Lab." },
      { q: "Who is it for?", a: "Companies of any size, and especially those without a dedicated security team, that need to protect data on laptops used at home, in the office and on the road." },
      { q: "Which operating systems are supported?", a: "macOS, Windows and Linux, with the same agent and the same policy on all three." },
    ],
  },
  {
    id: "deployment",
    title: "Deployment",
    items: [
      { q: "How long does it take to get started?", a: "A pilot can be live in an afternoon. A company-wide rollout typically takes two to three weeks." },
      { q: "How do employees install the agent?", a: "They sign in to the employee portal and download a native installer for their system. The device enrolls automatically." },
      { q: "Do we need an appliance, VPN or network change?", a: "No. Enforcement happens on the device." },
      { q: "Does the agent update automatically?", a: "Yes. Native installers support automatic updates." },
      { q: "What happens when a device is offline?", a: "It keeps enforcing the last signed policy and reports events when it reconnects." },
    ],
  },
  {
    id: "dlp",
    title: "Data loss prevention",
    items: [
      { q: "Does DLP block uploads?", a: "No. DLP is monitor-only. It records what sensitive data left and where, without interrupting work." },
      { q: "Which destinations are covered?", a: "Any website or desktop app sending data over the network, including Gmail, Outlook, Teams, OneDrive, WhatsApp Web, ChatGPT, Claude and Gemini." },
      { q: "What does it detect?", a: "Card numbers, PAN, Aadhaar, GST and bank details, API keys, tokens, database URLs, source code, and documents such as salary sheets, contracts and ID scans via AI classification." },
      { q: "Can it read images and scanned PDFs?", a: "Yes. Images and scans are read with OCR before classification." },
    ],
  },
  {
    id: "web-apps",
    title: "Web, apps and VPNs",
    items: [
      { q: "How does web filtering work?", a: "The agent applies your category and domain policy to every request on the device, in every browser and on any network." },
      { q: "Can I test a URL before it is visited?", a: "Yes. The URL checker in the console shows what would happen and which policy decides." },
      { q: "Can I block a desktop application?", a: "Yes. Block it by name or from the inventory, for everyone or one person, with a network block or an app block." },
      { q: "Are VPNs blocked by default?", a: "Yes. VPN clients, installers, proxy sites and known extensions are blocked on every enrolled device." },
    ],
  },
  {
    id: "monitoring",
    title: "Monitoring and privacy",
    items: [
      { q: "Is every employee screen-recorded?", a: "No. Aavishield takes periodic screenshots, not recordings, and only on devices your organisation chooses to monitor." },
      { q: "Can screenshots be blurred?", a: "Yes. Screenshot settings include interval, idle threshold, blur and retention." },
      { q: "Who can see the data?", a: "Only authorised admins of your organisation. Data is never shared across organisations or sold." },
      { q: "Do employees know Aavishield is installed?", a: "They install it themselves from the portal, and our acceptable use policy requires you to tell them what is monitored." },
    ],
  },
  {
    id: "security",
    title: "Security",
    items: [
      { q: "How do you protect the policy?", a: "Policy bundles are signed with Ed25519 and verified on the device before they are enforced." },
      { q: "How is sign-in protected?", a: "Every sign-in needs a second factor: an emailed one-time code or an authenticator app. Organisations can require app-based two-factor." },
      { q: "How are screenshots and files served?", a: "Only through short-lived signed links, to admins of the same organisation." },
    ],
  },
  {
    id: "billing",
    title: "Pricing and billing",
    items: [
      { q: "How is Aavishield priced?", a: "Per enrolled device, billed annually. Book a demo for a quote." },
      { q: "Can we start with a pilot?", a: "Yes. Most customers start with a small pilot group before rolling out." },
      { q: "Can we cancel?", a: "Yes. Cancellation stops renewal and the service continues to the end of the paid term. See our refund and cancellation policy." },
    ],
  },
];

export default function FaqPage() {
  return (
    <>
      <JsonLd data={breadcrumbLd([{ name: "Home", path: "" }, { name: "FAQ", path: "/faq" }])} />
      <JsonLd data={faqLd(groups.flatMap((g) => g.items))} />

      <PageHero eyebrow="FAQ" accent={["answers."]} title="Straight answers." body="Everything people ask us before, during and after rolling out Aavishield. Missing something? Ask us directly." aside={false}>
        <Button href="/contact" size="lg">{CTA.demo}</Button>
      </PageHero>

      <section className="mx-auto max-w-6xl px-4 md:px-6">
        <nav aria-label="FAQ topics" className="flex flex-wrap gap-2">
          {groups.map((g) => (
            <a key={g.id} href={`#${g.id}`} className="rounded-full border border-line bg-surface px-4 py-2 text-sm text-fg-2 transition-colors hover:border-brand/50 hover:text-fg">
              {g.title}
            </a>
          ))}
        </nav>
      </section>

      {groups.map((g, i) => (
        <Section key={g.id} id={g.id} className="grid gap-10 md:grid-cols-[0.8fr_1.2fr]">
          <div>
            <SectionHead eyebrow={`0${i + 1}`} title={g.title} />
          </div>
          <Reveal delay={0.1}><Faq items={g.items} /></Reveal>
        </Section>
      ))}

      <Section>
        <Reveal className="rounded-[20px] border border-line bg-surface p-8 text-center md:p-12">
          <h2 className="text-2xl font-semibold tracking-tight text-fg md:text-3xl">Still have a question?</h2>
          <p className="mx-auto mt-3 max-w-[48ch] text-muted">
            Write to <a href="mailto:info@aavishailab.com" className="font-medium text-brand-ink hover:underline">info@aavishailab.com</a> or{" "}
            <Link href="/contact" className="font-medium text-brand-ink hover:underline">book a demo</Link> and ask us live.
          </p>
        </Reveal>
      </Section>

      <CtaBand />
    </>
  );
}
