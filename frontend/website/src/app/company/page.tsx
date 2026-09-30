import type { Metadata } from "next";
import Image from "next/image";
import { CtaBand } from "@/components/cta-band";
import { ParallaxImage } from "@/components/parallax-image";
import { Enter, HeadlineRise } from "@/components/motion/enter";
import { Float } from "@/components/motion/float";
import { Reveal, WordRise } from "@/components/motion/reveal";
import { ScrollText } from "@/components/scroll-text";

export const metadata: Metadata = {
  title: "About DelSecure",
  description: "DelSecure is built by Aavish AI Lab to make endpoint security simple enough for every company to switch on.",
  alternates: { canonical: "/company" },
  openGraph: { url: "/company" },
};

const beliefs = [
  { title: "Security should not stop work.", body: "Controls that break people's day get switched off. We watch first, and block only where it is clearly right." },
  { title: "Policy belongs on the device.", body: "People left the office network years ago. Enforcement has to travel with them." },
  { title: "One agent beats four.", body: "Every extra agent is another thing to install, update and debug. We keep it to one." },
  { title: "Evidence over assumptions.", body: "Every decision the agent makes is recorded, so you can answer questions with facts." },
];

export default function CompanyPage() {
  return (
    <>
      <section className="relative overflow-hidden">
        <div className="dot-field absolute inset-0 -z-10" aria-hidden />
        <div className="mx-auto max-w-6xl px-4 pb-24 pt-36 md:px-6 md:pt-44">
          <h1 className="max-w-4xl text-[2.6rem] font-semibold leading-[1.02] tracking-[-0.04em] text-fg md:text-7xl">
            <HeadlineRise text="We make company security simple enough to switch on." accent={["switch", "on."]} />
          </h1>
          <div className="relative mt-16 grid gap-10 md:grid-cols-[1fr_1fr]">
            <Enter delay={0.15}>
              <p className="max-w-[52ch] text-lg leading-relaxed text-muted">
                DelSecure is built by Aavish AI Lab. We started with a simple observation: small and mid-sized companies face the same threats as large enterprises, but get tools designed for teams ten times their size.
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

      <section className="mx-auto max-w-[1400px] px-3 sm:px-4 md:px-6">
        <ParallaxImage
          src="/images/company-team.webp"
          alt="The team collaborating around a large table in a minimal studio office"
          sizes="(max-width: 1400px) 100vw, 1400px"
          aspect="aspect-[4/3] sm:aspect-[16/7]"
          eager
        />
      </section>

      <section className="mx-auto max-w-5xl px-4 py-24 md:px-6 md:py-36">
        <ScrollText
          className="text-3xl font-medium leading-[1.2] tracking-tight text-fg md:text-5xl"
          text="So we built one agent that does the job of a web gateway, a DLP product, an application blocker and a posture checker, and a console a single IT person can run."
        />
      </section>

      <section className="mx-auto max-w-6xl px-4 md:px-6">
        <div className="grid items-start gap-12 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="lg:sticky lg:top-28">
            <h2 className="text-4xl font-semibold leading-[1.05] tracking-tight md:text-5xl">
              <WordRise text="What we believe." accent={["believe."]} />
            </h2>
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
      </section>

      <CtaBand title="Want to build this with us, or use it?" />
    </>
  );
}
