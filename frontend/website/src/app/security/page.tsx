import type { Metadata } from "next";
import { TrustHero } from "@/components/landing/hero-widgets";
import { Eye, Fingerprint, Key, LockKey, Signature, UsersThree } from "@phosphor-icons/react/dist/ssr";
import { CardGrid, FaqSection, FeatureSplit, LinkCards } from "@/components/blocks";
import { CtaBand } from "@/components/cta-band";
import { ParallaxImage } from "@/components/parallax-image";
import { Reveal } from "@/components/motion/reveal";
import { PageHero } from "@/components/page-hero";
import { Section, SectionHead } from "@/components/section";
import { legalPages } from "@/lib/legal";
import { JsonLd, breadcrumbLd, faqLd } from "@/lib/seo";
import { shots } from "@/lib/shots";

export const metadata: Metadata = {
  title: "Trust and Security: How We Protect Your Data",
  description:
    "Signed policy, monitor-only DLP, per-company isolation and two-factor sign-in: how Aavishield protects the policy it enforces and the data it sees.",
  alternates: { canonical: "/security" },
  openGraph: { url: "/security" },
};

const principles = [
  { I: Signature, title: "Signed policy", body: "Policy bundles are signed with Ed25519 and verified on the device, so an agent only ever enforces policy that came from your console." },
  { I: Eye, title: "Monitor-only DLP", body: "Data loss prevention records findings and never blocks. Security gets visibility without breaking the way people work." },
  { I: UsersThree, title: "Isolation between companies", body: "Every organisation's policy, devices and findings are scoped to that organisation and never mixed." },
  { I: Key, title: "Encrypted keys", body: "Per-organisation certificate authority keys are stored encrypted at rest." },
  { I: LockKey, title: "Signed media links", body: "Screenshots and files are served only through short-lived signed links, visible to admins of that organisation." },
  { I: Fingerprint, title: "Authenticated services", body: "Internal scanning services only accept requests carrying a shared secret, never open to the internet." },
];

const privacy = [
  { title: "Monitoring is opt-in", body: "Screenshots are off by default and enabled per device by your organisation." },
  { title: "Minimal DLP storage", body: "We keep the finding and a short masked preview, not a copy of the file." },
  { title: "Blur and retention", body: "Blur screenshots and set how long monitoring data is kept." },
  { title: "Permissioned deletion", body: "Admins with the right permission can delete sessions and screenshots." },
  { title: "Employees can see", body: "The employee portal shows people their devices and what was blocked." },
  { title: "Never sold", body: "Personal data is never sold or used for advertising." },
];

const faq = [
  { q: "Where is our data stored?", a: "In Aavishield's cloud infrastructure, scoped to your organisation. Ask us during the demo about hosting details for your region." },
  { q: "Does Aavishield decrypt HTTPS traffic?", a: "The agent runs a local HTTPS proxy with a per-organisation certificate so it can apply web policy and inspect uploads for DLP. The certificate authority key is stored encrypted, and sensitive services that break under inspection are passed through untouched." },
  { q: "Can Aavishield staff see our data?", a: "Access is restricted to what is needed to operate and support the service, and is never used for anything else." },
  { q: "How do I report a vulnerability?", a: "Email info@aavishailab.com with details. We will acknowledge your report and keep you updated while we investigate." },
];

