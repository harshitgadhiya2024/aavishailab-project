import type { ReactNode } from "react";
import { B, CYCLE, Field, Label, Packet, Px, W, ease, frac, r, span } from "./pixel-kit";
import { MARK } from "./wordmark";

/*
 * Web Gateway "Under the hood" as one continuous story across three cells,
 * in the site's own pixel language (the orange pixel grid and dither field):
 *   Intercept: a request arrives as a pixel packet tagged with its domain,
 *              streams into the Aavishield mark, then leaves for the next cell;
 *   Decide:    the same packet meets a pixel policy gate and either dissolves
 *              into orange dither (blocked) or passes straight through;
 *   Record:    that decision lands as the newest log line, pushing older ones up.
 * All three read one shared clock `t` (seconds), so a single request can be
 * followed from cell to cell. Each request takes CYCLE seconds.
 */

const REQUESTS = [
  { d: "instagram.com", blocked: true, cat: "Social media", who: "Rohan" },
  { d: "docs.google.com", blocked: false, cat: "Productivity", who: "Priya" },
  { d: "chat.deepseek.com", blocked: true, cat: "AI tools", who: "Arjun" },
  { d: "github.com", blocked: false, cat: "Developer", who: "Meera" },
];
const at = (t: number) => {
  const n = Math.floor(t / CYCLE);
  return { n, p: frac(t / CYCLE), req: REQUESTS[((n % REQUESTS.length) + REQUESTS.length) % REQUESTS.length] };
};

/* ── 01 Intercept ─────────────────────────────────────────────────────── */

export function wgIntercept(t: number): ReactNode {
  const { p, req } = at(t);
  const inP = span(p, 0, 0.3); // packet travels to the mark
  const outP = span(p, 0.33, 0.48); // a packet leaves for the next cell
  const caught = p > 0.28 && p < 0.42;
  const s = 64 / 190; // the mark drawn 64 units tall (its full height is 190)
  return (
    <>
      <Field />
      {/* lanes into the mark */}
      {[76, 100, 124].map((y) => <line key={y} x1={0} y1={y} x2={74} y2={y} stroke={W} strokeOpacity={0.08} strokeDasharray="2 4" />)}
      <line x1={126} y1={100} x2={200} y2={100} stroke={W} strokeOpacity={0.08} strokeDasharray="2 4" />
      {/* ring of pixels that pulses when a request is caught */}
      {Array.from({ length: 20 }, (_, i) => {
        const a = (i / 20) * Math.PI * 2;
        const rad = 44 + (caught ? 4 : 0);
        return <Px key={i} x={100 + Math.cos(a) * rad} y={100 + Math.sin(a) * rad} s={2.5} c={caught && i % 2 === 0 ? B : W} o={caught ? 0.8 : 0.22} />;
      })}
      <g transform={`translate(100 100) scale(${r(s)}) translate(-536.7 -540)`}>
        <path d={MARK} fill={caught ? B : W} fillOpacity={caught ? 1 : 0.9} style={{ transition: "fill .25s" }} />
      </g>
      {/* incoming request */}
      {inP > 0 && inP < 1 && (
        <>
          <Packet x={6 + ease(inP) * 62} y={100} o={Math.min(1, inP * 5)} />
          <Label x={6} y={86} anchor="start" o={0.85 * (1 - inP * 0.6)}>{req.d}</Label>
        </>
      )}
      {/* background chatter on the other lanes */}
      {[76, 124].map((y, k) => {
        const q = frac(t * 0.33 + k * 0.5);
        return <Packet key={y} x={6 + q * 62} y={y} o={0.28 * (q < 0.9 ? 1 : (1 - q) * 10)} />;
      })}
      {/* handed on to Decide */}
      {outP > 0 && outP < 1 && <Packet x={128 + ease(outP) * 74} y={100} o={1} />}
      <Label x={100} y={178} o={0.45}>local HTTPS proxy</Label>
    </>
  );
}

/* ── 02 Decide ────────────────────────────────────────────────────────── */

// Fixed burst directions for the dither dissolve.
const BURST = Array.from({ length: 18 }, (_, i) => ({ a: (i / 18) * Math.PI * 2 + (i % 3) * 0.2, d: 18 + (i % 5) * 9 }));

