import { Fragment } from "react";

/** CSS-only entrance for above-the-fold content (see `.enter` in globals.css). */
export function Enter({ delay = 0, className = "", children }: { delay?: number; className?: string; children: React.ReactNode }) {
  return (
    <div className={`enter ${className}`} style={{ animationDelay: `${delay}s` }}>
      {children}
    </div>
  );
}

/**
 * CSS version of WordRise for page headlines: identical motion, but it runs
 * on first paint instead of after hydration, so the H1 is never the late LCP.
 */
export function HeadlineRise({ text, accent = [], delay = 0 }: { text: string; accent?: string[]; delay?: number }) {
  const clean = (w: string) => w.toLowerCase().replace(/[.,]/g, "");
  const hot = new Set(accent.map(clean));
  const words = text.split(" ");
  return (
    <>
      {/* The words are the only copy of the text: an extra sr-only copy made
          crawlers read every headline twice. Real spaces between the word
          boxes keep the extracted text readable ("Pay per device"). */}
      {words.map((w, i) => (
        <Fragment key={i}>
          <span className="inline-block overflow-hidden pb-[0.12em] align-top">
            <span className={`rise inline-block ${hot.has(clean(w)) ? "text-brand" : ""}`} style={{ animationDelay: `${delay + i * 0.05}s` }}>
              {w}
            </span>
          </span>
          {i < words.length - 1 ? " " : null}
        </Fragment>
      ))}
    </>
  );
}
