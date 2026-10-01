import Image from "next/image";
import type { Shot } from "@/lib/shots";

/**
 * A real console screenshot inside a minimal browser window. `crop` zooms
 * into one region (origin in %, scale as a multiplier) so a single capture
 * can also serve as a detail shot.
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
  return (
    <figure className={`overflow-hidden rounded-[18px] border border-line bg-surface shadow-[var(--shadow)] ${className}`}>
      {chrome && (
        <div className="flex h-9 items-center gap-3 border-b border-line bg-bg-2 px-3.5" aria-hidden>
          <span className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-[#ff5f57]" />
            <span className="size-2.5 rounded-full bg-[#febc2e]" />
            <span className="size-2.5 rounded-full bg-[#28c840]" />
          </span>
          <span className="mx-auto hidden max-w-[60%] truncate rounded-md bg-surface px-3 py-0.5 font-mono text-[11px] text-muted sm:block">{shot.url}</span>
          <span className="w-10" />
        </div>
      )}
      <div className={`skeleton relative overflow-hidden ${aspect ?? ""}`} style={aspect ? undefined : { aspectRatio: `${shot.w} / ${shot.h}` }}>
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
    </figure>
  );
}
