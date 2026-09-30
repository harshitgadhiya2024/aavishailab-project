import { CTA } from "@/lib/content";
import Link from "next/link";
import { Magnetic } from "./motion/magnetic";
import { Reveal, WordRise } from "./motion/reveal";

export function CtaBand({ title = "Put policy on every device this week." }: { title?: string }) {
  return (
    <section className="mx-auto mt-32 max-w-6xl px-4 md:px-6">
      <div className="relative ink-edge overflow-hidden rounded-[28px] bg-ink px-6 py-20 text-center text-ink-fg md:px-16 md:py-28">
        <div className="dot-field-ink absolute inset-0 opacity-70" aria-hidden />
        <div aria-hidden className="absolute -left-24 -top-24 size-72 rounded-full border border-ink-fg/15" />
        <div aria-hidden className="absolute -bottom-32 -right-20 size-96 rounded-full border border-ink-fg/10" />
        <h2 className="relative mx-auto max-w-3xl text-4xl font-semibold leading-[1.05] tracking-tight md:text-6xl">
          <WordRise text={title} />
        </h2>
        <Reveal delay={0.3} className="relative mt-6">
          <p className="mx-auto max-w-[48ch] text-base leading-relaxed opacity-70 md:text-lg">
            Install the agent, choose a policy, and watch the first events arrive in minutes.
          </p>
        </Reveal>
        <Reveal delay={0.45} className="relative mt-10 flex justify-center">
          <Magnetic>
            <Link
              href="/contact"
              className="inline-flex h-12 items-center rounded-full bg-ink-fg px-7 text-[15px] font-medium text-ink transition-transform duration-200 active:scale-[0.97]"
            >
              {CTA.demo}
            </Link>
          </Magnetic>
        </Reveal>
      </div>
    </section>
  );
}
