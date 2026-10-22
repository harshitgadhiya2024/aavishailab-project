import Image from "next/image";
import type { Shot } from "@/lib/shots";

// Share of the screenshot's width taken by the console's own sidebar (which
// still carries the old logo). Without an explicit crop, the frame trims just
// that strip and shows the rest of the screen whole: full height, true scale.
const SIDEBAR = 0.17;

/**
 * A real console screenshot inside a minimal browser window, styled like the
 * landing page's UI cards (squared corners, warm shadow).
 *
 * By default the frame takes the screenshot's own proportions minus the
 * sidebar strip, so the image fits its container exactly with nothing
 * stretched or cut at the bottom. `crop` (origin in %, scale as a multiplier)
 * deliberately zooms into one region instead; `aspect` forces a frame shape.
 */
export function BrowserFrame({
  shot,
  sizes = "(max-width: 1024px) 100vw, 1100px",
  priority = false,
  className = "",
  crop,
  aspect,
  chrome = true,
}: {
  shot: Shot;
  sizes?: string;
  priority?: boolean;
  className?: string;
  crop?: { x: number; y: number; scale: number };
  aspect?: string;
  chrome?: boolean;
}) {
  const fit = !crop && !aspect;
  return (
    <figure className={`overflow-hidden rounded-[8px] border border-line-strong/70 bg-surface shadow-[0_30px_70px_-35px_rgb(120_50_0/0.45)] ${className}`}>
      {chrome && (
        <div className="flex h-9 items-center gap-3 border-b border-line bg-bg-2 px-3.5" aria-hidden>
          <span className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-[#ff5f57]" />
            <span className="size-2.5 rounded-full bg-[#febc2e]" />
            <span className="size-2.5 rounded-full bg-[#28c840]" />
          </span>
          <span className="mx-auto hidden max-w-[60%] truncate rounded-[4px] bg-surface px-3 py-0.5 font-mono text-[11px] text-muted sm:block">{shot.url}</span>
          <span className="w-10" />
        </div>
      )}
      {fit ? (
        // The frame is the screen minus the sidebar strip; the image is drawn
        // wider than the frame by exactly that strip and pinned right.
        <div className="skeleton relative overflow-hidden" style={{ aspectRatio: `${shot.w * (1 - SIDEBAR)} / ${shot.h}` }}>
          <Image
            src={shot.src}
            alt={shot.alt}
            width={shot.w}
            height={shot.h}
            sizes={sizes}
            {...(priority ? { preload: true } : { loading: "lazy" as const })}
            className="absolute right-0 top-0 h-full max-w-none"
            style={{ width: `${100 / (1 - SIDEBAR)}%` }}
          />
        </div>
      ) : (
        <div className={`skeleton relative overflow-hidden ${aspect ?? "aspect-[16/10]"}`}>
          <Image
            src={shot.src}
            alt={shot.alt}
            fill
            sizes={sizes}
            {...(priority ? { preload: true } : { loading: "lazy" as const })}
            className="object-cover object-left-top"
            style={crop ? { transform: `scale(${crop.scale})`, transformOrigin: `${crop.x}% ${crop.y}%` } : undefined}
          />
        </div>
      )}
    </figure>
  );
}
