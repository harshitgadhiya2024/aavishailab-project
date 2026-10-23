import type { ReactNode } from "react";
import { Arrive, B, Console, Dissolve, Field, Guide, HandOff, Label, Packet, PixelRect, Px, W, cycleOf, ease, frac, r, span } from "./pixel-kit";

/*
 * "Under the hood" pixel stories for every control except Web Gateway (see
 * wg-story.tsx). Each follows one item per cycle across its three cells, in
 * the phases described in pixel-kit.tsx. Names and values are demo data.
 */

type Scene = (t: number) => ReactNode;

/* ── Data Loss Prevention: Capture, Inspect, Report ───────────────────── */

const FILES = [
  { f: "Q3-salaries.xlsx", to: "ChatGPT", found: "SALARY DATA" },
  { f: "brochure.pdf", to: "Gmail", found: "" },
  { f: "deploy.env", to: "Teams", found: "API KEY" },
  { f: "IMG_2041.jpg", to: "WhatsApp", found: "AADHAAR · OCR" },
];

// A document drawn in pixels: a folded corner and rows of text.
function PixelDoc({ x, y, rows = 5, hot = [] as number[], scan = -1, c = W }: { x: number; y: number; rows?: number; hot?: number[]; scan?: number; c?: string }) {
  return (
    <>
      <PixelRect x={x} y={y} w={42} h={rows * 9 + 12} c={c} o={0.75} />
      {Array.from({ length: rows }, (_, i) => {
        const yy = y + 10 + i * 9;
        const lit = hot.includes(i) && scan >= i;
        return Array.from({ length: 6 - (i % 2) }, (_, k) => <Px key={`${i}-${k}`} x={x + 8 + k * 5.5} y={yy} s={3} c={lit ? B : W} o={lit ? 1 : 0.4} />);
      })}
    </>
  );
}

const dlpCapture: Scene = (t) => {
  const { p, item } = cycleOf(FILES, t);
  const up = span(p, 0.05, 0.3);
  return (
    <>
      <Field />
      <PixelDoc x={30} y={72} />
      <Label x={51} y={142} o={0.85}>{item.f}</Label>
      <Guide x1={76} y1={96} x2={124} y2={74} />
      <PixelRect x={124} y={52} w={54} h={34} o={0.6} />
      <Label x={151} y={72} o={0.6}>DLP SCAN</Label>
      {up > 0 && up < 1 && <Packet x={76 + ease(up) * 48} y={96 - ease(up) * 22} />}
      <HandOff p={p} from={150} y={100} />
      <Label x={100} y={178} o={0.45}>{`upload to ${item.to}`}</Label>
    </>
  );
};

const dlpInspect: Scene = (t) => {
  const { p, item } = cycleOf(FILES, t);
  const scan = span(p, 0.62, 0.84) * 6 - 1;
  const done = p > 0.84;
  const hit = !!item.found;
  return (
    <>
      <Field />
      <Arrive p={p} to={70} label={item.f} />
      {p >= 0.6 && (
        <>
          <PixelDoc x={78} y={64} rows={6} hot={hit ? [1, 3] : []} scan={scan} />
          {!done && <line x1={70} y1={r(74 + Math.max(0, scan) * 9)} x2={128} y2={r(74 + Math.max(0, scan) * 9)} stroke={B} strokeOpacity={0.9} />}
          {done && <Label x={100} y={156} c={hit ? B : W} o={0.95}>{hit ? `FOUND · ${item.found}` : "NO FINDING"}</Label>}
        </>
      )}
      <Label x={100} y={40} o={0.45}>patterns · OCR · AI</Label>
    </>
  );
};

const dlpReport: Scene = (t) => {
  const { n, p, nth } = cycleOf(FILES, t);
  return (
    <>
      <Field />
      <Console title="CONSOLE · DLP" n={n} p={p} row={(k) => { const d = nth(k); return { text: d.f, tag: d.found ? "FLAGGED" : "CLEAN", hot: !!d.found }; }} />
    </>
  );
};

/* ── Application Control: Inventory, Target, Enforce ──────────────────── */

const APPS = [
  { a: "AnyDesk", rule: "BLOCK · EVERYONE", blocked: true },
  { a: "Slack", rule: "", blocked: false },
  { a: "uTorrent", rule: "BLOCK · EVERYONE", blocked: true },
  { a: "Figma", rule: "", blocked: false },
];

