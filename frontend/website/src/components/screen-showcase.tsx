import type { Shot } from "@/lib/shots";
import { BrowserFrame } from "./browser-frame";
import { AgentTag, PixelPanel } from "./landing/visuals";
import { Reveal } from "./motion/reveal";

/**
 * A real console screen, shown the landing page's way: on the orange
 * pixel-grid stage, zoomed into its content area, with an optional live
 * widget card overlapping its lower corner and a cursor tag.
 */
export function ScreenShowcase({
  shot,
  widget,
  tag = "Real console · demo data",
  priority = false,
}: {
  shot: Shot;
  widget?: React.ReactNode;
  tag?: string;
  priority?: boolean;
}) {
  return (
    <PixelPanel className="px-3 pb-6 pt-10 sm:px-8 sm:py-12 md:px-12 lg:px-16 lg:py-16">
      <AgentTag className="left-4 top-2 sm:left-8 sm:top-3">{tag}</AgentTag>
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
