"use client";

import { useTheme } from "next-themes";

/**
 * Recharts writes colours straight into SVG attributes, so it can't read the
 * CSS custom properties the rest of the UI themes with. This hook hands back
 * concrete values for the active theme instead.
 */
export type ChartTheme = {
  grid: string;
  axis: string;
  tooltip: React.CSSProperties;
  /** Fill per activity action, keyed the same way the API reports them. */
  action: Record<string, string>;
  /** Fallback fill for an unrecognised action. */
  neutral: string;
  brand: string;
  /**
   * Categorical series colours, assigned in this fixed order and never cycled.
   * Validated for colour-blind separation on both surfaces (adjacent-pair CVD
   * ΔE 9.1 light / 8.4 dark, normal-vision floor 19.6 / 19.3) — re-run the
   * validator before changing any step, since the ORDER is what makes it safe.
   */
  categorical: string[];
  /** Single-hue ramp for magnitude (bars, ranked lists), light -> dark. */
  sequential: string[];
};

const DARK: ChartTheme = {
  grid: "#262626",
  axis: "#6B6B6B",
  tooltip: {
    background: "#141414",
    border: "1px solid #262626",
    borderRadius: 8,
    color: "#F5F5F5",
  },
  action: {
    blocked: "#f87171",
    alerted: "#fbbf24",
    allowed: "#4ade80",
    monitored: "#60a5fa",
  },
  neutral: "#6B6B6B",
  brand: "#FF7000",
  categorical: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181"],
  sequential: ["#104281", "#184f95", "#256abf", "#2a78d6", "#3987e5", "#5598e7", "#6da7ec", "#86b6ef"],
};

const LIGHT: ChartTheme = {
  grid: "#E5E7EB",
  axis: "#6B7280",
  tooltip: {
    background: "#FFFFFF",
    border: "1px solid #E5E7EB",
    borderRadius: 8,
    color: "#111827",
  },
  action: {
    blocked: "#dc2626",
    alerted: "#d97706",
    allowed: "#16a34a",
    monitored: "#2563eb",
  },
  neutral: "#6B7280",
  brand: "#FF7000",
  categorical: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"],
  sequential: ["#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7", "#3987e5", "#2a78d6"],
};

export function useChartTheme(): ChartTheme {
  const { resolvedTheme } = useTheme();
  return resolvedTheme === "light" ? LIGHT : DARK;
}