// An app icon as a 3×3 block of pixels with a hole in the middle.
const AppTile = ({ x, y, c = W, o = 0.9 }: { x: number; y: number; c?: string; o?: number }) => (
  <>{[0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => (i === 1 && j === 1 ? null : <Px key={`${i}${j}`} x={x - 6 + i * 6} y={y - 6 + j * 6} s={5} c={c} o={o} />)))}</>
);

const appInventory: Scene = (t) => {
  const { p, item, nth } = cycleOf(APPS, t);
  const pop = span(p, 0.05, 0.28);
  return (
    <>
      <Field />
      <PixelRect x={24} y={78} w={48} h={32} o={0.75} />
      <line x1={18} y1={118} x2={78} y2={118} stroke={W} strokeOpacity={0.7} strokeWidth={2} />
      <Label x={48} y={136} o={0.5}>INVENTORY</Label>
      {/* apps already reported, stacked to the right */}
      {[1, 2, 3].map((k) => <g key={k} opacity={r(0.5 - k * 0.12)}><AppTile x={110} y={56 + k * 26} /><Label x={126} y={60 + k * 26} anchor="start" o={0.6}>{nth(k).a}</Label></g>)}
      {pop > 0 && (
        <g opacity={r(Math.min(1, pop * 3))}>
          <AppTile x={48 + ease(pop) * 62} y={94 - ease(pop) * 38} />
          <Label x={126} y={60} anchor="start" o={pop}>{item.a}</Label>
        </g>
      )}
      <HandOff p={p} from={120} y={100} />
    </>
  );
};

const appTarget: Scene = (t) => {
  const { p, item } = cycleOf(APPS, t);
  const show = p >= 0.6;
  const frame = span(p, 0.62, 0.74);
  return (
    <>
      <Field />
      <Arrive p={p} to={92} label={item.a} />
      {show && (
        <>
          <AppTile x={100} y={100} c={item.blocked ? B : W} />
          {item.blocked && <PixelRect x={100 - 20 + (1 - frame) * -10} y={80 + (1 - frame) * -10} w={40 + (1 - frame) * 20} h={40 + (1 - frame) * 20} c={B} o={0.9} />}
          <Label x={100} y={150} c={item.blocked ? B : W} o={0.95}>{item.blocked ? item.rule : "NO RULE · ALLOWED"}</Label>
        </>
      )}
      <Label x={100} y={40} o={0.45}>policy rule</Label>
    </>
  );
};

const appEnforce: Scene = (t) => {
  const { p, item } = cycleOf(APPS, t);
  const k = span(p, 0.8, 0.98);
  const launch = span(p, 0.8, 0.86);
  return (
    <>
      <Field />
      <PixelRect x={60} y={60} w={80} h={66} o={0.35} />
      <Label x={100} y={48} o={0.45}>DEVICE</Label>
      {p >= 0.78 && (
        <>
          <circle cx={100} cy={93} r={r(14 + launch * 22)} fill="none" stroke={W} strokeOpacity={r((1 - launch) * 0.5)} />
          {item.blocked ? (
            <>
              {k < 0.35 && <AppTile x={100} y={93} />}
              <Dissolve x={100} y={93} k={(k - 0.3) / 0.7} />
              <Label x={100} y={150} c={B} o={k > 0.2 ? 1 : 0}>{`LAUNCH BLOCKED · ${item.a}`}</Label>
            </>
          ) : (
            <>
              <AppTile x={100} y={93} />
              <Label x={100} y={150} o={k > 0.2 ? 0.9 : 0}>{`RUNNING · ${item.a}`}</Label>
            </>
          )}
        </>
      )}
    </>
  );
};

/* ── VPN Control: Recognise, Block, Surface ───────────────────────────── */

const VPNS = [
  { v: "NordVPN", kind: "VPN CLIENT", match: true, who: "Rohan" },
  { v: "Zoom", kind: "", match: false, who: "Priya" },
  { v: "proxy extension", kind: "EXTENSION", match: true, who: "Arjun" },
  { v: "protonvpn-setup.exe", kind: "INSTALLER", match: true, who: "Meera" },
];

const vpnRecognise: Scene = (t) => {
  const { p, item } = cycleOf(VPNS, t);
  const scan = span(p, 0.05, 0.28);
  const rows = 6;
  const matchRow = 2;
  return (
    <>
      <Field />
      <Label x={100} y={40} o={0.45}>known VPN list</Label>
      {Array.from({ length: rows }, (_, i) => {
        const y = 56 + i * 16;
        const hit = item.match && i === matchRow && scan >= 0.6;
        return <g key={i}>{Array.from({ length: 12 }, (_, k) => <Px key={k} x={58 + k * 7} y={y} s={4} c={hit ? B : W} o={hit ? 1 : 0.18} />)}</g>;
      })}
      {scan > 0 && scan < 1 && <line x1={50} y1={r(52 + scan * 92)} x2={150} y2={r(52 + scan * 92)} stroke={B} strokeOpacity={0.8} />}
      <Label x={100} y={164} c={item.match ? B : W} o={scan >= 0.6 ? 0.95 : 0}>{item.match ? `MATCH · ${item.kind}` : "NO MATCH"}</Label>
      <Label x={100} y={178} o={0.6}>{item.v}</Label>
      <HandOff p={p} from={150} y={100} c={item.match ? B : W} />
    </>
  );
};

