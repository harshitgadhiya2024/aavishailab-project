import type { Metadata } from "next";
import { DataTypesHero } from "@/components/landing/hero-widgets";
import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import { CardGrid, FaqSection, FeatureSplit, LinkCards } from "@/components/blocks";
import { Button } from "@/components/button";
import { CtaBand } from "@/components/cta-band";
import { Reveal, Stagger, StaggerItem } from "@/components/motion/reveal";
import { PageHero } from "@/components/page-hero";
import { ParallaxImage } from "@/components/parallax-image";
import { Section, SectionHead } from "@/components/section";
import { SolutionIcon } from "@/components/solution-icon";
import { CTA } from "@/lib/content";
import { JsonLd, breadcrumbLd } from "@/lib/seo";
import { shots } from "@/lib/shots";
import { industries, solutionsList } from "@/lib/solutions";

export const metadata: Metadata = {
  title: "Endpoint Security by Industry",
  description: "How Aavishield protects the sensitive data of software companies, financial services, healthcare, BPO and customer support teams, and growing startups.",
  alternates: { canonical: "/industries" },
  openGraph: { url: "/industries" },
};

const common = [
  { title: "Sensitive data on laptops", body: "Every industry now has regulated or confidential data on devices that leave the office." },
  { title: "Clients ask for proof", body: "Security questionnaires and audits arrive long before a security team exists." },
  { title: "Mixed fleets", body: "Macs, Windows and Linux, company-owned and personal, all need the same baseline." },
  { title: "Small IT teams", body: "One person often runs IT and security for the whole company." },
];

const faq = [
  { q: "Is Aavishield only for one industry?", a: "No. The platform is the same for every customer. Industry pages show which controls matter most for the data you handle." },
  { q: "Can policies differ between departments?", a: "Yes. Policies can target the whole company, teams or individual employees." },
  { q: "Which Indian identifiers does DLP detect?", a: "PAN, Aadhaar, GST numbers and bank account details, alongside card numbers, credentials, source code and AI classification of documents." },
];

export default function IndustriesPage() {
  return (
    <>
      <JsonLd data={breadcrumbLd([{ name: "Home", path: "" }, { name: "Industries", path: "/industries" }])} />

      {/* 1. Hero */}
      <PageHero visual={<DataTypesHero />} eyebrow="Endpoint security by industry" accent={["handle."]} title="Security shaped around the data you handle." body="Different industries carry different data and different obligations. Aavishield adapts the same seven controls to each.">
        <Button href="/contact" size="lg">{CTA.demo}</Button>
      </PageHero>

      {/* 2. Industry cards */}
      <section className="grid-band px-5 py-16 sm:px-8 md:px-12 md:py-24">
        <Stagger className="grid gap-4 md:grid-cols-2">
          {industries.map((ind, i) => (
            <StaggerItem key={ind.slug} className={i === 0 ? "md:col-span-2" : ""}>
              <Link href={`/industries/${ind.slug}`} className={`group grid h-full overflow-hidden rounded-[6px] border border-line bg-surface transition-colors duration-300 hover:border-brand/50 ${i === 0 ? "md:grid-cols-2" : ""}`}>
                <div className={`relative m-2 overflow-hidden rounded-[6px] bg-bg-2 ${i === 0 ? "aspect-[16/10] md:aspect-auto md:min-h-[300px]" : "aspect-[16/9]"}`}>
                  <Image src={shots[ind.hero].src} alt={shots[ind.hero].alt} fill sizes="(max-width: 768px) 100vw, 560px" className="object-cover object-left-top transition-transform duration-[1.1s] ease-out-expo group-hover:scale-[1.05]" />
                </div>
                <div className="flex flex-col justify-between gap-6 p-6 md:p-8">
                  <div className="flex items-start justify-between">
                    <span className="grid size-12 place-items-center rounded-[4px] border border-line text-fg transition-colors duration-300 group-hover:border-brand group-hover:bg-brand group-hover:text-on-brand">
                      <SolutionIcon icon={ind.icon} size={24} />
                    </span>
                    <ArrowUpRight size={20} className="text-muted transition-transform duration-300 group-hover:-translate-y-1 group-hover:translate-x-1" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-normal tracking-tight text-fg">{ind.name}</h2>
                    <p className="mt-2 leading-relaxed text-muted">{ind.headline}</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {ind.data.slice(0, 3).map((d) => (
                        <span key={d} className="rounded-[4px] bg-bg-2 px-2.5 py-1 text-xs text-fg-2">{d}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </Link>
            </StaggerItem>
          ))}
        </Stagger>
      </section>

      {/* 3. Common ground */}
      <Section>
        <SectionHead eyebrow="Common ground" title="What every industry has in common now." />
        <div className="mt-12"><CardGrid items={common} cols={4} /></div>
      </Section>

      {/* 4. Image */}
      <Section wide>
        <ParallaxImage src="/images/home-anywhere.webp" alt="An employee working on a laptop in an airport lounge at dusk" sizes="(max-width: 1400px) 100vw, 1400px" aspect="aspect-[4/3] sm:aspect-[21/9]" />
      </Section>

      {/* 5. Data */}
      <Section>
        <FeatureSplit
          eyebrow="Detection"
          title="Recognises the data that matters to you"
          body="From card numbers and bank details to patient reports and source code, DLP detectors and AI classification find sensitive content in uploads, messages and images."
          points={["Indian identifiers: PAN, Aadhaar, GST, IFSC", "Credentials: API keys, tokens, database URLs", "Documents: salary sheets, contracts, ID scans"]}
          shot={shots.dlp}
        />
      </Section>

      {/* 6. Evidence */}
      <Section>
        <FeatureSplit
          eyebrow="Evidence"
          title="Reports for clients, auditors and leadership"
          body="Executive summary, device compliance and employee risk reports export to PDF, Excel or CSV, so every industry's audit has the evidence it needs."
          points={["Device compliance per laptop", "Incidents by control over time", "Employee risk ranking"]}
          shot={shots.reports}
          reverse
        />
      </Section>

      {/* 7. Problems */}
      <Section>
        <SectionHead eyebrow="By problem" title="Or start from the problem instead." />
        <div className="mt-12">
          <LinkCards items={solutionsList.slice(0, 6).map((s) => ({ href: `/solutions/${s.slug}`, title: s.name, body: s.menu, icon: <SolutionIcon icon={s.icon} size={22} /> }))} />
        </div>
        <Reveal className="mt-8"><Button href="/solutions" variant="ghost">All nine problems</Button></Reveal>
      </Section>

      {/* 8. FAQ */}
      <FaqSection title="Industry questions" items={faq} />

      <CtaBand title="Tell us your industry. We will show you the policy." />
    </>
  );
}
