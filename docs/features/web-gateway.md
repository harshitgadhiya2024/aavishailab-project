# Web Gateway

Blocks and records web requests by domain/category policy (e.g. "Block AI
tools", "Sensitive info" categories like banking/finance/government). Shows
up in the dashboard's **Web Gateway** activity tab.

## How it decides what to record

A page a person opens routinely loads dozens of embedded third-party hosts
— analytics, payment widgets (Stripe), fonts, trackers. Blocking is
unaffected by whether the request was a page navigation or an embedded
resource; **recording** is not: only a request that actually opened a page
is logged as a visit.

- `Sec-Fetch-Dest: document` (a real navigation) is recorded.
- An embedded resource (an iframe's `Sec-Fetch-Dest: iframe`, a script, a
  background fetch) is not recorded as a "visit", even if it's on a
  category the org blocks — it's still blocked, just not shown as if the
  person opened it.
- A client sending no fetch metadata at all (a desktop app, a script) is
  recorded as before — that heuristic only applies to browser traffic.
- When no block page can be served (SSL inspection off), the raw CONNECT is
  still recorded, unchanged.

## Protection takes effect immediately on already-open browsers

The system proxy setting doesn't touch connections a browser already has
open — reloading a tab reuses them. Before this was fixed, any browser open
at install time (or when protection resumed after being paused) silently
bypassed both Web Gateway and DLP until it was quit and reopened. The agent
now closes every running browser the moment it turns the proxy on from
fully off (install, login, working hours starting, a Disconnect ending),
and tells the person why. See
[browser-protection.md](browser-protection.md).

## Bugs fixed this cycle

See [../bug-fixes.md](../bug-fixes.md). Summary:

1. A page that merely embedded Stripe (or any blocked-category host)
   produced a "visited r.stripe.com" log entry the person never actually
   navigated to — dozens of false entries per real page view.
2. Already-open browsers bypassed the gateway entirely until quit and
   reopened — fixed by closing them on protection turning on (this is the
   same fix as DLP's equivalent gap; one root cause, one fix).