const vpnBlock: Scene = (t) => {
  const { p, item } = cycleOf(VPNS, t);
  const k = span(p, 0.62, 0.86);
  const pass = span(p, 0.62, 0.8);
  return (
    <>
      <Field />
      <PixelRect x={14} y={84} w={30} h={30} o={0.7} />
      {[0, 1].map((i) => <line key={i} x1={44} y1={90 + i * 18} x2={200} y2={90 + i * 18} stroke={W} strokeOpacity={0.25} />)}
      <Label x={120} y={70} o={0.45}>tunnel</Label>
      <Arrive p={p} to={112} y={99} label={item.v} />
      {p >= 0.62 && item.match && (
        <>
          {Array.from({ length: 7 }, (_, i) => <Px key={i} x={122} y={80 + i * 7} s={4} c={B} o={k < 0.9 ? 1 : (1 - k) * 10} />)}
          <Dissolve x={116} y={99} k={k} />
          <Label x={120} y={150} c={B} o={1 - Math.max(0, k - 0.7) * 3}>BLOCKED ON THE DEVICE</Label>
        </>
      )}
      {p >= 0.62 && !item.match && pass < 1 && (
        <>
          <Packet x={112 + ease(pass) * 90} y={99} />
          <Label x={120} y={150} o={0.85 * (1 - Math.max(0, pass - 0.6) * 2.5)}>NOT A VPN · ALLOWED</Label>
        </>
      )}
    </>
  );
};

const vpnSurface: Scene = (t) => {
  const { n, p, nth } = cycleOf(VPNS, t);
  return (
    <>
      <Field />
      <Console title="CONSOLE · BYPASS ATTEMPTS" n={n} p={p} row={(k) => { const d = nth(k); return { text: d.v, tag: d.match ? "BLOCKED" : "ALLOWED", hot: d.match }; }} />
    </>
  );
};

/* ── Malware Scanning: Stream, Score, Release ─────────────────────────── */

const DOWNLOADS = [
  { f: "invoice_0932.zip", risk: 94 },
  { f: "brochure.pdf", risk: 4 },
  { f: "crack-setup.exe", risk: 91 },
  { f: "q3-report.xlsx", risk: 8 },
];

const malStream: Scene = (t) => {
  const { p, item } = cycleOf(DOWNLOADS, t);
  const beam = frac(t * 0.9);
  return (
    <>
      <Field />
      <Label x={100} y={34} o={0.85}>{item.f}</Label>
      <line x1={100} y1={40} x2={100} y2={58} stroke={W} strokeOpacity={0.7} strokeWidth={1.5} />
      <path d="M93 52 L100 59 L107 52" fill="none" stroke={W} strokeOpacity={0.7} strokeWidth={1.5} />
      <PixelRect x={58} y={80} w={84} h={40} o={0.7} />
      <line x1={r(62 + beam * 76)} y1={84} x2={r(62 + beam * 76)} y2={116} stroke={B} strokeOpacity={0.9} />
      {p < 0.3 && Array.from({ length: 4 }, (_, i) => {
        const q = frac(p * 4 + i * 0.25);
        return <Px key={i} x={100} y={62 + q * 70} s={4} o={q > 0.25 && q < 0.75 ? 0.15 : 0.9} />;
      })}
      <Label x={100} y={140} o={0.45}>scanned in flight</Label>
      <HandOff p={p} from={142} y={100} />
    </>
  );
};

const malScore: Scene = (t) => {
  const { p, item } = cycleOf(DOWNLOADS, t);
  const k = span(p, 0.62, 0.8);
  const filled = Math.round((item.risk / 10) * ease(k));
  const bad = item.risk >= 50;
  return (
    <>
      <Field />
      <Arrive p={p} to={60} label={item.f} />
      <Label x={100} y={58} o={0.45}>signatures · reputation · heuristics</Label>
      {Array.from({ length: 10 }, (_, i) => {
        const on = p >= 0.62 && i < filled;
        return <Px key={i} x={46 + i * 12} y={100} s={9} c={on ? (bad && i >= 5 ? B : W) : W} o={on ? 0.95 : 0.12} />;
      })}
      {p >= 0.62 && (
        <Label x={100} y={134} c={bad ? B : W} o={0.95}>{`RISK ${Math.round(item.risk * ease(k))}`}</Label>
      )}
    </>
  );
};

