import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const ogSize = { width: 1200, height: 630 };

// The logo mark, inlined so the card needs no network fetch.
const mark = `data:image/png;base64,${readFileSync(join(process.cwd(), "public/brand/mark-192.png")).toString("base64")}`;

// A strip of orange "pixels" along the bottom, echoing the site's dithered terrain.
const PIXELS = Array.from({ length: 6 * 60 }, (_, i) => {
  const col = i % 60;
  const row = Math.floor(i / 60);
  const rise = col / 60;
  const on = (row + 1) / 6 > 1 - rise * 0.9 - ((col * 7 + row * 13) % 5) * 0.05;
  return on ? { x: col * 20, y: row * 20, o: 0.25 + rise * 0.75 } : null;
}).filter(Boolean) as { x: number; y: number; o: number }[];

/** Brand OG card in the site's light style: mark and name, eyebrow, big title. Used by every route. */
export function ogCard({ eyebrow, title }: { eyebrow: string; title: string }) {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#fafafa", color: "#0b0b0d", padding: "64px 72px", position: "relative" }}>
        <div style={{ position: "absolute", left: 40, top: 0, bottom: 0, width: 1, background: "rgba(11,11,13,0.1)", display: "flex" }} />
        <div style={{ position: "absolute", right: 40, top: 0, bottom: 0, width: 1, background: "rgba(11,11,13,0.1)", display: "flex" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={mark} alt="" width={56} height={56} />
          <div style={{ fontSize: 38, fontWeight: 700, letterSpacing: -1 }}>Aavishield</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 70 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 22, color: "#c2410c", letterSpacing: 3, textTransform: "uppercase" }}>
            <div style={{ width: 10, height: 10, background: "#ff7000", display: "flex" }} />
            {eyebrow}
          </div>
          <div style={{ fontSize: 66, fontWeight: 500, lineHeight: 1.04, letterSpacing: -2.5, maxWidth: 960, marginTop: 20 }}>{title}</div>
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 120, display: "flex" }}>
          {PIXELS.map((p) => (
            <div key={`${p.x}-${p.y}`} style={{ position: "absolute", left: p.x + 2, top: p.y + 2, width: 16, height: 16, background: `rgba(255,112,0,${p.o.toFixed(2)})`, display: "flex" }} />
          ))}
        </div>
      </div>
    ),
    ogSize,
  );
}
