"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * The console's one summary-number card — the dashboard's "Devices online"
 * layout, used everywhere a page shows a number:
 *
 *   [icon]  ▪ DEVICES ONLINE                    →
 *           13 of 14
 *           1 not seen for 7+ days
 *
 * An icon in a small bordered box; a mono uppercase label with a square
 * marker whose colour is the only signal (green fine, yellow warning, red
 * needs attention, orange new); a Satoshi value; one line of detail. With
 * `href` it is a link and shows an arrow on hover; with `onClick` it is a
 * filter and `selected` marks the active one.
 *
 * variant "card" stands alone in a row (bordered); "plain" sits inside a
 * section card that already has a border (the dashboard's Protection status).
 */

export type MetricTone = "neutral" | "good" | "warn" | "bad" | "brand";

const MARKER: Record<MetricTone, string> = {
  neutral: "bg-foreground/30",
  good: "bg-green-500",
  warn: "bg-yellow-500",
  bad: "bg-red-500",
  brand: "bg-brand-500",
};

type Props = {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  icon?: React.ElementType;
  tone?: MetricTone;
  href?: string;
  onClick?: () => void;
  selected?: boolean;
  variant?: "card" | "plain";
  /** Smaller value text, for long values like "All in order". */
  compact?: boolean;
  className?: string;
};

export function MetricCard({ label, value, detail, icon: Icon, tone = "neutral", href, onClick, selected, variant = "card", compact, className }: Props) {
  const interactive = !!href || !!onClick;
  const body = (
    <>
      {Icon && (
        <span className={cn(
          "grid h-9 w-9 shrink-0 place-items-center rounded-md border bg-background transition-colors",
          selected ? "border-brand-500/40 text-brand-500" : "border-border text-subtle",
          interactive && "group-hover:text-brand-500",
        )}>
          <Icon className="h-4 w-4" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">
          <span className={cn("h-1.5 w-1.5 shrink-0", MARKER[tone])} />
          <span className="truncate">{label}</span>
        </span>
        <span className={cn(
          "mt-1.5 block truncate [font-family:Satoshi,var(--font-inter),sans-serif] font-medium leading-tight tracking-[-0.02em] text-foreground tabular-nums",
          compact ? "text-[1.15rem]" : "text-[1.3rem]",
        )}>
          {value}
        </span>
        {detail != null && detail !== "" && <span className="mt-0.5 line-clamp-2 block text-[12px] leading-snug text-subtle">{detail}</span>}
      </span>
      {interactive && (
        <ArrowRight className={cn(
          "mt-1 h-3.5 w-3.5 shrink-0 text-brand-500 transition-[opacity,transform]",
          selected ? "opacity-100" : "opacity-0 group-hover:translate-x-0.5 group-hover:opacity-100",
        )} />
      )}
    </>
  );

  const shell = cn(
    "group flex w-full items-start gap-3 text-left transition-colors",
    variant === "card"
      ? cn("rounded-lg border bg-card p-3.5", selected ? "border-brand-500/50 bg-brand-500/[0.04] ring-1 ring-brand-500/20" : "border-border")
      : cn("rounded-md p-3", selected && "bg-brand-500/[0.06]"),
    interactive && !selected && "hover:bg-elevated",
    className,
  );

  if (href) return <Link href={href} className={shell}>{body}</Link>;
  if (onClick) return <button type="button" onClick={onClick} aria-pressed={selected} className={shell}>{body}</button>;
  return <div className={shell}>{body}</div>;
}

/**
 * A row of MetricCards. Fits as many as the width allows (each at least
 * 200px, enough for the icon and a full label), so three, four or five cards
 * share the row evenly on a desktop screen and
 * wrap cleanly on narrow screens. `cols` is kept for call sites that pass it.
 */
export function MetricRow({ children, className }: { children: React.ReactNode; cols?: 2 | 3 | 4 | 5; className?: string }) {
  return <div className={cn("grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3", className)}>{children}</div>;
}
