"use client";

import { useEffect, useRef } from "react";

const SEEN_KEY = "aavishield-loaded";
const MIN_MS = 600; // long enough to read as intentional, not a flicker
const MAX_MS = 2500; // never hold the page hostage to a slow asset

/**
 * Inline, render-blocking on purpose and tiny: hides the loader before the
 * first paint for anyone who already saw it this browser session, so it only
 * ever greets a first visit and never replays on reloads or later pages.
 */
export const loaderGateScript = `try{if(sessionStorage.getItem("${SEEN_KEY}"))document.documentElement.classList.add("no-loader")}catch(e){}`;

/**
 * First-visit loader: the real Aavishield mark with an orange ring, animated
 * with Lottie. The markup below renders on the server as a CSS-only version
 * of the same thing, so something branded is on screen from the very first
 * paint; the Lottie player and its JSON load afterwards (they are not in the
 * initial bundle) and take over the same box if the loader is still up.
 */
export function SiteLoader() {
  const root = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el || document.documentElement.classList.contains("no-loader")) return;

    let anim: { destroy: () => void } | null = null;
    let done = false;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!reduce) {
      Promise.all([import("lottie-web/build/player/lottie_light"), import("@/lib/lottie/loader.json")])
        .then(([lottie, data]) => {
          if (done || !box.current) return;
          box.current.replaceChildren();
          box.current.classList.add("is-lottie");
          anim = lottie.default.loadAnimation({ container: box.current, renderer: "svg", loop: true, autoplay: true, animationData: data.default });
        })
        .catch(() => {}); // the CSS version keeps showing
    }

    const hide = () => {
      if (done) return;
      done = true;
      try {
        sessionStorage.setItem(SEEN_KEY, "1");
      } catch {}
      el.classList.add("is-done");
      window.setTimeout(() => {
        el.style.display = "none";
        anim?.destroy();
      }, 450);
    };

    const sinceStart = () => performance.now();
    const whenLoaded = () => window.setTimeout(hide, Math.max(0, MIN_MS - sinceStart()));
    if (document.readyState === "complete") whenLoaded();
    else window.addEventListener("load", whenLoaded, { once: true });
    const cap = window.setTimeout(hide, Math.max(0, MAX_MS - sinceStart()));

    return () => {
      window.removeEventListener("load", whenLoaded);
      window.clearTimeout(cap);
    };
  }, []);

  return (
    <div ref={root} className="site-loader" aria-hidden>
      <div ref={box} className="site-loader-anim">
        <span className="site-loader-ring" />
        {/* eslint-disable-next-line @next/next/no-img-element -- must paint before hydration */}
        <img src="/brand/mark-192.png" alt="" width={96} height={96} className="site-loader-mark" />
      </div>
      <p className="site-loader-tagline">Secure today. Enable tomorrow.</p>
    </div>
  );
}
