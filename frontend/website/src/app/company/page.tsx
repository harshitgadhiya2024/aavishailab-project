import { AiLabWidget } from "@/components/landing/section-widgets";
import type { Metadata } from "next";
import { MarkHero } from "@/components/landing/hero-widgets";
import { PageHero } from "@/components/page-hero";
import { CardGrid, FactStrip, FeatureSplit, LinkCards } from "@/components/blocks";
import { CtaBand } from "@/components/cta-band";
import { Reveal } from "@/components/motion/reveal";
import { ScrollText } from "@/components/scroll-text";
import { Section, SectionHead } from "@/components/section";
import { JsonLd, breadcrumbLd } from "@/lib/seo";
import { shots } from "@/lib/shots";

export const metadata: Metadata = {
  title: "About Aavish AI Lab, Makers of Aavishield",
  description: "Aavishield is built by Aavish AI Lab to make endpoint security simple enough for every company to switch on.",
  alternates: { canonical: "/company" },
  openGraph: { url: "/company" },
};

const beliefs = [
  { title: "Security should not stop work.", body: "Controls that break people's day get switched off. We watch first, and block only where it is clearly right." },
  { title: "Policy belongs on the device.", body: "People left the office network years ago. Enforcement has to travel with them." },
  { title: "One agent beats four.", body: "Every extra agent is another thing to install, update and debug. We keep it to one." },
  { title: "Evidence over assumptions.", body: "Every decision the agent makes is recorded, so you can answer questions with facts." },
];

const how = [
  { title: "Ship what is real", body: "Everything on this site is something the product does today. The product tour shows the real console." },
  { title: "Engineer for the endpoint", body: "A Rust agent that behaves the same on macOS, Windows and Linux, tested on all three." },
  { title: "Listen to the IT person", body: "Our users are often one person running IT for a whole company. We design for their afternoon." },
  { title: "Respect the employee", body: "Opt-in monitoring, monitor-only DLP and a portal that shows people what was blocked." },
  { title: "Protect what we see", body: "Signed policy, isolated organisations and short-lived links. We hold ourselves to our own standard." },
  { title: "Explain every decision", body: "Every block and alert has a reason a non-specialist can read." },
];

export default function CompanyPage() {
  return (
    <>
      <JsonLd data={breadcrumbLd([{ name: "Home", path: "" }, { name: "Company", path: "/company" }])} />

      {/* 1. Hero */}
      <PageHero
        eyebrow="About Aavish AI Lab, the team behind Aavishield"
        title="We make company security simple enough to switch on."
        accent={["switch", "on."]}
        body="Aavishield is built by Aavish AI Lab. We started with a simple observation: small and mid-sized companies face the same threats as large enterprises, but get tools designed for teams ten times their size."
        visual={<MarkHero />}
      />

      {/* 3. Story */}
      <section className="grid-band px-5 py-24 sm:px-8 md:px-12 md:py-32">
        <ScrollText
          className="text-3xl font-medium leading-[1.2] tracking-tight text-fg md:text-5xl"
          text="So we built one agent that does the job of a web gateway, a DLP product, an application blocker and a posture checker, and a console a single IT person can run."
        />
      </section>

      {/* 4. Facts */}
      <section className="grid-band px-5 py-16 sm:px-8 md:px-12 md:py-24">
        <FactStrip items={[{ k: "1", label: "agent for every device" }, { k: "7", label: "security controls" }, { k: "3", label: "operating systems" }, { k: "27", label: "web categories" }]} />
      </section>

      {/* 5. Beliefs */}
      <Section>
        <div className="grid items-start gap-12 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="lg:sticky lg:top-28">
            <SectionHead title="What we believe." accent={["believe."]} />
          </div>
          <div className="grid gap-y-12">
            {beliefs.map((b, i) => (
              <Reveal key={b.title} delay={i * 0.05}>
                <div className="border-l-2 border-brand pl-6">
                  <h3 className="text-2xl font-normal tracking-tight text-fg">{b.title}</h3>
                  <p className="mt-3 max-w-[46ch] leading-relaxed text-muted">{b.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </Section>

      {/* 6. What we built */}
      <Section>
        <FeatureSplit eyebrow="What we built" title="A console for the person who runs IT" body="Plain-language alerts with fixes, a needs-attention list, reports ready for auditors and an assistant that answers questions from your live data." points={["One overview for every control", "Fixes explained per operating system", "Exports for every report"]} shot={shots.overview} />
      </Section>

      {/* 7. How we work */}
      <Section>
        <SectionHead eyebrow="How we work" title="Six habits behind the product." />
        <div className="mt-12"><CardGrid items={how} /></div>
      </Section>

      {/* 8. Aavish AI Lab */}
      {/* Full-width black band, as on the landing and feature pages. */}
      <section className="grid-band bg-ink px-5 py-16 text-ink-fg sm:px-8 md:px-12 md:py-20">
        <div className="grid gap-10 md:grid-cols-[1.1fr_1fr] md:items-center md:gap-16">
          <SectionHead invert eyebrow="Aavish AI Lab" title="The AI studio behind Aavishield." accent={["Aavishield."]} body="Aavish AI Lab builds AI-driven products and software. Aavishield brings that work to endpoint security: AI classification of documents, OCR of images and an assistant that explains your security data." />
          <Reveal delay={0.1} className="min-w-0">
            <AiLabWidget />
          </Reveal>
        </div>
      </section>

      {/* 9. Next steps */}
      <Section>
        <SectionHead eyebrow="Get to know us" title="Where to go next." />
        <div className="mt-10">
          <LinkCards
            items={[
              { href: "/product-tour", title: "Product tour", body: "See the real console, screen by screen." },
              { href: "/security", title: "Trust and security", body: "How we protect the data we see." },
              { href: "/contact", title: "Talk to us", body: "Book a demo or ask a question." },
            ]}
          />
        </div>
      </Section>

      <CtaBand title="Want to build this with us, or use it?" />
    </>
  );
}
