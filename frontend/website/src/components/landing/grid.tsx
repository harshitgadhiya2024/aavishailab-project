import { Reveal } from "../motion/reveal";

/**
 * The site's visible layout grid. The frame's two hairline columns are drawn
 * once for every page by the layout (`.site-frame`); <GridFrame> just groups
 * bands. Each <GridRow> is a band closed by a bottom hairline, with "+"
 * marks where it meets the columns.
 */
export function GridFrame({ children }: { children: React.ReactNode }) {
  return <div className="relative">{children}</div>;
}

export function Cross({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden className={`pointer-events-none absolute z-10 hidden size-3 md:block ${className}`}>
      <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-fg/60" />
      <span className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-fg/60" />
    </span>
  );
}

export function GridRow({ children, className = "", id }: { children: React.ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={`relative scroll-mt-24 border-b border-line ${className}`}>
      {children}
      <Cross className="-bottom-1.5 -left-1.5" />
      <Cross className="-bottom-1.5 -right-1.5" />
    </section>
  );
}

/** Mono eyebrow with a square orange bullet, e.g. "■ THE PROBLEM". */
export function Label({ children, className = "", invert = false }: { children: React.ReactNode; className?: string; invert?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] ${invert ? "text-brand" : "text-brand-ink"} ${className}`}>
      <span className="size-1.5 bg-brand" />
      {children}
    </span>
  );
}

/**
 * The keyword line of a page's H1, styled as the mono eyebrow. It sits
 * inside the <h1>, so search engines read "keyword: headline" as one
 * heading while the page still shows a short label over a big slogan.
 */
export function H1Kicker({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-6 flex items-center gap-2 font-mono text-[11px] font-normal uppercase leading-normal tracking-[0.12em] text-brand-ink">
      <span aria-hidden className="size-1.5 shrink-0 bg-brand" />
      {children}
      <span className="sr-only">: </span>
    </span>
  );
}

/** Section headline: Satoshi regular, Title Case, with an optional lead. */
export function GridHeading({
  label,
  title,
  body,
  invert = false,
  className = "",
}: {
  label?: string;
  title: React.ReactNode;
  body?: string;
  invert?: boolean;
  className?: string;
}) {
  return (
    <Reveal className={className}>
      {label && <Label invert={invert}>{label}</Label>}
      <h2 className={`mt-6 max-w-[20ch] text-[2rem] font-normal leading-[1.08] tracking-[-0.03em] md:text-[2.6rem] ${invert ? "text-ink-fg" : "text-fg"}`}>{title}</h2>
      {body && <p className={`mt-5 max-w-[46ch] text-[15px] leading-relaxed ${invert ? "text-ink-fg/60" : "text-muted"}`}>{body}</p>}
    </Reveal>
  );
}
