import { HydratedLink } from "./hydrated-link";

// The Aavishield logo (source: public/brand/logo.svg): the orange mark, then
// "Aavishield" set in Sora SemiBold. The mark is the original vector path;
// the word is live text in Sora (loaded in layout.tsx), exactly as the
// source file sets it, so it stays crisp at every size.
export const MARK =
  "M588.666,552.478c2.711-3.8,5.051-7.745,6.998-11.808.407-.849.804-1.707,1.185-2.566,5.464-12.309,8.234-25.816,8.234-40.148v-30.421l-7.391.002h-.008c-6.677,0-13.871-1.925-16.61-16.175l-1.151-5.996h-86.475l-.963,6.268c-1.478,9.623-6.4,14.406-16.459,15.992l-6.239.984v37.629c0,11.684,2.264,22.657,6.731,32.614,2.43,5.419,5.45,10.499,9.004,15.157l-38.859,79.965,11.238.495c1.684.073,3.355.111,5.024.111,26.882-.002,51.776-9.639,74.141-28.69,22.504,19.084,47.642,28.741,74.866,28.741,1.176,0,2.359-.019,3.544-.054l11.199-.342-38.01-81.759ZM470.107,619.551l26.226-53.969,29.937,30.07c-17.419,14.531-35.926,22.431-56.163,23.9ZM547.81,595.601l25.162-25.605-6.64-14.33-29.311,29.835-37.341-37.507c-3.925-4.521-7.182-9.63-9.676-15.189-3.607-8.042-5.436-16.98-5.436-26.565v-25.439c10.64-3.274,17.805-10.293,21.082-20.654h62.429c3.795,11.81,11.463,19.194,22.224,21.44v16.369c0,12.253-2.343,23.742-6.966,34.157-.323.728-.657,1.452-1,2.17-.352.735-.727,1.464-1.111,2.19l-23.033-49.545h-41.873l-19.561,43.772c1.848,4.633,5.348,9.299,8.989,13.496l19.959-42.488h23.058l17.216,37.031.022-.01,12.079,26.068.009-.009,25.441,54.723c-20.113-1.681-38.479-9.583-55.721-23.91Z";

/** Just the mark, sized by its height (`h-*`). */
export function LogoMark({ className = "h-8" }: { className?: string }) {
  // The view box is the path's full bounds (446.7–626.7 × 445.4–634.6), so no edge is cut.
  return (
    <svg viewBox="446 445 181 190" className={`w-auto shrink-0 ${className}`} aria-hidden>
      <path d={MARK} fill="#f26b02" />
    </svg>
  );
}

/**
 * Mark plus word. Size it with a font size (`text-*`): the mark is drawn at
 * 1.22em tall and sits 0.28em from the word, the proportions of the source
 * file (mark 186 units tall, word at 152 units, 43 units apart).
 */
export function Logo({ className = "text-[22px]" }: { className?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-[0.28em] font-logo font-semibold leading-none text-fg ${className}`}>
      <LogoMark className="h-[1.22em]" />
      <span className="translate-y-[0.04em]">Aavishield</span>
    </span>
  );
}

/** The site's home link: the Aavishield logo. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <HydratedLink href="/" aria-label="Aavishield home" className={`inline-flex items-center ${className}`}>
      <Logo className="text-[22px]" />
    </HydratedLink>
  );
}
