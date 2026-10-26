"use client";

import { useState } from "react";
import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { contentApi } from "@/lib/api";
import { ExternalLink, FileText, Plus, Search, Star } from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import { KINDS, WEBSITE_URL, isKind } from "../kinds";

const TABS = [
  { key: "", label: "All", count: "all" },
  { key: "published", label: "Published", count: "published" },
  { key: "draft", label: "Drafts", count: "draft" },
] as const;

export default function ContentListPage() {
  const { kind } = useParams<{ kind: string }>();
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const cfg = isKind(kind) ? KINDS[kind] : null;

  const { data, isLoading } = useQuery({
    queryKey: ["content", cfg?.api, status, q],
    queryFn: () => contentApi.list({ kind: cfg!.api, status: status || undefined, q: q || undefined }).then((r) => r.data),
    enabled: !!cfg,
  });

  if (!cfg) notFound();

  const posts: any[] = data?.posts ?? [];
  const counts: Record<string, number> = data?.counts ?? {};

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="page-eyebrow">Website</p>
          <h2 className="mt-2 text-[2rem] font-normal leading-[1.1] tracking-[-0.035em] text-foreground">{cfg.label}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{cfg.blurb}</p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`${WEBSITE_URL}${cfg.sitePath}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ExternalLink className="h-4 w-4" /> View on site
          </a>
          <Link
            href={`/dashboard/content/${kind}/new`}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 font-mono text-[12px] font-medium uppercase tracking-[0.06em] text-primary-foreground transition-colors hover:bg-brand-600"
          >
            <Plus className="h-4 w-4" /> New {cfg.singular}
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg border border-border bg-card p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setStatus(t.key)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm transition-colors",
                status === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              <span className="ml-1.5 text-xs opacity-70">{counts[t.count] ?? 0}</span>
            </button>
          ))}
        </div>
        <label className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search title, slug or category"
            className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </label>
      </div>

      <div className="divide-y divide-border rounded-xl border border-border bg-card shadow-sm">
        {isLoading ? (
          [...Array(4)].map((_, i) => <div key={i} className="h-16 animate-pulse bg-muted/40" />)
        ) : posts.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground">
            <FileText className="mx-auto mb-2 h-8 w-8 opacity-30" />
            {q || status ? "Nothing matches" : `No ${cfg.singular}s yet`}
          </div>
        ) : (
          posts.map((p) => (
            <Link key={p.id} href={`/dashboard/content/${kind}/${p.id}`} className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-muted/30">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate font-medium text-foreground">
                  {p.featured && <Star className="h-3.5 w-3.5 flex-shrink-0 fill-brand-500 text-brand-500" />}
                  {p.title}
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {cfg.sitePath}/{p.slug}
                  {p.category && <> · {p.category}</>}
                  {p.reading_minutes ? <> · {p.reading_minutes} min read</> : null}
                </p>
              </div>
              <span
                className={cn(
                  "flex-shrink-0 rounded-[4px] px-2.5 py-1 text-xs font-medium",
                  p.status === "published" ? "bg-green-500/10 text-green-700" : "bg-muted text-muted-foreground",
                )}
              >
                {p.status === "published" ? "Published" : "Draft"}
              </span>
              <span className="hidden w-28 flex-shrink-0 text-right text-xs text-muted-foreground sm:block">
                Edited {formatDate(p.updated_at)}
              </span>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
