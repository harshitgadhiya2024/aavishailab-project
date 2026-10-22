"use client";

import { useState } from "react";
import type { PostSummary } from "@/lib/cms";

/** Category chips over the post grid. Cards are rendered by the server and passed in. */
export function BlogBrowser({ posts, cards }: { posts: PostSummary[]; cards: React.ReactNode[] }) {
  const categories = Array.from(new Set(posts.map((p) => p.category).filter(Boolean)));
  const [only, setOnly] = useState<string | null>(null);

  return (
    <div>
      {categories.length > 1 && (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
          {[null, ...categories].map((c) => (
            <button
              key={c ?? "all"}
              type="button"
              onClick={() => setOnly(c)}
              aria-pressed={only === c}
              className={`shrink-0 rounded-[6px] border px-3.5 py-2 text-sm transition-colors ${only === c ? "border-brand bg-brand text-on-brand" : "border-line bg-surface text-fg-2 hover:border-brand/50 hover:text-fg"}`}
            >
              {c ?? "All posts"}
            </button>
          ))}
        </div>
      )}
      <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {posts.map((p, i) => (only === null || p.category === only ? <div key={p.slug}>{cards[i]}</div> : null))}
      </div>
    </div>
  );
}