export default function SecurityPage() {
  return (
    <>
      <JsonLd data={breadcrumbLd([{ name: "Home", path: "" }, { name: "Trust and security", path: "/security" }])} />
      <JsonLd data={faqLd(faq)} />

      {/* 1. Hero */}
      <PageHero visual={<TrustHero />} eyebrow="Trust and data security" accent={["trust"]} title="A security product has to earn trust first." body="Aavishield sees sensitive traffic on your devices. Here is how we protect the policy we enforce and the data we see." />

      {/* 2. Image */}
      <section className="grid-band p-3 sm:p-4 md:p-6">
        <ParallaxImage src="/images/security-vault.webp" alt="A heavy circular vault door slightly ajar with a thin ring of orange light around its edge" sizes="(max-width: 1400px) 100vw, 1400px" aspect="aspect-[4/3] sm:aspect-[21/9]" eager />
      </section>

      {/* 3. Principles */}
      <Section className="grid gap-12 md:grid-cols-[0.8fr_1.2fr]">
        <div className="md:sticky md:top-32 md:self-start">
          <SectionHead title="Six things we never compromise on." body="If your security team has questions beyond these, we are happy to walk through the architecture in detail." />
        </div>
        <div className="grid gap-4">
          {principles.map(({ I, title, body }, i) => (
            <Reveal key={title} delay={i * 0.04}>
              <div className="group flex gap-5 rounded-[6px] border border-line bg-surface p-6 transition-transform duration-500 ease-out-expo hover:-translate-y-1 md:p-8">
                <span className="grid size-12 shrink-0 place-items-center rounded-[4px] bg-brand text-on-brand transition-transform duration-500 ease-out-expo group-hover:rotate-[-6deg]">
                  <I size={22} weight="light" />
                </span>
                <div>
                  <h3 className="text-xl font-normal tracking-tight text-fg">{title}</h3>
                  <p className="mt-2 leading-relaxed text-muted">{body}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* 4. Sign-in */}
      <Section>
        <FeatureSplit eyebrow="Access" title="Every sign-in has a second factor" body="Admins confirm every sign-in with an emailed code or an authenticator app. Organisations can require app-based two-factor for everyone, and review signed-in sessions." points={["Emailed one-time codes", "Authenticator apps with recovery codes", "Session list and sign-out"]} shot={shots.settings} />
      </Section>

      {/* 5. Roles */}
      <Section>
        <FeatureSplit eyebrow="Least privilege" title="Roles for everyone who needs access" body="Give admins, analysts, managers and read-only users exactly the access they need, and keep an audit log of what they change." points={["Admin, analyst, manager and read-only roles", "Audit log of console changes", "Per-organisation scoping"]} shot={shots.teams} reverse />
      </Section>

      {/* 6. Privacy by design */}
      <Section>
        <SectionHead eyebrow="Privacy by design" title="Visibility without overreach." accent={["overreach."]} body="Monitoring is powerful. These defaults keep it proportionate." />
        <div className="mt-12"><CardGrid items={privacy} /></div>
      </Section>

      {/* 7. Data flow */}
      <Section>
        <div className="ink-edge relative overflow-hidden rounded-[6px] bg-ink p-8 text-ink-fg md:p-14">
          <div className="dot-field-ink absolute inset-0 opacity-70" aria-hidden />
          <SectionHead invert eyebrow="Data flow" title="What leaves the device, and what does not." className="relative" />
          <div className="relative mt-10 grid gap-8 md:grid-cols-2">
            <div>
              <h3 className="font-normal text-brand">Sent to Aavishield</h3>
              <ul className="mt-4 grid gap-2.5 opacity-80">
                {["Policy decisions: blocked and alerted events", "DLP findings with a masked preview", "Device posture and installed applications", "Screenshots, only on monitored devices"].map((x) => (
                  <li key={x} className="flex gap-3"><span className="mt-2.5 size-1.5 shrink-0 bg-brand" />{x}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="font-normal text-brand">Not stored</h3>
              <ul className="mt-4 grid gap-2.5 opacity-80">
                {["Routine allowed browsing", "Full copies of uploaded files", "Query strings that may carry session tokens", "Anything from devices outside your organisation"].map((x) => (
                  <li key={x} className="flex gap-3"><span className="mt-2.5 size-1.5 shrink-0 bg-ink-fg/40" />{x}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </Section>

      {/* 8. Responsible disclosure */}
      <Section>
        <Reveal className="grid gap-6 rounded-[6px] border border-line bg-surface p-8 md:grid-cols-[1.4fr_1fr] md:items-center md:p-12">
          <div>
            <h2 className="text-3xl font-normal tracking-tight text-fg">Found a vulnerability?</h2>
            <p className="mt-3 max-w-[52ch] leading-relaxed text-muted">We welcome reports from security researchers. Please give us reasonable time to fix an issue before disclosing it, and do not access other customers&apos; data.</p>
          </div>
          <a href="mailto:info@aavishailab.com?subject=Security%20report" className="inline-flex h-12 items-center justify-center rounded-[6px] bg-brand px-6 font-medium text-on-brand hover:bg-brand-dark md:justify-self-end">Report an issue</a>
        </Reveal>
      </Section>

      {/* 9. Policies */}
      <Section>
        <SectionHead eyebrow="Policies" title="Read the fine print." />
        <div className="mt-10">
          <LinkCards items={legalPages.map((l) => ({ href: `/${l.slug}`, title: l.title, body: l.description }))} />
        </div>
      </Section>

      {/* 10. FAQ */}
      <FaqSection title="Security questions" items={faq} />

      <CtaBand title="Walk through the architecture with us." />
    </>
  );
}
