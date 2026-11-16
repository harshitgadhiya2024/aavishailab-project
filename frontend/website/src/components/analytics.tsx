"use client";

import Link from "next/link";
import Script from "next/script";
import { useEffect, useState } from "react";
import { CONSENT_KEY, rememberLanding, trackCtaClicks } from "@/lib/track";

// Google Analytics 4 with consent mode. Until a visitor accepts, analytics
// storage stays denied, so no GA cookies are set. Production builds only.
// GA4 property "Aavishield" (its own property; the old G-TRTQ0TD218 stream
// lived inside another product's property).
const GA_ID = (process.env.NEXT_PUBLIC_GA_ID || "G-G9JZS65BGC").trim();
// Google Tag Manager, for ad platform tags (Google Ads, LinkedIn, Meta).
// Loaded only after the visitor accepts. GA itself stays here, not in GTM,
// so a visit is never counted twice: do not add a GA4 tag inside GTM.
const GTM_ID = (process.env.NEXT_PUBLIC_GTM_ID || "GTM-M53JHKKJ").trim();
// Microsoft Clarity (heatmaps and session recordings). Off until a project ID
// is set, and even then loaded only after the visitor accepts: unlike GA it
// has no cookieless mode worth running without consent.
const CLARITY_ID = (process.env.NEXT_PUBLIC_CLARITY_ID ?? "").trim();
const OPEN_EVENT = "aavishield:cookie-settings";

type Choice = "granted" | "denied";

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    clarity?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

// Microsoft's standard loader, with the project ID passed as data.
const clarityScript = (id: string) => `
(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script",${JSON.stringify(id)});
window.clarity("consent");`;

// Google's standard GTM loader (head part); the noscript iframe is left out
// because nothing may load before consent, and no-JS visitors can't give it.
const gtmScript = (id: string) => `
(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});
var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';
j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer',${JSON.stringify(id)});`;

// Consent mode stops new cookies, but ones set while consent was given stay
// until they expire. On withdrawal, remove Google's (_ga*, _gcl*) for this
// host and the parent domain (GA sets them on ".aavishield.com").
function clearTrackingCookies() {
  const host = window.location.hostname;
  const parent = host.split(".").slice(-2).join(".");
  for (const c of document.cookie.split(";")) {
    const name = c.split("=")[0].trim();
    if (!/^(_ga|_gcl|_gid)/.test(name)) continue;
    for (const domain of ["", `; domain=${host}`, `; domain=.${parent}`]) {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domain}`;
    }
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
var g=c==='granted'?'granted':'denied';
gtag('consent','default',{ad_storage:g,ad_user_data:g,ad_personalization:g,analytics_storage:g});
gtag('js',new Date());gtag('config',${JSON.stringify(GA_ID)});`;

/** The Google tag plus the cookie banner. Rendered once, in the root layout. */
export function Analytics() {
  const [open, setOpen] = useState(false);
  const [consent, setConsent] = useState<Choice | null>(null);

  useEffect(() => {
    // The saved choice lives in the browser, so the banner can only be decided after mount.
    const saved = storedChoice();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(saved === null);
    setConsent(saved);
    rememberLanding();
    const stopCtas = trackCtaClicks();
    const reopen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, reopen);
    return () => {
      stopCtas();
      window.removeEventListener(OPEN_EVENT, reopen);
    };
  }, []);

  if (process.env.NODE_ENV !== "production") return null;

  function choose(choice: Choice) {
    try {
      localStorage.setItem(CONSENT_KEY, choice);
    } catch {}
    // One choice covers analytics and advertising measurement (the banner says so).
    window.gtag?.("consent", "update", {
      analytics_storage: choice, ad_storage: choice, ad_user_data: choice, ad_personalization: choice,
    });
    // Withdrawing consent: Clarity stops recording and clears its cookies.
    // GTM tags read the same consent state, so ad tags stop as well.
    if (choice === "denied") {
      window.clarity?.("consent", false);
      clearTrackingCookies();
    }
    if (choice === "granted") rememberLanding();
    setConsent(choice);
    setOpen(false);
  }

  return (
    <>
      <Script id="ga-init" strategy="afterInteractive" dangerouslySetInnerHTML={{ __html: initScript }} />
      <Script id="ga-tag" strategy="afterInteractive" src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} />
      {CLARITY_ID && consent === "granted" && (
        // Not id="clarity": an element id becomes window.clarity and shadows the tag's function.
        <Script id="ms-clarity-init" strategy="afterInteractive" dangerouslySetInnerHTML={{ __html: clarityScript(CLARITY_ID) }} />
      )}
      {GTM_ID && consent === "granted" && (
        // Google Tag Manager for ad platform tags; it shares GA's dataLayer and consent state.
        <Script id="gtm-init" strategy="afterInteractive" dangerouslySetInnerHTML={{ __html: gtmScript(GTM_ID) }} />
      )}
      {open && (
        <div
          role="dialog"
          aria-label="Cookie choices"
          className="fixed inset-x-4 bottom-4 z-[60] max-w-[420px] rounded-[6px] border border-line-strong bg-surface p-5 shadow-[0_12px_40px_rgba(0,0,0,0.12)] sm:left-6 sm:right-auto"
        >
          <p className="text-[13.5px] leading-relaxed text-fg-2">
            We use analytics cookies (Google Analytics{CLARITY_ID ? ", Microsoft Clarity" : ""}) to understand how people use this site, and advertising cookies to measure which ads bring visitors. They are set only if you accept.{" "}
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
