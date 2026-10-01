import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const ogSize = { width: 1200, height: 630 };

// The white-wordmark lockup with tagline, inlined so the card needs no network fetch.
const logo = `data:image/png;base64,${readFileSync(join(process.cwd(), "public/brand/logo-horizontal-tagline-dark.png")).toString("base64")}`;

/** Brand OG card: near-black, Aavishield logo, big title. Used by every route. */
export function ogCard({ eyebrow, title }: { eyebrow: string; title: string }) {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#09090b", color: "#f4f4f5", padding: 72, position: "relative" }}>
        <div style={{ position: "absolute", right: -160, top: -160, width: 560, height: 560, borderRadius: 9999, background: "radial-gradient(circle, rgba(255,112,0,0.55), rgba(255,112,0,0) 65%)", display: "flex" }} />
        <div style={{ position: "absolute", right: 120, top: 150, width: 300, height: 300, borderRadius: 9999, border: "2px solid rgba(255,112,0,0.6)", display: "flex" }} />
        <div style={{ display: "flex", alignItems: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logo} alt="Aavishield" width={360} height={120} />
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 26, color: "#ff8a2b", marginBottom: 18 }}>{eyebrow}</div>
          <div style={{ fontSize: 68, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2, maxWidth: 900 }}>{title}</div>
        </div>
      </div>
    ),
    ogSize,
  );
}
