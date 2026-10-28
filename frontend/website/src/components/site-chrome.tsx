"use client";

import { useLayoutEffect } from "react";
import { usePathname } from "next/navigation";

// Pages that are a one-page site of their own (the prelaunch waitlist) bring
// their own header and footer, so they skip the website's menu, frame and footer.
const STANDALONE = ["/waitlist"];

/** Shared layout keeps window scroll; jump to the top on every route so heroes are not clipped. */
function ScrollToTop({ pathname }: { pathname: string }) {
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash) return;
    window.history.scrollRestoration = "manual";
    const html = document.documentElement;
    const previous = html.style.scrollBehavior;
    html.style.scrollBehavior = "auto";
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    html.style.scrollBehavior = previous;
  }, [pathname]);
  return null;
}

/** The website's menu, page frame and footer around every page except the standalone ones. */
export function SiteChrome({ nav, footer, children }: { nav: React.ReactNode; footer: React.ReactNode; children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const standalone = STANDALONE.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (standalone) {
    return (
      <main id="main">
        <ScrollToTop pathname={pathname} />
        {children}
      </main>
    );
  }

  return (
    <>
      <ScrollToTop pathname={pathname} />
      {nav}
      {/* Every page sits in the same responsive frame (.site-frame), flush under the fixed 64px header. */}
      <main id="main" className="pt-16">
        <div className="site-frame">{children}</div>
      </main>
      {footer}
    </>
  );
}
