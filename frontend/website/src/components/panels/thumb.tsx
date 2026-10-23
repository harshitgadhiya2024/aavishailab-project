"use client";

import { useEffect, useRef, useState } from "react";
import { StaticPanels } from "./panel";

const LAYOUT_WIDTH = 560; // the width every panel is laid out at
const MARGIN = 0.84; // share of the card the panel may fill, each way

/**
 * A product panel shown in a card's preview area, on the pixel grid. The
 * panel is laid out at a fixed width, then scaled so the whole of it fits
 * the card (by width or height, whichever is tighter) and centred, so tall
 * and short panels alike sit with even margins and nothing is cut off.
 * Cards are links, so the preview is inert and its switches are not buttons.
 */
export function PanelThumb({ panel, className = "relative aspect-[16/10]" }: { panel: React.ReactNode; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ s: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const b = box.current;
    const c = inner.current;
    if (!b || !c) return;
    const measure = () => {
      const cw = b.clientWidth;
      const ch = b.clientHeight;
      const h = c.offsetHeight || 1;
      const s = Math.min((cw * MARGIN) / LAYOUT_WIDTH, (ch * MARGIN) / h);
      setFit({ s, x: (cw - LAYOUT_WIDTH * s) / 2, y: (ch - h * s) / 2 });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(b);
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={box} aria-hidden inert className={`pixel-grid pointer-events-none overflow-hidden bg-brand-soft ${className}`}>
      <div
        ref={inner}
        className="absolute left-0 top-0 origin-top-left transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{
          width: LAYOUT_WIDTH,
          transform: fit ? `translate(${fit.x}px, ${fit.y}px) scale(${fit.s})` : undefined,
          opacity: fit ? 1 : 0,
        }}
      >
        <StaticPanels>{panel}</StaticPanels>
      </div>
    </div>
  );
}
