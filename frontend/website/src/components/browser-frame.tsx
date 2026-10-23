import Image from "next/image";
import { sidebarShare, type Shot } from "@/lib/shots";

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
  // Without an explicit crop, the frame trims the console sidebar (which still
  // carries the old logo) and shows the rest of the screen whole, at true scale.
  const side = sidebarShare(shot);
  // The image is drawn wider than the frame by the cropped strip, so each size
  // in `sizes` is scaled up to match; otherwise the browser fetches too small
  // a file and stretches it.
  const drawnSizes = side
    ? sizes
        .split(",")
        .map((part) => part.trim().replace(/(d+(?:.d+)?)(px|vw)$/, (_, n, u) => `${Math.ceil(Number(n) / (1 - side))}${u}`))
        .join(", ")
    : sizes;
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
        <div className="skeleton relative overflow-hidden" style={{ aspectRatio: `${shot.w * (1 - side)} / ${shot.h}` }}>
          <Image
            src={shot.src}
            alt={shot.alt}
            width={shot.w}
            height={shot.h}
            sizes={drawnSizes}
            {...(priority ? { preload: true } : { loading: "lazy" as const })}
            className="absolute right-0 top-0 h-full max-w-none"
            quality={90}
            style={{ width: `${100 / (1 - side)}%` }}
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
            quality={90}
            style={crop ? { transform: `scale(${crop.scale})`, transformOrigin: `${crop.x}% ${crop.y}%` } : undefined}
          />
        </div>
      )}
    </figure>
  );
}
