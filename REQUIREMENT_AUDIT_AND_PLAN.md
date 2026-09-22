# Requirement Audit & Implementation Plan

Audit date: 2026-09-22 · Branch `main` @ `23ce27d` · Live stack verified against the running
Docker environment (admin-api healthy, 43 tables, 4787 activity events, 3 orgs, 4 devices).

Source of truth for requirements: [`requirement-details.md`](requirement-details.md).

**Last published client connector version: `2.4.0`** — confirmed two ways: `/app/agent-packages/manifest.json`
inside `aavishield-admin-api` pins `2.4.0` for all three platforms, and the newest enrolled device rows
report `agent_version = 2.4.0`. There are no git tags; every release so far went out via
`workflow_dispatch` on `.github/workflows/agent-packages.yml`. **Next version will be `2.5.0`.**

---

## Part 1 — Answers to the 8 questions

### Q1. Web Gateway policy blocks chatgpt.com / claude.ai in the browser, with our own HTML block page?

**Partially working — the block happens, the custom page usually does not.**

What works: a domain or category policy is compiled into the rule bundle at
`GET /internal/agent/rules`, the agent's `PolicyCache` matches the host, and `ProxyConnection`
refuses the request. A `Block chatgpt` domain policy already exists in the database and
`activity_events` shows 106 `web_request/blocked` and 313 `policy_violation/blocked` rows, so
enforcement is demonstrably live.

Two real gaps:

1. **HTTPS sites show a TLS error, not our page.** `BLOCK_PAGE_HTML` is served directly for plain
   HTTP. For HTTPS the agent must terminate TLS first (`_serve_https_block_page`), which requires
   MITM interception to be on *and* the org CA to be trusted. `mitm_enabled` is read from
   `org.Settings["mitm_enabled"]` and **defaults to false** (`agents.go:1226`). Since chatgpt.com
   and claude.ai are HTTPS-only, out of the box the employee sees a connection failure with no
   explanation.
2. **The page is not the company's page.** `BLOCK_PAGE_HTML` is hardcoded Aavishield branding.
   `Organization` already carries `Name` and `LogoURL`, but nothing plumbs them to the endpoint,
   and there is no per-org custom message field.

### Q2. Deep security check of any site the user opens, and unsafe sites blocked?

**Working.**

`threatintel-service` holds **10,746** feed domains; the risk engine (`internal/riskengine`:
feeds, heuristics, whois, clamav) has computed **482** domain risk assessments. The agent calls
`/internal/agent/threat-lookup` per host through `ThreatIntelCache`, then blocks on `band=block`
or `score >= 80` and alerts from `score >= 50`. Threat-intel enforcement deliberately survives
into `security_only` mode, so it keeps protecting a personal laptop outside working hours.
This requirement needs no work.

### Q3. Does the Web Gateway policy also work at application level, with a block page or instruction?

**Partially working — the network block works, the user-facing feedback does not exist.**

- The agent installs itself as the **system proxy**, so any app that honours system proxy settings
  is filtered by the same rules as the browser. Downloading the ChatGPT installer from chatgpt.com
  is blocked, and the app's backend domains are blocked if they are in the rule bundle.
- `AppControlWatcher` polls the process list every 15s and terminates a process matching a
  controlled application.
- **Gap: nothing is shown to the employee.** `AppControlWatcher._terminate` kills the process and
  posts a report to the server. There is no notification, no block page, no instruction — the app
  simply vanishes. The requirement explicitly asks for a block page or instruction here.
- Known limit (documented honestly in the agent source): apps with their own HTTP stack or
  certificate pinning bypass the system proxy, and process-name matching is defeated by renaming
  the binary. Real prevention needs macOS Endpoint Security / Windows WDAC, i.e. MDM + signed
  system extensions.

### Q4. Every app an employee installs is logged per tenant, and the company can block it?

**Not implemented.** This is the single largest gap.

There is **no installed-application inventory anywhere in the system**: no model, no table, no
agent collector, no ingest endpoint. Concretely:

- `managed_applications` (16 rows) is a **static catalogue of known apps** shipped as seed data,
  not a record of what any employee has installed.
- `AppControlWatcher` only notices an app when it is **running**, and only if that app is already
  in the catalogue *and* has an explicit rule. An employee installing VS Code or codex produces
  **zero rows** anywhere.
- The Application Control tab is therefore catalogue-shaped, not employee-shaped. Of the required
  columns — Employee name, Application name, Category, Risk, Network Block, App Block, install Time —
  only Category, Risk, and the two block switches exist, and those are org-wide, not per employee.

