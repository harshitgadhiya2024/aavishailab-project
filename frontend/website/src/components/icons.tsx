import {
  AppWindow,
  Bug,
  FileMagnifyingGlass,
  GlobeHemisphereWest,
  Laptop,
  MonitorPlay,
  ShieldSlash,
} from "@phosphor-icons/react/dist/ssr";
import type { IconProps } from "@phosphor-icons/react";
import type { IconKey } from "@/lib/content";

const map = {
  globe: GlobeHemisphereWest,
  file: FileMagnifyingGlass,
  app: AppWindow,
  vpn: ShieldSlash,
  bug: Bug,
  device: Laptop,
  monitor: MonitorPlay,
} satisfies Record<IconKey, unknown>;

export function ModuleIcon({ icon, ...props }: { icon: IconKey } & IconProps) {
  const Icon = map[icon];
  return <Icon weight="light" {...props} />;
}
