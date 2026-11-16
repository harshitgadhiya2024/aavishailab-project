"use client";

import { cn } from "@/lib/utils";

/*
 * The dashboard's one ranked-list style (Where sensitive data went, People
 * with the most incidents, Blocked websites, Blocked applications):
 *
 *   01  chat.deepseek.com              [11 PEOPLE]     214
 *       AI tools · Starter web policy                   45%
 *
 * A mono rank, the name with a detail line, an optional high-severity pill or
 * neutral tag, then the count with its share of the list's total. Text always
 * sits on white; rows are split by a hairline. No bars.
 */

export type RankedRow = {
  key: string;
  name: string;
  detail?: string;
  /** High-severity count, shown as a red pill. */
  high?: number;
  /** Neutral mono tag, e.g. "5 people". */
  tag?: string;
  count: number;
};

export function RankedList({ rows, total, empty }: { rows: RankedRow[]; total?: number; empty?: React.ReactNode }) {
  if (rows.length === 0) return <>{empty}</>;
  const sum = total ?? rows.reduce((s, r) => s + r.count, 0);
  return (
    <ul>
      {rows.map((r, i) => (
        <li key={r.key} className={cn("flex items-center gap-3 py-2.5", i > 0 && "border-t border-border")}>
          <span className="w-6 shrink-0 font-mono text-[11px] text-faint">{String(i + 1).padStart(2, "0")}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-medium text-foreground">{r.name}</span>
            {r.detail && <span className="block truncate text-[12px] text-subtle">{r.detail}</span>}
          </span>
          {!!r.high && (
            <span className="whitespace-nowrap rounded-[4px] bg-red-500/10 px-1.5 py-0.5 text-[11px] font-medium text-danger">{r.high} high-severity</span>
          )}
          {r.tag && (
            <span className="whitespace-nowrap rounded-[4px] border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground">{r.tag}</span>
          )}
          <span className="w-14 shrink-0 text-right">
            <span className="block [font-family:Satoshi,var(--font-inter),sans-serif] text-[15px] font-medium leading-tight tracking-[-0.02em] tabular-nums text-foreground">{r.count.toLocaleString()}</span>
            {sum > 0 && <span className="block font-mono text-[10.5px] text-faint">{Math.round((r.count / sum) * 100)}%</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Empty state for a dashboard box: a quiet icon, one line, and a next step. */
export function EmptyBox({ icon: Icon, title, body, action }: { icon: React.ElementType; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-md border border-dashed border-border px-4 py-6 text-center">
      <Icon className="h-5 w-5 text-faint" />
      <p className="mt-2 text-[13.5px] font-medium text-foreground">{title}</p>
      {body && <p className="mt-0.5 max-w-[42ch] text-[12.5px] text-muted-foreground">{body}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
