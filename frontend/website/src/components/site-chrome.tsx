"use client";

import { usePathname } from "next/navigation";

// Pages that are a one-page site of their own (the prelaunch waitlist) bring
// their own header and footer, so they skip the website's menu, frame and footer.
const STANDALONE = ["/waitlist"];

/** The website's menu, page frame and footer around every page except the standalone ones. */
export function SiteChrome({ nav, footer, children }: { nav: React.ReactNode; footer: React.ReactNode; children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const standalone = STANDALONE.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (standalone) return <main id="main">{children}</main>;

  return (
    <>
      {nav}
      {/* Every page sits in the same responsive frame (.site-frame), flush under the fixed 64px header. */}
      <main id="main" className="pt-16">
        <div className="site-frame">{children}</div>
      </main>
      {footer}
    </>
  );
}