### Q5. Are downloads scanned, is the reason shown, is there a sandbox for large files?

**Scanning works; the sandbox is a stub.**

Downloads are spooled by the proxy and scanned via `/internal/agent/scan-file` against
`malware-service` (ClamAV + hash reputation + static heuristics). A blocked download renders the
block page with the reason, so "why was this blocked" is answered.

`services/malware-service/app/sandbox.py` is a **pluggable stage whose default backend is `"none"`**.
Files that would be detonated are only flagged `would_sandbox=True`; the score is unchanged and no
behavioural analysis runs. A CAPE backend is implemented but `MALWARE_SANDBOX_URL` is unset, so in
practice large/unknown files get static analysis only, and the `would_sandbox` flag is not surfaced
in the UI either.

### Q6. Company laptop → screenshots + protection 24/7; personal laptop → disconnect option?

**Half working.**

- ✅ **24/7 protection on company hardware is correct.** `deviceEnforcement` forces `ownership =
  company` devices to `full` mode regardless of any working-hours schedule they inherit.
- ❌ **Screenshots are off by default.** `ScreenshotSettings.Enabled` defaults to `false` for every
  org (`monitoring.go:100`), all three org rows in the database have `enabled = f`, and the
  `screenshots` table has **0 rows**. On a company laptop screenshots are not running.
- ❌ **The Disconnect button shows on company devices.** `scripts/agent/ui/main.html:342` reveals it
  whenever the device is connected, with no ownership check at all. The agent's UI state object does
  not even carry `ownership`, so the connector cannot tell a company laptop from a personal one.

### Q7. DLP must only log, never block

**Currently the exact opposite of the requirement.**

DLP blocks today, by design and throughout the stack: `scanstream.go` ranks `block > alert > log`,
treats a block as terminal, and `_send_dlp_block` in the agent serves a block page plus an in-page
overlay for XHR/fetch uploads. The one DLP policy in the database has `action = block`.

The requirement is monitor-only: sensitive company data (access tokens, GitHub project URLs,
company documents) detected at app or browser level should be **recorded and shown to the company**,
never blocked. Related sub-requirements also unmet:

- DLP tab must be **logs only, with no policy creation**. Today it links to `/dashboard/policies`
  for DLP policy creation.
- Required log fields — Employee name, request (app/browser), destination, category (text/file-upload),
  Reason, risk score, time — are not all captured or displayed.
- **DLP and SSL inspection must be ON by default for every company.** Both are currently opt-in.

### Q8. All activity logs on a proper Activity tab

**Partially working.** The Activity page lists `activity_events` with a search and an action filter,
but it has no breakdown by source. The requirement asks for web gateway, DLP, app-install,
download-protection and device-posture logs to be visible there. App-install logs do not exist
(Q4), and device-posture is collected on heartbeat but never written as a once-daily activity event.

---

## Part 2 — Sidebar audit

| Required tab | Status | Work needed |
|---|---|---|
| Dashboard | ✅ exists | — |
| Teams | ✅ exists, CRUD wired | — |
| Employee | ✅ exists, CRUD + team tagging wired | — |
| Devices | ✅ exists, connect/disconnect trail at `/devices/activity` | — |
| Team & access | ✅ exists (`/dashboard/users`, RBAC) | — |
| Policy categories | ✅ exists, complete | — |
| Web Gateway | ⚠️ rules + stats + URL checker only | **Add the activity log table** (employee, domain, action, reason/policy, category, risk, time) with pagination |
| Application Control | ❌ catalogue-shaped | **Rebuild employee-wise** on a new installed-apps inventory |
| Data Loss Prevention | ⚠️ blocks, links to policy creation | **Logs-only, monitor-only**, required fields |
| Activity | ⚠️ flat list | **Source tabs**, plus the missing event sources |
| Screenshots | ⚠️ images + input activity % | **Add which apps were open** beside each screenshot |
| Access Requests | ✅ exists, grant flow wired | — |
| Reports | ✅ exists, CSV + JSON export | — |
| AI Assistant | ✅ exists, sessions + messages wired | — |
| Support | ✅ exists, ticket conversation + open/close | — |

**Tabs to remove from the company portal** (not in the requirement list):

- **Policies** (`/dashboard/policies`) — "Global policies ki tag nahi chaiye", marked *important*.
- **SSL Inspection** (`/dashboard/ssl-inspection`) — becomes always-on, so there is nothing to configure.
- **Shadow IT** (`/dashboard/shadow-it`) — not in the required list.
- **CASB** (`/dashboard/casb`) — not in the required list.

