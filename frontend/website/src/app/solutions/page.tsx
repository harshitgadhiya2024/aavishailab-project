import type { Metadata } from "next";
import { CtaBand } from "@/components/cta-band";
import { Reveal, WordRise } from "@/components/motion/reveal";
import { PageHero } from "@/components/page-hero";
import { SolutionsTabs } from "@/components/solutions-tabs";

export const metadata: Metadata = {
  title: "Solutions",
  description: "AI governance, remote teams, audit readiness and insider risk, solved with one endpoint agent.",
};

const teams = [
  { who: "IT teams", what: "Roll out one agent instead of four products, and stop maintaining office-only firewalls." },
  { who: "Security leads", what: "See every blocked site, flagged upload and stopped download in one place." },
  { who: "Founders and HR", what: "Protect customer data and company IP without slowing anyone down." },
];

export default function SolutionsPage() {
  return (
    <>
      <PageHero
        eyebrow="Solutions"
        title="Start from the problem you have today."
        body="Each solution combines the DelSecure controls that matter for it. Pick one below to see how."
        aside={false}
      />

      <section className="mx-auto max-w-6xl px-4 md:px-6">
        <SolutionsTabs />
      </section>

      <section className="mx-auto mt-36 max-w-6xl px-4 md:px-6">
        <h2 className="max-w-2xl text-4xl font-semibold leading-[1.05] tracking-tight md:text-5xl">
          <WordRise text="Built for the people who carry the risk." />
        </h2>
        <div className="mt-14 grid gap-12 md:grid-cols-[1fr_1fr_1fr] md:gap-8">
          {teams.map((t, i) => (
            <Reveal key={t.who} delay={i * 0.1} className={i === 1 ? "md:mt-16" : i === 2 ? "md:mt-32" : ""}>
              <div className="border-t border-fg pt-6">
                <h3 className="text-2xl font-semibold tracking-tight text-fg">{t.who}</h3>
                <p className="mt-3 leading-relaxed text-muted">{t.what}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <CtaBand title="Tell us your problem. We will show you the policy." />
    </>
  );
}
