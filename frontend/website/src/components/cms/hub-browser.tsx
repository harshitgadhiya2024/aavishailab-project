"use client";

import { ArrowRight, MagnifyingGlass, X } from "@phosphor-icons/react";
import Link from "next/link";
import { useState } from "react";
import type { PostSummary } from "@/lib/cms";

type Group = { id: string; name: string; body: string; posts: PostSummary[] };

// Stretch the last section across any empty cells on its row (2 columns at md, 3 at xl).
function lastRowSpan(count: number) {
  const md = count % 2 ? "md:col-span-2" : "";
  const xl = ["xl:col-span-1", "xl:col-span-3", "xl:col-span-2"][count % 3];
  return `${md} ${xl}`;
}

const norm = (s: string) => s.toLowerCase();

/** Search box, section chips and every article grouped by section. */
export function HubBrowser({ groups }: { groups: Group[] }) {
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<string | null>(null);

  const terms = norm(q).split(/\s+/).filter(Boolean);
  const visible = groups
    .filter((g) => !only || g.id === only)
    .map((g) => ({
      ...g,
      posts: g.posts.filter((p) => {
        const hay = norm([p.title, p.excerpt, p.category, ...(p.tags ?? [])].join(" "));
        return terms.every((t) => hay.includes(t));
      }),
    }))
    .filter((g) => g.posts.length > 0);
  const total = visible.reduce((n, g) => n + g.posts.length, 0);

  return (
    <div>
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <label className="relative block w-full lg:max-w-[440px]">
          <span className="sr-only">Search the knowledge hub</span>
          <MagnifyingGlass size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search, e.g. install, VPN, DLP"
            className="w-full rounded-[6px] border border-line-strong bg-surface py-3.5 pl-11 pr-10 text-[15px] text-fg placeholder:text-muted focus:border-brand focus:outline-none"
          />
          {q && (
            <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-fg">
              <X size={14} />
            </button>
          )}
        </label>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
          {[{ id: null as string | null, name: "All" }, ...groups].map((g) => (
            <button
              key={g.name}
              type="button"
              onClick={() => setOnly(g.id)}
              aria-pressed={only === g.id}
              className={`shrink-0 rounded-[6px] border px-3.5 py-2 text-sm transition-colors ${only === g.id ? "border-brand bg-brand text-on-brand" : "border-line bg-surface text-fg-2 hover:border-brand/50 hover:text-fg"}`}
            >
              {g.name}
            </button>
          ))}
        </div>
      </div>

      <p aria-live="polite" className="mt-6 font-mono text-[11px] uppercase tracking-[0.1em] text-muted">
        {q || only ? `${total} ${total === 1 ? "article" : "articles"}` : `${total} articles in ${groups.length} sections`}
      </p>

      {visible.length === 0 ? (
        <div className="mt-6 rounded-[6px] border border-dashed border-line-strong p-10 text-center">
          <p className="text-lg text-fg">No articles match “{q}”.</p>
          <p className="mt-2 text-sm text-muted">
            Try a shorter word, browse the <Link href="/faq" className="text-brand-ink underline underline-offset-4">FAQ</Link>, or{" "}
            <Link href="/contact" className="text-brand-ink underline underline-offset-4">ask the team</Link>.
          </p>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-px overflow-hidden rounded-[6px] border border-line bg-line md:grid-cols-2 xl:grid-cols-3">
          {visible.map((g, i) => (
            <section key={g.id} id={g.id} className={`scroll-mt-28 bg-bg p-6 md:p-8 ${i === visible.length - 1 ? lastRowSpan(visible.length) : ""}`}>
              <p className="font-mono text-[11px] text-brand-ink">{String(i + 1).padStart(2, "0")}</p>
              <h2 className="mt-3 text-[1.35rem] leading-tight tracking-[-0.02em] text-fg">{g.name}</h2>
              {g.body && <p className="mt-1.5 text-sm text-muted">{g.body}</p>}
              <ul className="mt-5 grid gap-1">
                {g.posts.map((p) => (
                  <li key={p.slug}>
                    <Link href={`/knowledge-hub/${p.slug}`} className="group -mx-3 flex items-start gap-3 rounded-[4px] px-3 py-2.5 transition-colors hover:bg-brand-soft">
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] leading-snug text-fg">{p.title}</span>
                        <span className="mt-0.5 line-clamp-2 text-[13px] text-muted">{p.excerpt}</span>
                      </span>
                      <ArrowRight size={13} className="mt-1 shrink-0 -translate-x-1 text-brand-ink opacity-0 transition-[opacity,transform] duration-200 group-hover:translate-x-0 group-hover:opacity-100" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
