import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

export function formatDate(d: string | Date): string {
  return new Date(d).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric"
  });
}

export function formatDateTime(d: string | Date): string {
  return new Date(d).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
  });
}

export function getInitials(name: string): string {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

/** Paise → "₹1,23,456" (or "₹1.2L" / "₹3.4Cr" when compact). */
export function formatINR(paise: number, compact = false): string {
  const rupees = (paise ?? 0) / 100;
  if (compact) {
    if (rupees >= 1e7) return `₹${(rupees / 1e7).toFixed(1)}Cr`;
    if (rupees >= 1e5) return `₹${(rupees / 1e5).toFixed(1)}L`;
    if (rupees >= 1e3) return `₹${(rupees / 1e3).toFixed(1)}K`;
  }
  return `₹${Math.round(rupees).toLocaleString("en-IN")}`;
}

export function timeAgo(d?: string | Date | null): string {
  if (!d) return "never";
  const mins = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(d);
}

export const PLAN_LABELS: Record<string, string> = {
  trial: "Trial", starter: "Starter", professional: "Professional", enterprise: "Enterprise",
};
export const STATUS_STYLES: Record<string, { label: string; dot: string; text: string }> = {
  active: { label: "Active", dot: "bg-green-500", text: "text-green-700" },
  trial: { label: "Trial", dot: "bg-sky-500", text: "text-sky-700" },
  suspended: { label: "Suspended", dot: "bg-red-500", text: "text-red-600" },
  inactive: { label: "Inactive", dot: "bg-zinc-500", text: "text-muted-foreground" },
};