const malRelease: Scene = (t) => {
  const { p, item } = cycleOf(DOWNLOADS, t);
  const k = span(p, 0.8, 0.98);
  const bad = item.risk >= 50;
  const y = bad ? 40 + Math.min(1, k * 2) * 46 : 40 + ease(k) * 88;
  return (
    <>
      <Field />
      <line x1={36} y1={104} x2={164} y2={104} stroke={B} strokeOpacity={0.35} strokeDasharray="3 4" />
      <PixelRect x={40} y={146} w={120} h={18} o={0.55} />
      <Label x={100} y={180} o={0.45}>DISK</Label>
      {p >= 0.8 && (
        <>
          {!(bad && k > 0.5) && <PixelRect x={88} y={y} w={24} h={30} c={bad ? B : W} o={0.95} />}
          {bad && <Dissolve x={100} y={92} k={(k - 0.45) / 0.55} />}
          <Label x={100} y={126} c={bad ? B : W} o={k > 0.4 ? 0.95 : 0}>{bad ? "STOPPED · NEVER REACHES DISK" : "SAVED"}</Label>
        </>
      )}
    </>
  );
};

/* ── Device Posture: Check, Compare, Highlight ────────────────────────── */

const DEVICES = [
  { d: "ThinkPad · Rohan", off: "FIREWALL" },
  { d: "MacBook · Priya", off: "" },
  { d: "Dell XPS · Meera", off: "ENCRYPTION" },
  { d: "HP EliteBook · Arjun", off: "" },
];
const SIGNALS = ["ENCRYPTION", "FIREWALL", "OS UPDATES", "ANTIVIRUS"];

const postCheck: Scene = (t) => {
  const { p, item } = cycleOf(DEVICES, t);
  const read = span(p, 0.03, 0.28) * 4;
  return (
    <>
      <Field />
      <PixelRect x={22} y={70} w={54} h={36} o={0.75} />
      <line x1={16} y1={114} x2={82} y2={114} stroke={W} strokeOpacity={0.7} strokeWidth={2} />
      <Label x={49} y={132} o={0.8}>{item.d}</Label>
      {SIGNALS.map((s, i) => {
        const on = read > i;
        const off = item.off === s;
        return (
          <g key={s} opacity={on ? 1 : 0.25}>
            <Px x={100} y={62 + i * 18} s={6} c={on && off ? B : W} o={on ? 1 : 0.4} />
            <Label x={110} y={65 + i * 18} anchor="start" c={on && off ? B : W} o={0.8}>{s}</Label>
          </g>
        );
      })}
      <HandOff p={p} from={170} y={150} />
    </>
  );
};

const postCompare: Scene = (t) => {
  const { p, item } = cycleOf(DEVICES, t);
  const k = span(p, 0.62, 0.8);
  return (
    <>
      <Field />
      <Arrive p={p} to={40} y={150} />
      <Label x={100} y={40} o={0.45}>baseline</Label>
      {SIGNALS.map((s, i) => {
        const y = 60 + i * 20;
        const short = item.off === s;
        const got = p >= 0.62 ? Math.round(12 * ease(k) * (short ? 0.4 : 1)) : 0;
        return (
          <g key={s}>
            {Array.from({ length: 12 }, (_, x) => <Px key={x} x={56 + x * 8} y={y} s={5} c={x < got ? (short ? B : W) : W} o={x < got ? 0.9 : 0.12} />)}
          </g>
        );
      })}
      {p >= 0.62 && <Label x={100} y={160} c={item.off ? B : W} o={k > 0.6 ? 0.95 : 0}>{item.off ? `${item.off} OFF` : "MATCHES BASELINE"}</Label>}
    </>
  );
};

const postHighlight: Scene = (t) => {
  const { n, p, nth } = cycleOf(DEVICES, t);
  return (
    <>
      <Field />
      <Console title="CONSOLE · NEEDS ATTENTION" n={n} p={p} row={(k) => { const d = nth(k); return { text: d.d, tag: d.off ? "NEEDS FIX" : "OK", hot: !!d.off }; }} />
    </>
  );
};

/* ── Activity Monitoring: Enable, Capture, Review ─────────────────────── */

