import {
  Bank,
  Briefcase,
  ClipboardText,
  Code,
  FishSimple,
  Headset,
  Heartbeat,
  Hourglass,
  HouseLine,
  Robot,
  RocketLaunch,
  SquaresFour,
  ShieldSlash,
  UserMinus,
} from "@phosphor-icons/react/dist/ssr";
import type { IconProps } from "@phosphor-icons/react";
import type { SolutionIconKey } from "@/lib/solutions";

const map = {
  robot: Robot,
  house: HouseLine,
  userMinus: UserMinus,
  clipboard: ClipboardText,
  squares: SquaresFour,
  tunnel: ShieldSlash,
  fish: FishSimple,
  hourglass: Hourglass,
  briefcase: Briefcase,
  code: Code,
  bank: Bank,
  heart: Heartbeat,
  headset: Headset,
  rocket: RocketLaunch,
} satisfies Record<SolutionIconKey, unknown>;

export function SolutionIcon({ icon, ...props }: { icon: SolutionIconKey } & IconProps) {
  const Icon = map[icon];
  return <Icon weight="light" {...props} />;
}
