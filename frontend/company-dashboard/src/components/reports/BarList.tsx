import { cn } from "@/lib/utils";

/**
 * Ranked list with an inline magnitude bar. Reads better than a horizontal
 * bar chart for long names (domains, apps, people) and prints cleanly.
 */
export function BarList({
  items, color = "bg-brand-500/15", empty = "Nothing in this period", format = (n: number) => n.toLocaleString(),
}: {
  items: { label: string; value: number; sub?: string; tag?: { text: string; tone: string } }[];
  color?: string;
  empty?: string;
  format?: (n: number) => string;
}) {
  if (items.length === 0) {
    return <p className="py-8 text-center text-sm text-subtle">{empty}</p>;
  }
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="space-y-1.5">
      {items.map((it) => (
        <li key={it.label} className="relative overflow-hidden rounded-md">
          <div className={cn("absolute inset-y-0 left-0 rounded-md", color)} style={{ width: `${(it.value / max) * 100}%` }} />
          <div className="relative flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <span className="min-w-0 truncate text-foreground" title={it.label}>
              {it.label}
              {it.sub && <span className="ml-2 text-xs text-subtle">{it.sub}</span>}
            </span>
            <span className="flex flex-shrink-0 items-center gap-2">
              {it.tag && <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", it.tag.tone)}>{it.tag.text}</span>}
              <span className="tabular-nums font-medium text-foreground">{format(it.value)}</span>
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
