import type { Shot } from "@/lib/shots";
import { BrowserFrame } from "./browser-frame";
import { AgentTag, PixelPanel } from "./landing/visuals";
import { Reveal } from "./motion/reveal";
import { panelForShot } from "./panels";

/**
 * A console screen, shown the landing page's way on the orange pixel-grid
 * stage. By default the screen's product panel is shown; with `real` (the
 * Product tour) the actual screenshot is used, zoomed into its content area,
 * with an optional live widget card overlapping its lower corner.
 */
export function ScreenShowcase({
  shot,
  widget,
  tag,
  priority = false,
  real = false,
  panel: override,
}: {
  shot: Shot;
  widget?: React.ReactNode;
  tag?: string;
  priority?: boolean;
  real?: boolean;
  /** A specific panel to show instead of the screen's default one. */
  panel?: React.ReactNode;
}) {
  const panel = real ? undefined : (override ?? panelForShot(shot));
  if (panel) {
    return (
      <PixelPanel className="px-3 py-10 sm:px-8 sm:py-14 md:px-12 lg:px-20 lg:py-20">
        <AgentTag className="left-4 top-2 sm:left-8 sm:top-3">{tag ?? "Console view · demo data"}</AgentTag>
        <Reveal y={40} className="mx-auto max-w-[980px]">
          {panel}
        </Reveal>
      </PixelPanel>
    );
  }
  return (
    <PixelPanel className="px-3 pb-6 pt-10 sm:px-8 sm:py-12 md:px-12 lg:px-16 lg:py-16">
      <AgentTag className="left-4 top-2 sm:left-8 sm:top-3">{tag ?? "Real console · demo data"}</AgentTag>
      <Reveal y={40} className={widget ? "lg:mr-24" : ""}>
        <BrowserFrame shot={shot} priority={priority} sizes="(max-width: 1200px) 100vw, 1100px" />
      </Reveal>
      {widget && (
        <Reveal delay={0.3} y={24} className="relative z-10 mx-auto -mt-12 w-[calc(100%-1.5rem)] max-w-[360px] sm:absolute sm:bottom-6 sm:right-6 sm:mt-0 sm:w-[340px] lg:bottom-10 lg:right-10">
          {widget}
        </Reveal>
      )}
    </PixelPanel>
  );
}
