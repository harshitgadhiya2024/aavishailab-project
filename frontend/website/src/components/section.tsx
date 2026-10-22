import { Label } from "./landing/grid";
import { Reveal, WordRise } from "./motion/reveal";

/** Shared section heading: mono eyebrow, rising headline, optional lead paragraph. */
export function SectionHead({
  eyebrow,
  title,
  accent = [],
  body,
  center = false,
  className = "",
  invert = false,
}: {
  eyebrow?: string;
  title: string;
  accent?: string[];
  body?: string;
  center?: boolean;
  className?: string;
  invert?: boolean;
}) {
  return (
    <div className={`${center ? "mx-auto text-center" : ""} max-w-3xl ${className}`}>
      {eyebrow && (
        <Reveal>
          <Label invert={invert}>{eyebrow}</Label>
        </Reveal>
      )}
      <h2 className={`mt-5 text-[2rem] font-normal leading-[1.08] tracking-[-0.03em] md:text-[2.6rem] ${invert ? "" : "text-fg"}`}>
        <WordRise text={title} accent={accent} />
      </h2>
      {body && (
        <Reveal delay={0.15}>
          <p className={`mt-5 text-base leading-relaxed ${center ? "mx-auto" : ""} max-w-[56ch] ${invert ? "opacity-70" : "text-muted"}`}>{body}</p>
        </Reveal>
      )}
    </div>
  );
}

/**
 * Standard page section: one band of the site's grid frame, closed by a
 * hairline with "+" marks (see `.grid-band`), with the same inner padding
 * as the landing page. `wide` is kept for older call sites; every band now
 * spans the frame.
 */
export function Section({ children, className = "", id }: { children: React.ReactNode; className?: string; id?: string; wide?: boolean }) {
  return (
    <section id={id} className={`grid-band scroll-mt-24 px-5 py-16 sm:px-8 md:px-12 md:py-24 ${className}`}>
      {children}
    </section>
  );
}
