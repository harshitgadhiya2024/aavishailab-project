import type { Metadata } from "next";
import { H1Kicker } from "@/components/landing/grid";
import { CalendarCheck, ChatCircleText, EnvelopeSimple, Laptop, Lifebuoy, ShieldCheck } from "@phosphor-icons/react/dist/ssr";
import { CardGrid, FaqSection, FeatureSplit, LinkCards } from "@/components/blocks";
import { ContactForm } from "@/components/contact-form";
import { Enter, HeadlineRise } from "@/components/motion/enter";
import { Reveal } from "@/components/motion/reveal";
import { Section, SectionHead } from "@/components/section";
import { SolutionIcon } from "@/components/solution-icon";
import { JsonLd, breadcrumbLd, faqLd } from "@/lib/seo";
import { shots } from "@/lib/shots";
import { solutionsList } from "@/lib/solutions";

export const metadata: Metadata = {
  title: "Book an Endpoint Security Demo",
  description: "See Aavishield on your own devices. Book a 30-minute demo of endpoint security, DLP and web filtering with our team.",
  alternates: { canonical: "/contact" },
  openGraph: { url: "/contact" },
};

const expect = [
  { I: ChatCircleText, title: "A short conversation", body: "We learn what you need to protect and which devices you run." },
  { I: Laptop, title: "A live walkthrough", body: "We show the agent and console enforcing a policy like yours." },
  { I: CalendarCheck, title: "A pilot, if it fits", body: "Enroll a few devices and see real events from your own team." },
];

const agenda = [
  { t: "0 to 5 min", b: "Your devices, your data, your biggest worry." },
  { t: "5 to 20 min", b: "Live console: overview, DLP, web gateway, reports." },
  { t: "20 to 25 min", b: "Install the agent on a test device, live." },
  { t: "25 to 30 min", b: "Pilot plan and a quote for your fleet." },
];

const channels = [
  { I: CalendarCheck, title: "Sales and demos", body: "Use the form on this page. We reply within one working day." },
  { I: Lifebuoy, title: "Customer support", body: "Raise a ticket from the Support menu in your console." },
  { I: ShieldCheck, title: "Security and privacy", body: "Write to info@aavishield.com with the subject 'Security' or 'Privacy'." },
  { I: EnvelopeSimple, title: "Everything else", body: "info@aavishield.com" },
];

const faq = [
  { q: "Is the demo really 30 minutes?", a: "Yes. If you want to go deeper we can schedule a technical session afterwards." },
  { q: "Do I need to prepare anything?", a: "No. If you would like to see the agent on your own device, have a test laptop handy." },
  { q: "Can my IT and security team join?", a: "Please bring them. Their questions usually make the demo more useful." },
  { q: "Will you share pricing?", a: "Yes. We send a quote for your fleet size within a day of the demo." },
];

export default function ContactPage() {
  return (
    <>
      <JsonLd data={breadcrumbLd([{ name: "Home", path: "" }, { name: "Book a demo", path: "/contact" }])} />
      <JsonLd data={faqLd(faq)} />

      {/* 1. Hero + form */}
      <section className="grid-band relative overflow-hidden">
        <div className="grid gap-14 px-5 pb-16 pt-14 sm:px-8 md:px-12 md:pt-20 lg:grid-cols-[1fr_1.15fr]">
          <div>
            <h1 className="text-[2.6rem] font-normal leading-[1.03] tracking-[-0.035em] text-fg md:text-6xl">
              <H1Kicker>Book an endpoint security demo</H1Kicker>
              <HeadlineRise text="See it on your own devices." accent={["devices."]} />
            </h1>
            <Enter delay={0.15}>
              <p className="mt-6 max-w-[44ch] text-lg leading-relaxed text-muted">Thirty minutes with our team. No slides, just the product.</p>
            </Enter>
            <ul className="mt-12 grid gap-8">
              {expect.map(({ I, title, body }, i) => (
                <Reveal key={title} delay={0.4 + i * 0.1}>
                  <li className="flex gap-4">
                    <span className="grid size-11 shrink-0 place-items-center rounded-[4px] bg-brand text-on-brand">
                      <I size={20} weight="light" />
                    </span>
                    <span>
                      <span className="block font-medium text-fg">{title}</span>
                      <span className="mt-1 block leading-relaxed text-muted">{body}</span>
                    </span>
                  </li>
                </Reveal>
              ))}
            </ul>
          </div>
          <Reveal delay={0.2} y={36}>
            <ContactForm />
          </Reveal>
        </div>
      </section>

      {/* 2. What you will see */}
      <Section>
        <FeatureSplit eyebrow="What you will see" title="The real console, with your questions" body="We walk through the security overview, a DLP incident, a web policy and a report, then answer whatever matters to you." points={["Your use case, not a script", "The real product, not slides", "Honest answers about fit"]} shot={shots.overview} />
      </Section>

      {/* 3. Agenda */}
      <Section>
        <SectionHead eyebrow="Agenda" title="How the 30 minutes go." />
        <div className="mt-12 grid gap-px overflow-hidden rounded-[6px] border border-line bg-line md:grid-cols-4">
          {agenda.map((a, i) => (
            <Reveal key={a.t} delay={i * 0.06} className="bg-bg p-6">
              <span className="font-mono text-sm text-brand-ink">{a.t}</span>
              <p className="mt-3 leading-relaxed text-fg-2">{a.b}</p>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* 4. Channels */}
      <Section>
        <SectionHead eyebrow="Other ways to reach us" title="Talk to the right people." />
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {channels.map(({ I, title, body }, i) => (
            <Reveal key={title} delay={i * 0.05} className="rounded-[6px] border border-line bg-surface p-6">
              <I size={26} weight="light" className="text-brand-ink" />
              <h3 className="mt-5 font-normal text-fg">{title}</h3>
              <p className="mt-2 break-words text-sm leading-relaxed text-muted">{body}</p>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* 5. After the demo */}
      <Section>
        <SectionHead eyebrow="After the demo" title="What happens next." />
        <div className="mt-12">
          <CardGrid
            items={[
              { title: "A quote within a day", body: "Per-device pricing for your fleet and the plan that fits what you need." },
              { title: "A pilot on your devices", body: "Enroll a handful of laptops and see real events from your own team." },
              { title: "A rollout plan", body: "A simple plan for telling employees and enrolling everyone." },
            ]}
          />
        </div>
      </Section>

      {/* 6. Problems */}
      <Section>
        <SectionHead eyebrow="Before the call" title="Read up on the problem you have." />
        <div className="mt-10">
          <LinkCards items={solutionsList.slice(0, 6).map((s) => ({ href: `/solutions/${s.slug}`, title: s.name, body: s.menu, icon: <SolutionIcon icon={s.icon} size={22} /> }))} more={{ href: "/solutions", label: "All solutions" }} />
        </div>
      </Section>

      {/* 7. FAQ */}
      <FaqSection title="About the demo" items={faq} />
    </>
  );
}