Two inbound links must be repointed when Policies goes: `dashboard/page.tsx:211` ("Active policies"
stat card) and `dashboard/dlp/page.tsx:259`.

---

## Part 3 — Why each gap is still open

| Gap | Why it is pending |
|---|---|
| Custom company block page | Block page HTML is a hardcoded constant baked into the agent binary; per-org branding needs a new org-settings surface plus a delivery path to the endpoint. Never specified before. |
| HTTPS block page not shown | Depends on SSL inspection, which was deliberately built opt-in for privacy/consent reasons. The requirement now reverses that decision to default-on. |
| App-level block feedback | `AppControlWatcher` was built as a silent enforcement sweep; user notification needs a per-OS toast path (`osascript` / Windows toast / `notify-send`) that does not exist yet. |
| Installed-app inventory | Genuinely never built. The catalogue approach was chosen to keep the agent dependency-free (no `psutil`), and inventory was out of scope for every prior phase. |
| Sandbox detonation | Needs a CAPE/Cuckoo cluster — heavy infrastructure. The pluggable stage was shipped ready, with `"none"` as the default, waiting on that infra decision. |
| Screenshots off by default | A deliberate privacy default ("recording someone's screen should be a deliberate choice"). The requirement overrides it for company-owned hardware. |
| Disconnect on company devices | The connector was written before device ownership mattered to the UI; ownership exists server-side but was never sent to the agent. |
| DLP blocking | Built to the original brief, which was prevention. The new brief is visibility-only — a direct reversal, not a bug. |
| Open apps beside screenshots | `ActivityMonitor` counts input events only; it never enumerates windows or processes, and `Screenshot` has no column for it. |
| Daily posture activity event | Posture is collected on every heartbeat and stored on the device row, but never emitted as an activity event. |

---

## Part 4 — Architecture decision: Rust for the connector

Taken mid-implementation, and it changes the shape of everything below.

**Where Rust already is.** `dlp-service` and `malware-service` are both built
from their Rust implementations today — `docker-compose.yml` points at
`services/dlp-service-rust` and `services/malware-service-rust`, with the Python
originals kept only as a rollback path. The two hottest scanning services are
already Rust.

**Where Go stays.** `admin-api` is a control plane: Postgres queries, auth,
RBAC, billing, JSON for three dashboards. Its time goes to the database, not to
the language. Only the two endpoints every device hits on a timer —
`/internal/agent/rules` (every 10s per device) and `/internal/agent/scan-dlp` —
are worth extracting, and that is a separate piece of work from the feature
requirements.

**Where the real win is: the connector.** The shipped client is
`scripts/agent/aavishield-agent.py`, 5,260 lines of Python running a
thread-per-connection proxy on every employee laptop, in the path of every HTTP
request and every TLS termination. `services/endpoint-agent` is a Rust rewrite
of that data plane — 3,201 lines, 80 tests, hyper for both legs of every relay
instead of hand-rolled HTTP text parsing. **The decision is to ship the Rust
connector.**

What that costs, stated plainly: the Rust agent covers the network core and
nothing else. Screenshots, input-activity monitoring, the tray icon, the
desktop window, auto-update, the uninstall flow, connect/disconnect lifecycle
reporting, posture collection and interactive browser enrollment are all
Python-only today. All three packaging scripts freeze the Python file with
PyInstaller; the Rust agent has no packaging, no signing and no CI, and its
macOS/Windows system-integration code has never run on real hardware. Until
that is closed, **Python remains the shipping connector** and the Rust agent is
where new connector features are written.

---

## Part 5 — Status

### Done

**Company portal shape**
- Sidebar matches the requested list exactly. Global Policies, SSL Inspection,
  Shadow IT and CASB removed; both inbound links to the deleted Policies page
  repointed; dead API helpers dropped.
- **Web Gateway** rebuilt: creates policies by domain, domain pattern or
  category, block or alert, targeted at everyone / teams / employees, with a
  server-paginated policy list — and the activity log it never had, carrying
  all seven required fields.
- **DLP** rebuilt as a pure log with the six required fields and no policy
  builder.
- **Activity** gained per-source tabs (Web Gateway, DLP, Applications,
  Downloads, Device posture, Devices), backed by a real server-side `source`
  filter rather than a client-side slice of one page.
- **Application Control** rebuilt employee-first on the new inventory, with
  per-employee Network block / App block switches.

**DLP is monitor-only** (requirement 7), in both agents and on the server. The
scoring pipeline still computes a full block/alert/allow band — that band is
the severity the company reads — but nothing acts on it. Incidents now carry
request source (app vs browser, from the User-Agent, with Electron explicitly
ruled out of "browser"), destination and content kind (text vs file-upload).
Malware download blocking is untouched; that is a different decision and only
one of them was reversed.

