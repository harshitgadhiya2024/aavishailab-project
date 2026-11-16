/*
 * Conversion events and lead attribution for the website.
 *
 * track() sends one event to Google Analytics (gtag) and to Google Tag
 * Manager (dataLayer), so ad platform tags added in GTM can use the same
 * events as conversions. Before consent, gtag only sends a cookieless ping
 * and GTM is not loaded at all, so nothing here sets a cookie.
 *
 * Events: waitlist_signup, demo_request, cta_click {cta, location}.
 */

export const CONSENT_KEY = "aavishield-analytics-consent";
const LANDING_KEY = "aavishield-landing";

type Params = Record<string, string | number | undefined>;

export function hasConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === "granted";
  } catch {
    return false;
  }
}

export function track(event: string, params: Params = {}) {
  if (typeof window === "undefined") return;
  try {
    window.gtag?.("event", event, params);
    (window.dataLayer = window.dataLayer || []).push({ event, ...params });
  } catch {
    /* analytics must never break the page */
  }
}

/** What a link does, for the cta_click event; null for links that are not calls to action. */
function ctaOf(a: HTMLAnchorElement): string | null {
  const href = a.getAttribute("href") || "";
  if (/\/register(\?|$)/.test(href)) return "start_trial";
  if (/\/login(\?|$)/.test(href)) return "sign_in";
  if (href === "/contact" || href.startsWith("/contact?") || href.startsWith("/contact#")) return "book_demo";
  if (href === "#join" || href.startsWith("/waitlist")) return "join_waitlist";
  return null;
}

/**
 * One listener for every call-to-action link on the site, so new buttons are
 * tracked without touching their code. Returns the cleanup function.
 */
export function trackCtaClicks(): () => void {
  const onClick = (e: MouseEvent) => {
    const a = (e.target as HTMLElement | null)?.closest?.("a");
    if (!a) return;
    const cta = ctaOf(a as HTMLAnchorElement);
    if (!cta) return;
    const where = a.closest("header, nav") ? "header" : a.closest("footer") ? "footer" : window.location.pathname;
    track("cta_click", { cta, location: where });
  };
  document.addEventListener("click", onClick, { capture: true });
  return () => document.removeEventListener("click", onClick, { capture: true });
}

/** An off-site referrer, or "" for internal navigation and direct visits. */
function externalReferrer(): string {
  try {
    const r = document.referrer;
    if (!r) return "";
    const u = new URL(r);
    return u.origin === window.location.origin ? "" : `${u.origin}${u.pathname}`.slice(0, 300);
  } catch {
    return "";
  }
}

/**
 * Remembers where the visitor first came from (referrer + utm_* tags) for
 * this tab, so a sign-up on a later page still credits the ad that brought
 * them. Only with consent: without it, the form falls back to the current
 * page and referrer.
 */
export function rememberLanding() {
  if (typeof window === "undefined" || !hasConsent()) return;
  try {
    if (sessionStorage.getItem(LANDING_KEY)) return;
    const q = new URLSearchParams(window.location.search);
    const utm = [...q.entries()].filter(([k]) => k.startsWith("utm_") || k === "gclid" || k === "li_fat_id" || k === "fbclid");
    sessionStorage.setItem(LANDING_KEY, JSON.stringify({
      referrer: externalReferrer(),
      page: window.location.pathname + (utm.length ? `?${new URLSearchParams(utm)}` : ""),
    }));
  } catch {
    /* storage blocked */
  }
}

/** Referrer and landing page to send with a lead form. */
export function attribution(): { referrer: string; landing: string } {
  let saved: { referrer?: string; page?: string } = {};
  try {
    saved = JSON.parse(sessionStorage.getItem(LANDING_KEY) || "{}");
  } catch {
    /* storage blocked */
  }
  return { referrer: saved.referrer || externalReferrer(), landing: saved.page || "" };
}
