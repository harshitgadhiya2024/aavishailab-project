import { Reveal, WordRise } from "./motion/reveal";

/** Shared section heading: eyebrow, rising headline, optional lead paragraph. */
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
          <span className={`text-[12px] font-medium uppercase tracking-[0.16em] ${invert ? "text-brand" : "text-brand-ink"}`}>{eyebrow}</span>
        </Reveal>
      )}
      <h2 className={`mt-4 text-4xl font-semibold leading-[1.05] tracking-tight md:text-5xl ${invert ? "" : "text-fg"}`}>
        <WordRise text={title} accent={accent} />
      </h2>
      {body && (
        <Reveal delay={0.15}>
          <p className={`mt-5 text-lg leading-relaxed ${center ? "mx-auto" : ""} max-w-[58ch] ${invert ? "opacity-70" : "text-muted"}`}>{body}</p>
        </Reveal>
      )}
    </div>
  );
}

/** Standard page section wrapper so vertical rhythm stays identical everywhere. */
export function Section({ children, className = "", id, wide = false }: { children: React.ReactNode; className?: string; id?: string; wide?: boolean }) {
  return (
    <section id={id} className={`mx-auto mt-28 scroll-mt-28 px-4 md:mt-36 md:px-6 ${wide ? "max-w-[1400px]" : "max-w-6xl"} ${className}`}>
      {children}
    </section>
  );
}
