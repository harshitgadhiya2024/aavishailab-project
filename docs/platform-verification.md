# Platform verification status

| Platform | Status | Last verified |
|---|---|---|
| **macOS** | ✅ Verified | 2026-09-30 |
| **Windows** | ⏳ Not yet tested | — |
| **Ubuntu / Linux** | ⏳ Not yet tested | — |

`services/endpoint-agent` is one Rust codebase for all three platforms.
Because macOS is now fully verified, **the agent code is frozen**: it will
not be changed unless the user explicitly names a specific thing to update
— see the `endpoint-agent-code-frozen` note. Everything below this line
describes how macOS was verified and what's needed to bring Windows and
Ubuntu to the same state, without assuming any agent-code change is needed
to get there — the code is the same binary source on every platform; what's
unverified is platform-specific behaviour (process listing, the system
proxy mechanism, file paths, installer format) actually working as written.

## macOS — verified 2026-09-30

Verified on two separate physical Macs, with the real production
backend, the real published agent installer (not a local build), and real
consumer apps and websites — not synthetic unit tests. Every feature below
was exercised live and confirmed via the production activity log
(`activity_events` table / the company dashboard) in real time.

### Web Gateway
- A page that embeds a blocked-category resource (Stripe) but was never
  itself navigated to: **not logged**.
- The same page opened directly (`stripe.com`): blocked and logged once.
- Verified via a scripted real-Chrome run and via manual browsing.

### DLP — via real platforms
All of these were sent through the actual product UI (not a test harness),
by two different employees on two different Macs, and confirmed in
production within seconds via a live database watch:
- **Microsoft Teams** (desktop app): a message containing a card number —
  recorded as "Message sent", destination "Microsoft Teams".
- **Gmail** (browser): a sent email and a file upload, both containing
  sensitive data — recorded as "Email sent" / "File upload", destination
  "Gmail"; one was additionally flagged by the AI tier (semantic content,
  not a pattern match).
- **OneDrive** (via Teams): a photo (`driving licence.jpeg`) uploaded —
  recorded with its real file name, AI vision classification fired.
- **Outlook** (browser): a file upload containing a card number and
  AI-flagged content — recorded correctly.
- **Real files** (not synthetic strings): a text file, JSON, DOCX
  (salary/PAN/card), a normal PDF, a PDF containing card/Aadhaar/PAN text,
  a scanned/photographed PDF (Aadhaar, OCR'd), and a photographed credit
  card (AI vision) — all correctly flagged; two unrelated "normal" files
  (no sensitive content) correctly produced **no** incident.
- **WhatsApp**: confirmed as a permanent, expected non-result — end-to-end
  encryption means the agent only ever sees encrypted bytes. Not a bug.

### Application Control
- WhatsApp, Telegram, MongoDB Compass, MySQLWorkbench, AWS VPN Client: each
  blocked, and confirmed to close within seconds of being opened —
  including apps re-opened deliberately after being blocked (dobara khola
  to bhi turant band hua).
- Confirmed the specific class of bug (#13 in bug-fixes.md — one `null`
  field silently freezing all later blocks) is fixed: every app in the
  list blocks independently now, not just the first one in the rules
  response.

### Browser-open-before-install
- Chrome and Edge, both open at the moment the agent installed, were
  observed in the agent's own log to be closed automatically:
  `closed browsers that were open before protection turned on
  browsers=["Microsoft Edge", "Google Chrome"]`.

### VPN Control
- AWS VPN Client blocked by default with no admin configuration, confirmed
  live.

### What "verified" means here concretely
- Real production backend (not a local/staging environment).
- Real published agent build from the employee portal (2.8.7, then 2.8.8
  after a fix landed mid-session; 2.8.9 is now published with further
  agent-side hardening — not yet installed/re-verified, since a
  server-side fix alone already made 2.8.8 fully correct).
- Real consumer platforms (Teams, Gmail, Outlook, OneDrive, WhatsApp,
  ChatGPT, MongoDB Compass, etc.), not stubs.
- Confirmed via the actual production database/dashboard a customer would
  see, watched live during testing, not via a separate test log.

## Windows — not yet tested

Nothing Windows-specific has been exercised on real Windows hardware in
this cycle. The agent's Windows code paths (`system_proxy.rs`'s registry
proxy setting, `app_control.rs`'s `Get-CimInstance Win32_Process` listing,
the `.msi` installer, `taskkill` process termination) are written and
compile/pass unit tests, but — per the code's own doc comments — were
**never verified against a real Windows desktop** even before this cycle.

**To get to green:** install `aavishield-agent-rust-2.8.9.msi` (from the
employee portal, once a Windows employee account exists to enroll with) on
a real Windows machine, and run through the same checklist as the macOS
section above — Web Gateway, DLP (Teams/Gmail/Outlook desktop and web
clients), Application Control, VPN Control, browser-already-open. Since the
agent code is frozen, this is expected to work identically to macOS unless
a Windows-specific mechanism (the registry proxy, `taskkill`, process
listing) turns out to behave differently in practice — if it does, that's
exactly the kind of "explicit, named thing to update" the freeze allows.

## Ubuntu / Linux — not yet tested

Same situation: the Linux code paths (`gsettings` for the system proxy,
`/proc` for process listing, the `.deb` installer) are written and unit
tested, but not run on a real Linux desktop in this cycle.

**To get to green:** same checklist, on a real Ubuntu desktop with a GUI
browser (a headless server, like the production host itself, cannot
exercise the browser-facing features — it needs to be a desktop
installation).
