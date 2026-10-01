import Link from "next/link";
import { modules, resources } from "@/lib/content";
import { legalPages } from "@/lib/legal";
import { industries, solutionsList } from "@/lib/solutions";
import { Logo } from "./wordmark";

const columns = [
  { title: "Platform", links: [{ href: "/platform", label: "Overview" }, ...modules.map((m) => ({ href: `/platform/${m.slug}`, label: m.name }))] },
  { title: "Solutions", links: [{ href: "/solutions", label: "All solutions" }, ...solutionsList.map((s) => ({ href: `/solutions/${s.slug}`, label: s.name }))] },
  { title: "Industries", links: [{ href: "/industries", label: "All industries" }, ...industries.map((i) => ({ href: `/industries/${i.slug}`, label: i.name }))] },
  { title: "Resources", links: resources.map((r) => ({ href: r.href, label: r.label })) },
  {
    title: "Company",
    links: [
      { href: "/company", label: "About" },
      { href: "/pricing", label: "Pricing" },
      { href: "/contact", label: "Book a demo" },
      { href: "mailto:info@aavishailab.com", label: "info@aavishailab.com" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="relative mt-32 overflow-hidden border-t border-line">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-16 md:px-6 lg:grid-cols-[1.2fr_3fr]">
        <div className="max-w-sm">
          <Link href="/" aria-label="Aavishield home" className="inline-flex">
            <Logo className="h-20" sizes="240px" />
          </Link>
          <p className="mt-4 text-sm leading-relaxed text-muted">
            Endpoint security for companies. One agent on every device enforces web, data, application and device policy, wherever people work.
          </p>
          <p className="mt-6 text-sm text-muted">Runs on macOS, Windows and Linux.</p>
        </div>
        <div className="grid grid-cols-2 gap-10 sm:grid-cols-3 lg:grid-cols-5">
          {columns.map((col) => (
            <div key={col.title}>
              <h3 className="text-sm font-medium text-fg">{col.title}</h3>
              <ul className="mt-4 grid gap-2.5">
                {col.links.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className="text-sm text-muted transition-colors hover:text-brand-ink">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <div className="mx-auto flex max-w-6xl flex-col gap-4 border-t border-line px-4 py-8 text-xs text-muted md:flex-row md:items-center md:justify-between md:px-6">
        <p>© {new Date().getFullYear()} Aavishield, made by Aavish AI Lab. All rights reserved.</p>
        <ul className="flex flex-wrap gap-x-5 gap-y-2">
          {legalPages.map((l) => (
            <li key={l.slug}>
              <Link href={`/${l.slug}`} className="hover:text-fg">{l.short}</Link>
            </li>
          ))}
        </ul>
      </div>
      {/* Decorative watermark. The word is drawn by CSS (::before), so it is
          not text content that assistive tech or contrast checks pick up. */}
      <div
        aria-hidden
        className="footer-watermark pointer-events-none select-none px-4 text-center text-[22vw] font-semibold leading-[0.8] tracking-[-0.06em] text-fg opacity-[0.05] md:text-[17vw]"
      />
    </footer>
  );
}
