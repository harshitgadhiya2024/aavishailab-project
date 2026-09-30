import { FileWarning, Globe, AppWindow, ShieldOff, Bug, MonitorCheck, type LucideIcon } from "lucide-react";
import type { ChartTheme } from "@/lib/chart-theme";

/** The six controls every incident is grouped by (IDs match the API). */
export type ControlId = "dlp" | "web" | "apps" | "vpn" | "threats" | "devices";

export const CONTROLS: { id: ControlId; label: string; icon: LucideIcon; href: string }[] = [
  { id: "dlp", label: "Data protection", icon: FileWarning, href: "/dashboard/dlp" },
  { id: "web", label: "Web filtering", icon: Globe, href: "/dashboard/swg" },
  { id: "apps", label: "App control", icon: AppWindow, href: "/dashboard/applications" },
  { id: "vpn", label: "VPN & bypass", icon: ShieldOff, href: "/dashboard/activity" },
  { id: "threats", label: "Malware & threats", icon: Bug, href: "/dashboard/activity" },
  { id: "devices", label: "Device health", icon: MonitorCheck, href: "/dashboard/devices" },
];

/**
 * Series colour per control. The categorical palette is validated for five
 * series in this order; device health is the least urgent and takes neutral.
 */
export function controlColor(chart: ChartTheme, id: ControlId): string {
  const i = CONTROLS.findIndex((c) => c.id === id);
  return i >= 0 && i < 5 ? chart.categorical[i] : chart.neutral;
}
