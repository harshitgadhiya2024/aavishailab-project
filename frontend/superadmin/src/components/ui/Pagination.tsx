"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

type PaginationProps = {
  page: number;
  totalPages: number;
  total: number;
  /** Rows per page, used for the "showing X-Y of Z" summary. */
  limit: number;
  onPageChange: (page: number) => void;
  /** Supply to render the rows-per-page selector. */
  onLimitChange?: (limit: number) => void;
  limitOptions?: number[];
  className?: string;
};

/**
 * Page numbers with ellipses, always keeping first/last reachable so a jump to
 * the end of a long log doesn't need repeated Next clicks.
 * 7 pages -> 1 2 3 4 5 6 7 ; 20 pages on page 9 -> 1 … 8 9 10 … 20
 */
function pageItems(page: number, totalPages: number): (number | "gap")[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const items: (number | "gap")[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);

  if (start > 2) items.push("gap");
  for (let p = start; p <= end; p++) items.push(p);
  if (end < totalPages - 1) items.push("gap");
  items.push(totalPages);

  return items;
}

export function Pagination({
  page,
  totalPages,
  total,
  limit,
  onPageChange,
  onLimitChange,
  limitOptions = [10, 20, 50],
  className,
}: PaginationProps) {
  // With a rows-per-page selector the bar stays useful on a single page —
  // that's how you switch from 10 rows to 50. Without one, a single page has
  // nothing to offer, so it stays hidden as before.
  if (total === 0) return null;
  if (totalPages <= 1 && !onLimitChange) return null;

  const first = (page - 1) * limit + 1;
  const last = Math.min(page * limit, total);
  const arrow =
    "p-1.5 rounded border border-border text-foreground disabled:opacity-30 disabled:cursor-not-allowed hover:bg-muted transition-colors";

  return (
    <div
      className={cn(
        "px-5 py-3 border-t border-border flex flex-wrap items-center justify-between gap-3",
        className
      )}
    >
      <p className="text-xs text-muted-foreground tabular-nums">
        Showing <span className="text-foreground">{first}</span>–<span className="text-foreground">{last}</span> of{" "}
        <span className="text-foreground">{total.toLocaleString()}</span>
      </p>

      <div className="flex items-center gap-3">
        {onLimitChange && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Rows
            <select
              value={limit}
              onChange={e => onLimitChange(Number(e.target.value))}
              aria-label="Rows per page"
              className="bg-background border border-border rounded px-1.5 py-1 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {limitOptions.map(option => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        )}

        {totalPages > 1 && (
        <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page === 1}
          aria-label="Previous page"
          className={arrow}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        {pageItems(page, totalPages).map((item, i) =>
          item === "gap" ? (
            <span key={`gap-${i}`} className="px-1.5 text-xs text-muted-foreground select-none">
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              onClick={() => onPageChange(item)}
              aria-label={`Page ${item}`}
              aria-current={item === page ? "page" : undefined}
              className={cn(
                "min-w-[32px] h-8 px-2 rounded text-xs font-medium tabular-nums border transition-colors",
                item === page
                  ? "bg-brand-500 border-brand-500 text-white"
                  : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {item}
            </button>
          )
        )}

        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          aria-label="Next page"
          className={arrow}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        </div>
        )}
      </div>
    </div>
  );
}