**Software inventory** (requirement 4), which did not exist in any form. A
device reports its full installed-application list, the server diffs the
snapshot to detect installs and uninstalls, and an install writes one activity
event. Windows registry (all three hives), macOS bundles, Linux
dpkg/rpm/snap/flatpak, plus manually downloaded binaries in `bin` directories —
the case a package database can never see.

**Defaults** (requirements 6, 7): screenshot capture is on for every
organization, with a once-ever migration for existing orgs that cannot
override an admin's later choice; SSL Inspection is on unless explicitly
disabled; device ownership rides the heartbeat so reclassifying a device takes
effect without a connector restart.

**Device posture** is now one event per device per day instead of one per
heartbeat.

**Block page is the company's page** (requirement 1). Name and logo come from
the org profile; "what to do about it" and "who to ask" are editable under
Settings → Block page. Both connectors render it through one function, which
is also where escaping now happens — the host arrives from the network and the
reason from policy text, into a page served inside the blocked origin's own
security context, and the Rust version interpolated both raw.

**An employee is told when an app is blocked** (requirement 3). Terminating a
process silently is indistinguishable from a crash. Both connectors now raise
a desktop notification naming the app and saying what to do, using what each
OS already ships.

**Screenshots carry the open-application list** (requirement: "screenshot ke
baju me jo apps open ho"). Captured on the agent at the moment of the shot,
because the window list a second later is a different answer. Applications,
not processes. Two chips on the thumbnail, the full list in the zoom view, and
nothing at all when the list is empty — an empty row of chips would read as
"nothing was open", which is a different and wrong claim.

**Rust connector** gained inventory collection, application control with the
same notification, a company-branded block page, and DLP monitor-only.

### Remaining

| # | Work | Why it is not done |
|---|---|---|
| 1 | Screenshot capture + input-activity counting in Rust | New per-OS platform code (screen grab, global input hooks) behind permission prompts that need real hardware to verify. Working in the Python connector today |
| 2 | Tray + desktop window in Rust | The Python connector has the full UI; the Rust agent has none. The server already sends `ownership`, so the gating logic is ready for it |
| 3 | Auto-update, uninstall flow, connect/disconnect lifecycle in Rust | Python-only today |
| 4 | Posture collection in Rust | Python-only; the server side already handles it, including the daily-digest change |
| 5 | Rust connector packaging, signing, CI | All three build scripts freeze the Python file with PyInstaller. The Rust agent has no packaging, no signing, and its macOS/Windows integration has never run on real hardware |
| 6 | `/internal/agent/rules` and `/internal/agent/scan-dlp` extracted to Rust | Separate from the feature work; needs a routing decision in front of admin-api |
| 7 | Sandbox detonation surfaced (`would_sandbox`) | Needs a CAPE/Cuckoo cluster — an infrastructure decision, not code |
| 8 | Connector release 2.5.0 | Everything the requirements need works in the Python connector now, so a 2.5.0 can ship from it. A Rust 2.5.0 is gated on 1–5 |

---

## Appendix — verification evidence

- `go build ./...` and `go test ./...` in `services/admin-api`: all packages
  pass, with new coverage for the DLP classifiers, domain normalisation, the
  activity source taxonomy and the SSL-inspection default.
- `cargo test` in `services/endpoint-agent`: 80 passing (was 64). `cargo
  clippy --all-targets`: clean.
- `pytest` in `scripts/agent`: 143 passing (was 123), including the check that
  admin-api's embedded copy of the agent stays byte-identical.
- `npx tsc --noEmit` and `npm run build` in `frontend/company-dashboard`:
  clean, 27 routes.
- Inventory collector probed on this host: 140 applications after filtering
  (790 before), correctly finding snaps, dpkg packages and `~/.local/bin`
  binaries.
- admin-api rebuilt and restarted against the live database: the
  `installed_applications` table and its unique `(device_id, identifier)`
  partial index were created, `screenshots.open_apps` was added, the
  screenshot-default migration enabled capture for all 3 orgs and recorded its
  once-ever marker, and `/internal/agent/inventory` and
  `/internal/agent/branding` are registered and correctly refuse unauthenticated
  calls.
- Live containers: admin-api, dlp, malware, extract, threatintel, posture,
  shadowit, casb, clamav, postgres, redis and all three frontends healthy.

**Not verified end-to-end:** browser click-through of each dashboard tab
against a live login, and any agent behaviour on real macOS or Windows
hardware. The audit above is from live database state, live service health,
the passing test suites, and reading the code paths.
