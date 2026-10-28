import { H1Kicker } from "./landing/grid";
import { FeedHero } from "./landing/hero-widgets";
import { Enter, HeadlineRise } from "./motion/enter";

/**
 * Top band of every inner page, in the landing page's language: copy on the
 * left (keyword line inside the H1, a regular-weight headline, the lead and
 * buttons), and a product widget on the pixel-grid stage on the right. No
 * dashboard screenshots in heroes: `visual` is always a widget (see
 * landing/hero-widgets.tsx); the live decisions feed is the default.
 *
 * Height follows the widget (420px), not the viewport, so the orange stage
 * does not stretch into a tall empty panel beside the copy.
 */
export function PageHero({
  eyebrow,
  title,
  body,
  children,
  accent = [],
  visual,
  top,
}: {
  eyebrow?: string;
  title: string;
  body: string;
  children?: React.ReactNode;
  accent?: string[];
  /** The hero widget; defaults to the live decisions feed. */
  visual?: React.ReactNode;
  /** Shown above the H1, e.g. breadcrumbs. */
  top?: React.ReactNode;
  /** @deprecated Every hero now has a widget. */
  aside?: boolean;
}) {
  return (
    <section className="grid-band">
      <div className="grid grid-cols-1 items-center lg:grid-cols-[1.1fr_1fr] [&>*]:min-w-0">
        <div className="relative z-10 flex flex-col justify-center px-5 py-12 sm:px-8 md:px-12 md:py-16">
          {top && <Enter className="mb-8">{top}</Enter>}
          <h1 className="max-w-[17ch] text-[2.5rem] font-normal leading-[1.04] tracking-[-0.04em] text-fg sm:text-[3.5rem] lg:text-[3.6rem] xl:text-[4.25rem]">
            {eyebrow && <H1Kicker>{eyebrow}</H1Kicker>}
            <HeadlineRise text={title} accent={accent} />
          </h1>
          <Enter delay={0.15}>
            <p className="mt-7 max-w-[46ch] text-base leading-relaxed text-fg-2 md:text-[17px]">{body}</p>
          </Enter>
          {children && <Enter delay={0.25} className="mt-9 flex flex-wrap gap-3">{children}</Enter>}
        </div>
        <Enter delay={0.3} className="flex items-center border-t border-line p-5 sm:p-6 md:p-8 lg:border-l lg:border-t-0 [&>*]:w-full [&>*]:shrink-0">
          {visual ?? <FeedHero />}
        </Enter>
      </div>
    </section>
  );
}
