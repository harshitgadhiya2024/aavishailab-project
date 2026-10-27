import { ArrowUpRight, EnvelopeSimple } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { CTA, modules, resources } from "@/lib/content";
import { legalPages } from "@/lib/legal";
import { industries, solutionsList } from "@/lib/solutions";
import { DitherField } from "./landing/dither-field";
import { GridButton } from "./landing/grid-button";
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
      { href: "mailto:info@aavishield.com", label: "info@aavishield.com" },
    ],
  },
];

export function Footer() {
  return (
    // Sits inside the same frame (.frame-w) as the header and the page:
    // a brand band, link columns as grid cells, the legal bar,
    // then a strip of the pixel terrain to close the page.
    <footer>
      <div className="frame-w border-x border-line">
        <div className="grid gap-8 border-b border-line px-5 py-12 sm:px-8 md:grid-cols-[1.3fr_1fr] md:items-end md:px-12 md:py-16">
          <div>
            <Link href="/" aria-label="Aavishield home" className="inline-flex">
              <Logo className="text-[26px]" />
            </Link>
            <p className="mt-6 max-w-[22ch] font-display text-[1.75rem] leading-[1.1] tracking-[-0.03em] text-fg md:text-[2.25rem]">
              Security that travels with <span className="text-brand">every laptop.</span>
            </p>
          </div>
          <div className="md:justify-self-end">
            <div className="flex flex-wrap gap-3">
              <GridButton href="/contact">{CTA.demo}</GridButton>
              <GridButton href="mailto:info@aavishield.com" variant="ghost" icon={EnvelopeSimple}>info@aavishield.com</GridButton>
            </div>
            <p className="mt-4 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.1em] text-muted">
              <span className="size-1.5 bg-brand" /> Runs on macOS · Windows · Linux
            </p>
          </div>
        </div>

        <nav aria-label="Footer" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
          {columns.map((col) => (
            <div key={col.title} className="border-b border-r border-line px-5 py-8 last:border-r-0 sm:px-8 lg:border-b-0 lg:px-8 lg:py-10 [&:nth-child(2n)]:max-sm:border-r-0">
              <h3 className="font-mono text-[11px] uppercase tracking-[0.12em] text-brand-ink">{col.title}</h3>
              <ul className="mt-5 grid gap-2.5">
                {col.links.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className="group inline-flex items-center gap-1 text-[13.5px] text-fg-2 transition-colors hover:text-fg">
                      {l.label}
                      <ArrowUpRight size={11} className="opacity-0 transition-opacity group-hover:opacity-100" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="flex flex-col gap-4 border-t border-line px-5 py-6 text-xs text-muted sm:px-8 md:flex-row md:items-center md:justify-between md:px-12">
          <p>
            © {new Date().getFullYear()} Aavishield, made by <a href="https://aavishailab.com" className="text-fg hover:text-brand-ink">Aavish AI Lab</a>. All rights reserved.
          </p>
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            {legalPages.map((l) => (
              <li key={l.slug}>
                <Link href={`/${l.slug}`} className="hover:text-fg">{l.short}</Link>
              </li>
            ))}
          </ul>
        </div>
        <div aria-hidden className="h-24 border-t border-line md:h-32">
          <DitherField variant="band" cell={6} />
        </div>
      </div>
    </footer>
  );
}
