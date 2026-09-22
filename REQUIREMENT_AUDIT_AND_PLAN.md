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

## Part 4 — Phased implementation plan

Ordered so each phase ships something verifiable, and so the two phases that require a new
connector build land together at the end.

### Phase 1 — Company portal shape *(frontend + small backend; no connector change)*
1. Remove the Policies, SSL Inspection, Shadow IT and CASB tabs; delete their pages and API helpers;
   repoint the two inbound links.
2. Web Gateway tab: add the paginated activity log with the seven required fields.
3. DLP tab: strip policy creation and policy links; make it a pure log view with the six required fields.
4. Activity tab: source tabs — Web Gateway, DLP, Application, Download protection, Device posture.

### Phase 2 — DLP becomes monitor-only *(backend + connector)*
1. Clamp every DLP verdict to `log`/`alert`; never return `block`.
2. Remove the DLP block-page and in-page overlay paths from the agent; let the upload through and
   record it.
3. Capture the required log fields at scan time: request source (app vs browser), destination,
   category (`text` vs `file-upload`), reason, risk score.
4. Default DLP **and** SSL inspection to on for every organisation, including existing ones.

### Phase 3 — Installed application inventory *(new model + connector + UI)*
1. New `InstalledApplication` model, tenant-scoped, keyed on (device, app identity).
2. Per-OS collector in the agent: Windows registry uninstall keys, macOS `/Applications` +
   `system_profiler`, Linux `dpkg`/`rpm`/`snap`/`flatpak`, plus manually downloaded binaries.
3. Ingest endpoint with dedupe and first-seen/install-time tracking; emits an activity event per new install.
4. Rebuild the Application Control tab employee-wise with the required columns and per-employee
   Network Block / App Block switches.

### Phase 4 — Block page and app-level feedback *(backend + connector)*
1. Per-org block-page branding (name, logo, custom message) delivered to the agent.
2. Company-branded block page for web, download and app-control blocks.
3. Desktop notification when an app is blocked, explaining why and what to do.

### Phase 5 — Device ownership and screenshots *(backend + connector)*
1. Screenshots default on; company-owned devices capture 24/7.
2. Send `ownership` to the agent; show Disconnect only on personal devices.
3. Capture the list of open applications with each screenshot and show it beside the image.

### Phase 6 — Remaining protection gaps *(backend)*
1. Surface `would_sandbox` as "pending deep analysis" in the UI; wire the CAPE backend behind config.
2. Emit one device-posture activity event per device per day.

### Phase 7 — Release
Build and publish connector **2.5.0** via the `agent-packages.yml` workflow, then verify the
manifest and the auto-update path.

---

## Appendix — verification evidence

- `go build ./...` and `go test ./...` in `services/admin-api`: **all packages pass** (14 test packages green).
- Live containers: admin-api, dlp, malware, extract, threatintel, posture, shadowit, casb, clamav,
  postgres, redis, all three frontends — all healthy.
- Database: 43 tables. No `installed_applications` table exists. `screenshots` = 0 rows.
  `threat_intel_domains` = 10,746. `domain_risk_assessments` = 482.
- Policies present: 2 × `url_category/block`, 2 × `domain/block`, 1 × `dlp/block`.
- Activity events: `web_request/allowed` 3978, `policy_violation/alerted` 382,
  `policy_violation/blocked` 313, `web_request/blocked` 106, `device_connect/logged` 8.

**Not verified end-to-end:** browser-level click-through of each dashboard tab against a live login.
Doing that needs a company-dashboard account password; the audit above is from live database state,
live service health, the passing test suite, and reading the code paths.
