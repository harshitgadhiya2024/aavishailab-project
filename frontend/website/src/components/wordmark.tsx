import Image from "next/image";
import Link from "next/link";

// Brand lockups in /public/brand: dark wordmark for the light theme, white
// wordmark for the dark theme. Both render; the theme class picks one.
const LOGO = {
  plain: { light: ["/brand/logo-horizontal-light.png", 1200, 296], dark: ["/brand/logo-horizontal-dark.png", 1200, 308] },
  tagline: { light: ["/brand/logo-horizontal-tagline-light.png", 1400, 354], dark: ["/brand/logo-horizontal-tagline-dark.png", 1400, 347] },
} as const;

export function Logo({ className = "h-8", tagline = true, priority = false }: { className?: string; tagline?: boolean; priority?: boolean }) {
  const l = LOGO[tagline ? "tagline" : "plain"];
  return (
    <span className={`inline-flex shrink-0 ${className}`}>
      <Image src={l.light[0]} alt="Aavishield" width={l.light[1]} height={l.light[2]} priority={priority} className="h-full w-auto dark:hidden" />
      <Image src={l.dark[0]} alt="Aavishield" width={l.dark[1]} height={l.dark[2]} priority={priority} className="hidden h-full w-auto dark:block" />
    </span>
  );
}

/** The site's home link: the Aavishield logo. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <Link href="/" aria-label="Aavishield home" className={`inline-flex items-center ${className}`}>
      <Logo className="h-9 sm:h-10" priority />
    </Link>
  );
}
