import { CTA } from "@/lib/content";
import { Reassurance } from "./landing/conversion";
import { DitherField } from "./landing/dither-field";
import { GridButton } from "./landing/grid-button";
import { Reveal, WordRise } from "./motion/reveal";

/** Closing call to action for inner pages: the landing page's final band, over the pixel terrain. */
export function CtaBand({ title = "Put policy on every device this week." }: { title?: string }) {
  return (
    <section className="grid-band overflow-hidden">
      <div className="relative min-h-[460px] md:min-h-[520px]">
        <div className="absolute inset-x-0 bottom-0 h-[55%]" aria-hidden>
          <DitherField variant="band" />
        </div>
        <div className="relative z-10 px-5 pb-12 pt-14 sm:px-8 md:px-12 md:pb-16 md:pt-20">
          <h2 className="max-w-[18ch] text-[2.5rem] font-normal leading-[1] tracking-[-0.045em] text-fg md:text-[4.25rem]">
            <WordRise text={title} />
          </h2>
          <Reveal delay={0.2}>
            <p className="mt-5 max-w-[44ch] text-[15px] leading-relaxed text-fg-2">
              Install the agent, choose a policy, and see every decision in one console. A pilot can be live in an afternoon.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <GridButton href="/contact">{CTA.demo}</GridButton>
              <GridButton href="/pricing" variant="ghost">See pricing</GridButton>
            </div>
            <Reassurance className="mt-5" />
          </Reveal>
        </div>
      </div>
    </section>
  );
}
