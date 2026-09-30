import { modules } from "@/lib/content";
import { ModuleIcon } from "./icons";
import { Float } from "./motion/float";
import { Enter, HeadlineRise } from "./motion/enter";
import { Reveal } from "./motion/reveal";

// Fixed positions for the floating icon constellation on the right.
const spots = [
  "left-[8%] top-[12%]",
  "left-[46%] top-[2%]",
  "right-[4%] top-[22%]",
  "left-[22%] top-[46%]",
  "right-[20%] top-[54%]",
  "left-[4%] bottom-[6%]",
  "right-[2%] bottom-[2%]",
];

export function PageHero({
  eyebrow,
  title,
  body,
  children,
  aside = true,
  accent = [],
}: {
  eyebrow?: string;
  title: string;
  body: string;
  children?: React.ReactNode;
  aside?: boolean;
  accent?: string[];
}) {
  return (
    <section className="relative overflow-hidden">
      <div className="dot-field absolute inset-0 -z-10" aria-hidden />
      <div className={`mx-auto grid max-w-6xl items-center gap-10 px-4 pb-20 pt-36 md:px-6 md:pt-40 ${aside ? "lg:grid-cols-[1.3fr_1fr]" : ""}`}>
        <div>
          {eyebrow && (
            <Enter>
              <span className="text-[12px] font-medium uppercase tracking-[0.16em] text-brand-ink">{eyebrow}</span>
            </Enter>
          )}
          <h1 className="mt-4 max-w-3xl text-[2.5rem] font-semibold leading-[1.03] tracking-[-0.035em] text-fg md:text-6xl">
            <HeadlineRise text={title} accent={accent} />
          </h1>
          <Enter delay={0.15}>
            <p className="mt-6 max-w-[52ch] text-lg leading-relaxed text-muted">{body}</p>
          </Enter>
          {children && <Enter delay={0.25} className="mt-9 flex flex-wrap gap-3">{children}</Enter>}
        </div>
        {aside && (
          <div className="relative hidden h-[340px] lg:block" aria-hidden>
            {modules.map((m, i) => (
              <Float key={m.slug} className={`absolute ${spots[i]}`} amplitude={6 + (i % 3) * 3} duration={5 + i * 0.7} delay={i * 0.3} rotate={i % 2 ? 3 : -3}>
                <Reveal delay={0.2 + i * 0.06} y={16}>
                  <span
                    className={`grid place-items-center rounded-2xl border border-line shadow-[var(--shadow)] ${
                      i === 3 ? "size-20 bg-brand text-on-brand shadow-[0_24px_60px_-18px_rgb(255_112_0/0.7)]" : "glass size-14 text-fg"
                    }`}
                  >
                    <ModuleIcon icon={m.icon} size={i === 3 ? 32 : 24} />
                  </span>
                </Reveal>
              </Float>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