const PEOPLE = [
  { who: "Priya", at: "10:42" },
  { who: "Rohan", at: "11:06" },
  { who: "Meera", at: "11:30" },
  { who: "Arjun", at: "11:54" },
];

const actEnable: Scene = (t) => {
  const { p, n, item } = cycleOf(PEOPLE, t);
  const on = p > 0.12;
  const slot = ((n % 4) + 4) % 4;
  return (
    <>
      <Field />
      {[0, 1, 2, 3].map((i) => {
        const x = 46 + (i % 2) * 64;
        const y = 50 + Math.floor(i / 2) * 58;
        const lit = i === slot ? on : i < slot;
        return (
          <g key={i}>
            <PixelRect x={x} y={y} w={42} h={26} o={lit ? 0.85 : 0.3} c={i === slot && on ? B : W} />
            <rect x={x + 9} y={y + 34} width={24} height={10} rx={5} fill={lit ? B : "none"} stroke={lit ? "none" : W} strokeOpacity={0.35} />
            <circle cx={lit ? x + 28 : x + 14} cy={y + 39} r={3.5} fill={lit ? "#141414" : W} fillOpacity={lit ? 1 : 0.5} />
          </g>
        );
      })}
      <Label x={100} y={176} c={on ? B : W} o={0.85}>{`MONITORING ON · ${item.who}`}</Label>
      <HandOff p={p} from={160} y={100} c={B} />
    </>
  );
};

const actCapture: Scene = (t) => {
  const { p, n, item } = cycleOf(PEOPLE, t);
  const flash = p >= 0.62 && p < 0.68;
  const drop = span(p, 0.68, 0.84);
  const shots = ((n % 5) + 5) % 5;
  return (
    <>
      <Field />
      <Arrive p={p} to={60} y={70} />
      <PixelRect x={52} y={44} w={96} h={60} o={0.7} />
      {[[52, 44, 1, 1], [148, 44, -1, 1], [52, 104, 1, -1], [148, 104, -1, -1]].map(([x, y, dx, dy], i) => (
        <path key={i} d={`M${x - dx * 6 + dx * 12} ${y - dy * 6} h${-dx * 12} v${dy * 12}`} fill="none" stroke={B} strokeOpacity={flash ? 1 : 0.45} strokeWidth={1.6} />
      ))}
      {drop > 0 && drop < 1 && <PixelRect x={86 + (shots * 26 - 52 - 14) * ease(drop)} y={60 + ease(drop) * 80} w={26} h={16} c={B} o={0.9} />}
      {[0, 1, 2, 3, 4].map((i) => <PixelRect key={i} x={34 + i * 27} y={142} w={22} h={14} o={i < shots ? 0.6 : 0.15} />)}
      <Label x={100} y={178} o={p >= 0.62 ? 0.75 : 0}>{`${item.at} · BLURRED`}</Label>
    </>
  );
};

const actReview: Scene = (t) => {
  const { p, item } = cycleOf(PEOPLE, t);
  const head = 30 + ease(Math.abs(frac(t * 0.12) * 2 - 1)) * 140;
  const SEG = [18, 10, 26, 8, 16, 22, 12];
  let x = 30;
  return (
    <>
      <Field />
      <PixelRect x={62} y={40} w={76} h={50} o={0.75} />
      <Label x={100} y={70} o={0.5}>{`${item.who} · ${item.at}`}</Label>
      {SEG.map((w, i) => {
        const el = <g key={i}>{Array.from({ length: Math.round(w / 4) }, (_, k) => <Px key={k} x={x + k * 4 + 2} y={124} s={3.5} c={i % 3 === 0 ? B : W} o={i % 3 === 0 ? 0.9 : 0.35} />)}</g>;
        x += w + 4;
        return el;
      })}
      <line x1={r(head)} y1={110} x2={r(head)} y2={138} stroke={W} strokeOpacity={0.9} strokeWidth={1.5} />
      <Px x={head} y={108} s={6} c={B} />
      <Label x={100} y={164} o={0.45}>activity timeline</Label>
      {p >= 0.82 && <Label x={100} y={178} c={B} o={span(p, 0.82, 0.9)}>NEW CAPTURE ADDED</Label>}
    </>
  );
};

export const STORIES = {
  "data-loss-prevention": [dlpCapture, dlpInspect, dlpReport],
  "application-control": [appInventory, appTarget, appEnforce],
  "vpn-control": [vpnRecognise, vpnBlock, vpnSurface],
  "malware-scanning": [malStream, malScore, malRelease],
  "device-posture": [postCheck, postCompare, postHighlight],
  "activity-monitoring": [actEnable, actCapture, actReview],
} as const;
