import type { Metadata } from "next";
import Image from "next/image";
import { CardGrid, FactStrip, FeatureSplit, LinkCards } from "@/components/blocks";
import { CtaBand } from "@/components/cta-band";
import { ParallaxImage } from "@/components/parallax-image";
import { Enter, HeadlineRise } from "@/components/motion/enter";
import { Float } from "@/components/motion/float";
import { Reveal } from "@/components/motion/reveal";
import { ScrollText } from "@/components/scroll-text";
import { Section, SectionHead } from "@/components/section";
import { JsonLd, breadcrumbLd } from "@/lib/seo";
import { shots } from "@/lib/shots";

export const metadata: Metadata = {
  title: "About Aavishield",
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
  { title: "Ship what is real", body: "Everything on this site is something the product does today. Screenshots are the real console." },
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
      <section className="relative overflow-hidden">
        <div className="dot-field absolute inset-0 -z-10" aria-hidden />
        <div className="mx-auto max-w-6xl px-4 pb-24 pt-36 md:px-6 md:pt-44">
          <h1 className="max-w-4xl text-[2.6rem] font-semibold leading-[1.02] tracking-[-0.04em] text-fg md:text-7xl">
            <HeadlineRise text="We make company security simple enough to switch on." accent={["switch", "on."]} />
          </h1>
          <div className="relative mt-16 grid gap-10 md:grid-cols-[1fr_1fr]">
            <Enter delay={0.15}>
              <p className="max-w-[52ch] text-lg leading-relaxed text-muted">
                Aavishield is built by Aavish AI Lab. We started with a simple observation: small and mid-sized companies face the same threats as large enterprises, but get tools designed for teams ten times their size.
              </p>
            </Enter>
            <div className="relative hidden h-40 md:block" aria-hidden>
              <Float className="absolute left-[10%] top-0" amplitude={10} duration={6}>
                <span className="block size-24 rounded-full border border-line-strong" />
              </Float>
              <Float className="absolute left-[38%] top-8" amplitude={14} duration={7.5} delay={0.6}>
                <span className="block size-32 rounded-full bg-brand shadow-[0_30px_80px_-20px_rgb(255_112_0/0.8)]" />
              </Float>
              <Float className="absolute right-[8%] top-2" amplitude={8} duration={5.5} delay={1.2}>
                <span className="glass block size-20 rounded-[20px]" />
              </Float>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Team image */}
      <section className="mx-auto max-w-[1400px] px-3 sm:px-4 md:px-6">
        <ParallaxImage src="/images/company-team.webp" alt="The team collaborating around a large table in a minimal studio office" sizes="(max-width: 1400px) 100vw, 1400px" aspect="aspect-[4/3] sm:aspect-[16/7]" eager />
      </section>

      {/* 3. Story */}
      <section className="mx-auto max-w-5xl px-4 py-24 md:px-6 md:py-36">
        <ScrollText
          className="text-3xl font-medium leading-[1.2] tracking-tight text-fg md:text-5xl"
          text="So we built one agent that does the job of a web gateway, a DLP product, an application blocker and a posture checker, and a console a single IT person can run."
        />
      </section>

      {/* 4. Facts */}
      <section className="mx-auto max-w-6xl px-4 md:px-6">
        <FactStrip items={[{ k: "1", label: "agent for every device" }, { k: "7", label: "security controls" }, { k: "3", label: "operating systems" }, { k: "27", label: "web categories" }]} />
      </section>

      {/* 5. Beliefs */}
      <Section>
        <div className="grid items-start gap-12 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="lg:sticky lg:top-28">
            <SectionHead title="What we believe." accent={["believe."]} />
            <Reveal delay={0.15} y={36} className="relative mt-10 aspect-[4/3] overflow-hidden rounded-[28px] bg-ink">
              <Image src="/images/company-detail.webp" alt="Hands sketching a system diagram in pencil beside a laptop" fill sizes="(max-width: 1024px) 100vw, 480px" className="object-cover" />
            </Reveal>
          </div>
          <div className="grid gap-y-12">
            {beliefs.map((b, i) => (
              <Reveal key={b.title} delay={i * 0.05}>
                <div className="border-l-2 border-brand pl-6">
                  <h3 className="text-2xl font-semibold tracking-tight text-fg">{b.title}</h3>
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
      <Section>
        <div className="ink-edge relative overflow-hidden rounded-[28px] bg-ink p-8 text-ink-fg md:p-14">
          <div className="dot-field-ink absolute inset-0 opacity-70" aria-hidden />
          <div aria-hidden className="absolute -right-24 -top-24 size-80 rounded-full bg-brand/20 blur-3xl" />
          <div className="relative grid gap-10 md:grid-cols-[1.2fr_1fr] md:items-center">
            <SectionHead invert eyebrow="Aavish AI Lab" title="The AI studio behind Aavishield." body="Aavish AI Lab builds AI-driven products and software. Aavishield brings that work to endpoint security: AI classification of documents, OCR of images and an assistant that explains your security data." />
            <Reveal delay={0.1} className="relative aspect-[4/3] overflow-hidden rounded-[20px]">
              <Image src="/images/contact-desk.webp" alt="A calm meeting room at dusk with a laptop on a dark oak table" fill sizes="(max-width: 768px) 100vw, 480px" className="object-cover" />
            </Reveal>
          </div>
        </div>
      </Section>

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
