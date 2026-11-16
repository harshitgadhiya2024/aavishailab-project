"use client";

import Link from "next/link";
import Script from "next/script";
import { useEffect, useState } from "react";

// Google Analytics 4 with consent mode. Until a visitor accepts, analytics
// storage stays denied, so no GA cookies are set. Production builds only.
const GA_ID = process.env.NEXT_PUBLIC_GA_ID ?? "G-TRTQ0TD218";
const CONSENT_KEY = "aavishield-analytics-consent";
const OPEN_EVENT = "aavishield:cookie-settings";

type Choice = "granted" | "denied";

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

function storedChoice(): Choice | null {
  try {
    const v = localStorage.getItem(CONSENT_KEY);
    return v === "granted" || v === "denied" ? v : null;
  } catch {
    return null;
  }
}

// Runs before gtag.js: sets the consent defaults from any saved choice, then configures the tag.
const initScript = `
window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}window.gtag=gtag;
var c=null;try{c=localStorage.getItem(${JSON.stringify(CONSENT_KEY)});}catch(e){}
gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:c==='granted'?'granted':'denied'});
gtag('js',new Date());gtag('config',${JSON.stringify(GA_ID)});`;

/** The Google tag plus the cookie banner. Rendered once, in the root layout. */
export function Analytics() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // The saved choice lives in the browser, so the banner can only be decided after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(storedChoice() === null);
    const reopen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, reopen);
    return () => window.removeEventListener(OPEN_EVENT, reopen);
  }, []);

  if (process.env.NODE_ENV !== "production") return null;

  function choose(choice: Choice) {
    try {
      localStorage.setItem(CONSENT_KEY, choice);
    } catch {}
    window.gtag?.("consent", "update", { analytics_storage: choice });
    setOpen(false);
  }

  return (
    <>
      <Script id="ga-init" strategy="afterInteractive" dangerouslySetInnerHTML={{ __html: initScript }} />
      <Script id="ga-tag" strategy="afterInteractive" src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} />
      {open && (
        <div
          role="dialog"
          aria-label="Cookie choices"
          className="fixed inset-x-4 bottom-4 z-[60] max-w-[420px] rounded-[6px] border border-line-strong bg-surface p-5 shadow-[0_12px_40px_rgba(0,0,0,0.12)] sm:left-6 sm:right-auto"
        >
          <p className="text-[13.5px] leading-relaxed text-fg-2">
            We use Google Analytics cookies to understand how people use this site. They are set only if you accept.{" "}
            <Link href="/cookie-policy" className="text-brand-ink underline underline-offset-2">Cookie policy</Link>
          </p>
          <div className="mt-4 flex gap-2 font-mono text-[11px] uppercase tracking-[0.1em]">
            <button type="button" onClick={() => choose("denied")} className="h-9 flex-1 rounded-[6px] border border-line-strong px-4 text-fg transition-colors hover:bg-bg">
              Decline
            </button>
            <button type="button" onClick={() => choose("granted")} className="h-9 flex-1 rounded-[6px] bg-invert-bg px-4 text-invert-fg transition-opacity hover:opacity-90">
              Accept
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/** Reopens the cookie banner so a visitor can change their choice. */
export function CookieSettingsButton({ className = "" }: { className?: string }) {
  return (
    <button type="button" onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))} className={className}>
      Cookie settings
    </button>
  );
}
