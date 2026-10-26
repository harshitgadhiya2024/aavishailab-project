"use client";

import { MousePointer2 } from "lucide-react";
import { useEffect, useState } from "react";
import { BrandLogo } from "./BrandLogo";
import { DitherField } from "./DitherField";

/*
 * The brand side of the sign-in screens, in the website's light landing
 * style (aavishield.com): the off-white page, a large Satoshi headline, the
 * orange pixel-grid panel holding a white console card with a teammate's
 * cursor tag, and the dithered orange terrain along the bottom. Colours are
 * the website's own and fixed, so it stays light whatever the console theme.
 */

const EVENTS = [
  { d: "instagram.com", who: "Rohan · Sales", blocked: true },
  { d: "docs.google.com", who: "Priya · Finance", blocked: false },
  { d: "chat.deepseek.com", who: "Arjun · Engineering", blocked: true },
  { d: "github.com", who: "Meera · Engineering", blocked: false },
  { d: "wetransfer.com", who: "Kabir · Design", blocked: true },
  { d: "notion.so", who: "Ananya · Product", blocked: false },
];
const ROWS = 4;

/** The website's UiCard: mono title bar, then live rows; a new request lands every few seconds. */
function ActivityCard() {
  const [n, setN] = useState(ROWS);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setN((v) => v + 1), 2400);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="relative rounded-[6px] border border-[rgb(11_11_13/0.12)] bg-white shadow-[0_18px_40px_-24px_rgb(120_50_0/0.35)]">
      <div className="flex items-center justify-between gap-3 border-b border-[rgb(11_11_13/0.09)] px-4 py-2.5">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-[#0b0b0d]">Console · Activity</span>
        <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[#5d5d66]">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#ff7000] opacity-60" />
            <span className="relative inline-flex size-1.5 rounded-full bg-[#ff7000]" />
          </span>
          Live
        </span>
      </div>
      <ul className="divide-y divide-[rgb(11_11_13/0.07)]">
        {Array.from({ length: ROWS }, (_, k) => {
          const id = n - k;
          const e = EVENTS[id % EVENTS.length];
          return (
            <li key={id} className={`flex items-center gap-3 px-4 py-2.5 ${k === 0 ? "auth-row-in" : ""}`}>
              <span className={`size-2 shrink-0 ${e.blocked ? "bg-[#ff7000]" : "bg-[#0b0b0d]/25"}`} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-[#0b0b0d]">{e.d}</span>
                <span className="block truncate text-[11.5px] text-[#5d5d66]">{e.who}</span>
              </span>
              <span
                className={`shrink-0 rounded-[3px] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] ${
                  e.blocked ? "bg-[#fdecea] text-[#b42318]" : "bg-[#ecfdf3] text-[#067647]"
                }`}
              >
                {e.blocked ? "Blocked" : "Allowed"}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const plus = "absolute text-[14px] leading-none text-[#0b0b0d]/45";

export function AuthBrandPanel({
  headline = "Policy on every device. Every decision in view.",
  lead = "Enforce your rules on every laptop, see what your team is doing, and act on risk before it spreads.",
}: {
  headline?: string;
  lead?: string;
}) {
  return (
    <aside className="relative hidden overflow-hidden border-r border-[rgb(11_11_13/0.09)] bg-[#fafafa] text-[#0b0b0d] lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
      <div className="relative z-10 flex items-center justify-between px-10 pt-8 xl:px-14">
        <BrandLogo className="text-[22px]" ink="text-[#0b0b0d]" />
        <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-[#5d5d66]">Company console</span>
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col justify-center gap-8 px-10 py-6 xl:px-14">
        <div>
          <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-[#c2410c]">
            <span className="size-1.5 bg-[#ff7000]" />
            Zero Trust · One console
          </p>
          <h1 className="mt-4 max-w-[16ch] [font-family:Satoshi,var(--font-inter),sans-serif] text-[2.5rem] font-normal leading-[1.04] tracking-[-0.04em] text-[#0b0b0d] xl:text-[3rem]">
            {headline}
          </h1>
          <p className="mt-4 max-w-[44ch] text-[15px] leading-relaxed text-[#3f3f46] [@media(max-height:820px)]:hidden">
            {lead}
          </p>
        </div>

        {/* The website's PixelPanel: orange pixel grid on the soft brand tint, "+" in each corner. */}
        <div className="relative max-w-[500px] overflow-hidden rounded-[4px] border border-[#ff7000]/15 bg-[#fff1e5] px-8 pb-8 pt-10 [background-image:linear-gradient(rgb(255_112_0/0.09)_1px,transparent_1px),linear-gradient(90deg,rgb(255_112_0/0.09)_1px,transparent_1px)] [background-size:12px_12px]">
          <span aria-hidden className={`${plus} left-2 top-2`}>+</span>
          <span aria-hidden className={`${plus} right-2 top-2`}>+</span>
          <span aria-hidden className={`${plus} bottom-2 left-2`}>+</span>
          <span aria-hidden className={`${plus} bottom-2 right-2`}>+</span>
          <span aria-hidden className="auth-tag-float pointer-events-none absolute right-6 top-1.5 z-20 flex items-start gap-0.5">
            <MousePointer2 className="h-[18px] w-[18px] -scale-x-100 fill-[#ff7000] text-[#ff7000]" />
            <span className="mt-3 whitespace-nowrap bg-[#ff7000] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-white">
              Live decisions
            </span>
          </span>
          <ActivityCard />
        </div>
      </div>

      <div className="relative h-[110px] shrink-0 xl:h-[130px]">
        <DitherField variant="band" />
        <p className="absolute bottom-3 left-10 bg-[#fafafa]/80 px-1 font-mono text-[10.5px] uppercase tracking-[0.1em] text-[#5d5d66] xl:left-14">
          © 2026 Aavishield
        </p>
      </div>
    </aside>
  );
}
