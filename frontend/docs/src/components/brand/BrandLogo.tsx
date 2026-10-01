import Image from "next/image";

// Aavishield brand assets live in /public/brand. The horizontal lockup has a
// light-UI version (dark wordmark) and a dark-UI version (white wordmark);
// this app is always dark, so only the dark-UI version is used.

const LOCKUPS = {
  plain: { light: ["/brand/logo-horizontal-light.png", 1200, 296], dark: ["/brand/logo-horizontal-dark.png", 1200, 308] },
  tagline: { light: ["/brand/logo-horizontal-tagline-light.png", 1400, 354], dark: ["/brand/logo-horizontal-tagline-dark.png", 1400, 347] },
} as const;

/** Full Aavishield logo (mark + wordmark + "Secure today. Enable tomorrow."). Size it with a height class, e.g. "h-12". */
export function BrandLogo({ className = "h-8", tagline = true, priority = false }: { className?: string; tagline?: boolean; priority?: boolean }) {
  const l = LOCKUPS[tagline ? "tagline" : "plain"];
  return (
    <span className={`inline-flex shrink-0 ${className}`}>
      {/* This app is dark-only, so it always uses the white-wordmark lockup. */}
      <Image src={l.dark[0]} alt="Aavishield" width={l.dark[1]} height={l.dark[2]} priority={priority} className="h-full w-auto" />
    </span>
  );
}

/** The Aavishield shield mark on its own, for tight spaces like a collapsed sidebar. */
export function BrandMark({ className = "h-8 w-8" }: { className?: string }) {
  return <Image src="/brand/mark.png" alt="Aavishield" width={512} height={512} className={`shrink-0 object-contain ${className}`} />;
}
