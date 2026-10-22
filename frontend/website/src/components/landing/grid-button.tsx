import type { Icon } from "@phosphor-icons/react";
import { ArrowRight, ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";

/** Squared mono button used across the site ("BOOK A DEMO →"). */
export function GridButton({
  href,
  children,
  variant = "solid",
  invert = false,
  icon,
  className = "",
}: {
  href: string;
  children: React.ReactNode;
  variant?: "solid" | "ghost";
  invert?: boolean;
  /** Trailing icon; defaults to an arrow. */
  icon?: Icon;
  className?: string;
}) {
  const external = href.startsWith("http") || href.startsWith("mailto:");
  const Trailing = icon ?? (external ? ArrowUpRight : ArrowRight);
  const look =
    variant === "solid"
      ? "bg-brand text-on-brand hover:bg-brand-dark"
      : invert
        ? "border border-ink-fg/25 text-ink-fg hover:bg-ink-fg/10"
        : "border border-fg/70 bg-bg text-fg hover:bg-bg-2";
  return (
    <Link
      href={href}
      className={`group/gb inline-flex h-10 items-center gap-2.5 whitespace-nowrap rounded-[6px] px-4 font-mono text-[12px] font-medium uppercase tracking-[0.06em] transition-[background-color,transform] duration-200 ease-out-expo active:scale-[0.97] ${look} ${className}`}
    >
      {children}
      <Trailing size={14} weight="bold" className="transition-transform duration-300 ease-out-expo group-hover/gb:translate-x-0.5" />
    </Link>
  );
}
