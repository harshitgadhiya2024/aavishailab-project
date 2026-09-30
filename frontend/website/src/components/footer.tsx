import Link from "next/link";
import { modules } from "@/lib/content";
import { Wordmark } from "./wordmark";

const columns = [
  { title: "Platform", links: modules.map((m) => ({ href: `/platform/${m.slug}`, label: m.name })) },
  {
    title: "Company",
    links: [
      { href: "/company", label: "About" },
      { href: "/solutions", label: "Solutions" },
      { href: "/pricing", label: "Pricing" },
      { href: "/security", label: "Trust and security" },
      { href: "/contact", label: "Contact" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="relative mt-32 overflow-hidden border-t border-line">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-16 md:grid-cols-[1.4fr_1fr_1fr] md:px-6">
        <div className="max-w-sm">
          <Wordmark />
          <p className="mt-4 text-sm leading-relaxed text-muted">
            Endpoint security for companies. One agent on every device enforces web, data, application and device policy, wherever people work.
          </p>
        </div>
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
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 pb-8 text-xs text-muted md:flex-row md:justify-between md:px-6">
        <p>© {new Date().getFullYear()} DelSecure. All rights reserved.</p>
        <p>Made by Aavish AI Lab</p>
      </div>
      <p
        aria-hidden
        className="pointer-events-none select-none px-4 text-center text-[22vw] font-semibold leading-[0.8] tracking-[-0.06em] text-fg opacity-[0.05] md:text-[17vw]"
      >
        DelSecure
      </p>
    </footer>
  );
}
