import Image from "next/image";
import Link from "next/link";

// Brand lockups in /public/brand: dark wordmark for the light theme, white
// wordmark for the dark theme. Both render; the theme class picks one.
const LOGO = {
  plain: { light: ["/brand/logo-horizontal-light.png", 1400, 467], dark: ["/brand/logo-horizontal-dark.png", 1400, 506] },
  tagline: { light: ["/brand/logo-horizontal-tagline-light.png", 1400, 467], dark: ["/brand/logo-horizontal-tagline-dark.png", 1400, 467] },
} as const;

/**
 * `sizes` is the rendered width (the lockup is 3x as wide as it is tall), so
 * the browser fetches a ~360px file instead of the 1400px original. Both
 * theme variants are lazy: the one hidden by the theme class is never
 * fetched, and the visible one is in view so it loads straight away.
 */
export function Logo({ className = "h-8", tagline = true, sizes = "160px" }: { className?: string; tagline?: boolean; sizes?: string }) {
  const l = LOGO[tagline ? "tagline" : "plain"];
  return (
    <span className={`inline-flex shrink-0 ${className}`}>
      <Image src={l.light[0]} alt="Aavishield" width={l.light[1]} height={l.light[2]} sizes={sizes} loading="lazy" className="h-full w-auto dark:hidden" />
      <Image src={l.dark[0]} alt="Aavishield" width={l.dark[1]} height={l.dark[2]} sizes={sizes} loading="lazy" className="hidden h-full w-auto dark:block" />
    </span>
  );
}

/** The site's home link: the Aavishield logo. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <Link href="/" aria-label="Aavishield home" className={`inline-flex items-center ${className}`}>
      <Logo className="h-14" sizes="168px" />
    </Link>
  );
}