export function wgDecide(t: number): ReactNode {
  const { p, req } = at(t);
  const gateX = 112;
  const inP = span(p, 0.45, 0.62); // enters and reaches the gate
  const verdict = p >= 0.62;
  const passP = span(p, 0.62, 0.8);
  const burstP = span(p, 0.62, 0.86);
  const x = 0 + ease(inP) * (gateX - 8);
  return (
    <>
      <Field />
      <line x1={0} y1={100} x2={200} y2={100} stroke={W} strokeOpacity={0.08} strokeDasharray="2 4" />
      {/* the policy gate: a column of pixels; its centre turns orange on a block */}
      {Array.from({ length: 13 }, (_, i) => {
        const y = 52 + i * 8;
        const hot = verdict && req.blocked && Math.abs(y - 100) < 14 && burstP < 0.9;
        return <Px key={i} x={gateX} y={y} s={4} c={hot ? B : W} o={hot ? 1 : 0.35 + (i % 2) * 0.15} />;
      })}
      <Label x={gateX} y={40} o={0.45}>signed policy</Label>

      {inP > 0 && !verdict && (
        <>
          <Packet x={x} y={100} />
          <Label x={Math.max(34, x)} y={86} o={0.85}>{req.d}</Label>
        </>
      )}

      {verdict && req.blocked && burstP < 1 && (
        <>
          {BURST.map((b, i) => (
            <Px key={i} x={gateX - 8 + Math.cos(b.a) * b.d * ease(burstP)} y={100 + Math.sin(b.a) * b.d * ease(burstP)} s={3.5} c={i % 4 === 0 ? W : B} o={1 - burstP} />
          ))}
          <Label x={gateX} y={156} c={B} o={1 - Math.max(0, burstP - 0.6) * 2.5}>BLOCKED · {req.cat.toUpperCase()}</Label>
        </>
      )}

      {verdict && !req.blocked && passP < 1 && (
        <>
          <Packet x={gateX + 8 + ease(passP) * 84} y={100} />
          <Label x={gateX} y={156} o={0.85 * (1 - Math.max(0, passP - 0.6) * 2.5)}>ALLOWED · {req.cat.toUpperCase()}</Label>
        </>
      )}
    </>
  );
}

/* ── 03 Record ────────────────────────────────────────────────────────── */

export function wgRecord(t: number): ReactNode {
  const { n, p } = at(t);
  const arrive = span(p, 0.8, 0.95); // the newest decision lands
  const shift = arrive; // older lines move up as it lands
  const rows = 6;
  const gap = 20;
  return (
    <>
      <Field />
      <rect x={14} y={30} width={172} height={144} rx={6} fill="none" stroke={W} strokeOpacity={0.14} />
      <Label x={24} y={46} anchor="start" o={0.45}>CONSOLE · ACTIVITY</Label>
      <line x1={14} y1={54} x2={186} y2={54} stroke={W} strokeOpacity={0.1} />
      {Array.from({ length: rows }, (_, k) => {
        // k = 0 is the request being decided now; it appears only once it lands.
        const id = n - k;
        const req = REQUESTS[((id % REQUESTS.length) + REQUESTS.length) % REQUESTS.length];
        const fresh = k === 0;
        const y = 158 - (k - 1 + shift) * gap;
        const o = fresh ? arrive : Math.max(0, 1 - (k - 1 + shift) / (rows - 1));
        if (y < 64 || o <= 0) return null;
        const c = req.blocked ? B : W;
        return (
          <g key={id} opacity={r(o)}>
            {[0, 1, 2].map((q) => <Px key={q} x={26 + q * 5} y={y} s={3.5} c={c} o={fresh ? 1 : 0.7 - q * 0.15} />)}
            <Label x={44} y={y + 3} anchor="start" o={fresh ? 1 : 0.7}>{req.d}</Label>
            <Label x={178} y={y + 3} anchor="end" c={c} o={fresh ? 1 : 0.6}>{req.blocked ? "BLOCKED" : "ALLOWED"}</Label>
          </g>
        );
      })}
    </>
  );
}
