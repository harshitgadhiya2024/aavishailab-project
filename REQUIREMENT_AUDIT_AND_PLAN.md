# Requirement Audit & Implementation Plan

Audit date: **2026-09-23** · Branch `main` @ `4226815` · Verified against a freshly
rebuilt local Docker stack (all images rebuilt `--no-cache --pull` on this date),
the live database, and the three test suites.

Source of truth for requirements: [`requirement-details.md`](requirement-details.md).
Prior session transcript (different account): [`another-session-document.md`](another-session-document.md).

**Last published connector version: `2.5.0`** — released by `agent-packages.yml`
run `35766414599` on 2026-09-22 from `8df9234`, all four jobs (macOS / Windows /
Linux / manifest) green. There are no git tags in this repo; every release so far
went out through `workflow_dispatch`. **Next version will be `2.6.0`.**

---

## Part 1 — What actually works right now

The eight questions in `requirement-details.md`, each answered from evidence
rather than from the code's intent.

| # | Requirement | Verdict |
|---|---|---|
| 1 | Web Gateway blocks chatgpt.com / claude.ai, shows the **company's** block page | ✅ Working |
| 2 | Deep security check on every site, unsafe sites blocked | ✅ Working |
| 3 | Policy also applies at app level, with a block page / instruction | ✅ Working |
| 4 | Every installed app logged per tenant; company can block it | ✅ Working |
| 5 | Downloads scanned, reason shown; sandbox for large files | ⚠️ Scanning works, **sandbox is still a stub** |
| 6 | Company laptop → screenshots + 24/7; personal laptop → Disconnect | ✅ Working |
| 7 | DLP must only **log**, never block | ✅ Working |
| 8 | All activity logs on a proper Activity tab | ✅ Working |

Evidence collected this session:

- **Schema is current.** After rebuilding `admin-api` from `main`, the database
  went from 42 to **44 tables**: `installed_applications` was created and
  `screenshots.open_apps` was added, both by the migrations that ship the
  software-inventory and open-apps features. `screenshot_settings.enabled` is
  `true` for the organization on this box, i.e. capture is default-on.
- **Threat intel is populated** — 1,978 feed domains and 169 computed domain risk
  assessments on this dev database (production carries far more).
- **Sidebar matches the requirement list exactly.** `Sidebar.tsx` lists Dashboard,
  Employees, Teams, Devices, Team & Access, Policy Categories, Web Gateway,
  Application Control, Data Loss Prevention, Activity, Screenshots, Access
  Requests, Reports, AI Assistant, Support — and nothing else. Global Policies,
  SSL Inspection, Shadow IT and CASB are gone, as required.
- **Tests:** Go `admin-api` builds clean, 13 packages pass. Python connector
  **146/146**. (The Rust connector suite is covered in Part 3 — it needs a
  toolchain this Mac does not have, so it runs in Docker.)

### The one substantive functional gap: sandbox detonation

`malware-service-rust` computes `would_sandbox` and records it, but there is no
detonation backend wired up — a large or unknown file gets static analysis
(ClamAV + hash reputation + heuristics) and the `would_sandbox` flag, not
behavioural analysis. The flag is also not surfaced anywhere in the UI, so a
reviewer cannot tell "this was scanned statically and flagged for detonation"
apart from "this was fully analysed".

This is an infrastructure decision, not missing code: real detonation needs a
CAPE/Cuckoo cluster. Part 4 proposes closing the *visible* half of it now
(surface `would_sandbox` in the UI and in the block reason) and keeping the
backend behind a config switch.

---

## Part 2 — Defects found this session

Things that were wrong, found by testing rather than by reading.

### 2.1 `Content-Type` for stored images depended on the host machine — **fixed**

`storage.contentTypeForKey` called `mime.TypeByExtension` first. That function
reads the *host's* mime database (`/etc/mime.types`, `/etc/apache2/mime.types`,
the Windows registry), so the same `.ico` app icon was served as
`image/vnd.microsoft.icon` on one machine and `image/x-icon` on another — and in
a scratch container with no mime database at all it fell through to the
`image/webp` default and mislabelled every icon. The Go test suite caught it by
failing on macOS while passing in CI.

Fixed by pinning an explicit extension→type table for every kind of object this
backend actually stores, and consulting the host only for extensions outside it.

### 2.2 "Allowed" events are still surfaced in three places — **open, fixed in Phase 1**

The requirement is absolute: allowed activity must be neither shown nor stored.
Ingestion and the company Activity/Web Gateway/DLP queries were fixed last
session. Three surfaces were missed:

| Where | What it does |
|---|---|
| `handlers/portal.go` — `Me()` | Returns `stats_7d.allowed` to the employee portal |
| `handlers/portal.go` — activity summary | Returns `allowed`, and a `by_day` series with an `allowed` count per day |
| `handlers/reports.go` — `trendByDay` | Every daily point carries an `allowed` count |
| `frontend/employee-portal` dashboard | Renders the allowed number and the allowed series |

Because allowed events are no longer written, every one of these now reports a
permanent **0**. That is worse than removing them: a stat card reading "0
allowed" is a factual claim about the employee's traffic, and it is false.

### 2.3 The release workflow can silently publish a *lower* version — **open, fixed in Phase 5**

`agent-packages.yml` defaults `version` to `1.1.0` in two places
(`inputs.version || '1.1.0'`). A `workflow_dispatch` run that forgets the input
would publish a manifest claiming `1.1.0` while `2.5.0` is live. Every connector
compares with `_version_gt`, so they would all correctly refuse to "update"
— but the dashboard's download button would start handing new employees a
months-old installer. There is no guard against going backwards.

---

## Part 3 — The connector: language decision and the real gap

### The decision: **Rust**, one binary, everything in it

Asked directly which of Python / Go / Rust the connector should be, the answer
is Rust, for reasons specific to this codebase rather than generic benchmarks:

1. **This is the most security-critical component in the product.** The
   connector terminates TLS, holds the org CA's private key, and runs with
   elevated privileges on every employee laptop. A memory-safety bug here is
   remote code execution on the entire fleet. The Python connector hand-rolls
   HTTP parsing across 5,713 lines.
2. **The bet is already placed.** `dlp-service` and `malware-service` are both
   built from their Rust implementations in `docker-compose.yml` today. Moving
   the connector to Rust means one language across every security-critical path;
   adding Go would mean a third language for no gain.
3. **Scale here means per-device cost, not server throughput.** The Python agent
   is thread-per-connection with a 1024 semaphore cap — up to ~2,048 OS threads
   inside one GIL-locked process, on a laptop, in the path of every request.
   That is felt by the employee as heat and lag. Tokio handles the same load in
   a fraction of the memory with no GC pauses.
4. **Go is the reasonable middle, and still loses here.** Simpler concurrency and
   mature tray/webview libraries, and the team already writes Go for `admin-api`
   — but it gives up the memory-safety guarantee on precisely the component
   where that guarantee is worth the most.

`admin-api` **stays Go**: it is a database-bound control plane, not a hot path.
Rewriting it in Rust would buy nothing and cost a great deal.

### Installers, UI and background service are language-agnostic

Every packaging concern survives the switch unchanged — only the binary being
wrapped changes:

| Concern | Today (Python) | After |
|---|---|---|
| Windows `.msi` | WiX around a PyInstaller exe | Same WiX, around `cargo build --release` |
| macOS `.pkg` | `pkgbuild`/`productbuild` | Same, native binary |
| Linux `.deb` | `dpkg-deb` | Same, native binary |
| Desktop UI | `pywebview` (HTML) | **egui/eframe, native** — see below |
| Tray icon | `pystray` | `tray-icon` |
| Screenshots | `mss` + Pillow | `xcap` + `image` |
| Input activity | `pynput` | `rdev` |
| Autostart / background | launchd · systemd · Task Scheduler | identical — an OS mechanism, not a language one |
| Auto-update | urllib + SHA-256 | `reqwest` + `sha2` |

**UI is native (egui), not a webview.** A webview means three different rendering
engines (WebView2, WKWebView, WebKitGTK) with three sets of quirks, and on Linux
`webkit2gtk` is a system package that is not guaranteed to be installed — an
outage source that grows with fleet size. egui renders identically everywhere,
ships inside the binary, and starts instantly. The cost is rebuilding the
existing HTML UI as Rust code; the UI is a status card, a connect/disconnect
button and a tray menu, so that cost is small and one-time.

### Where the Rust connector actually stands

Present and tested (119 unit/integration tests, clippy clean, plus real
Xvfb runs — not just compiled): proxy, MITM/TLS, policy cache, threat
cache, CASB cache, enforcement gate, activity reporting (with the
allowed-event guard), DLP monitor-only scanning, malware scan calls,
heartbeat, device posture, token enrollment, interactive browser
enrollment, software inventory, app control with desktop notification,
company-branded block page, egui desktop window, tray icon,
**screenshot capture + work sessions + open-app enumeration**,
**keyboard/mouse/scroll activity counting**, and **auto-update**.

The already-enrolled-shows-"Not connected" regression flagged below was
found and fixed this session — see Part 5.

Missing, and this is the whole of the remaining work:

| # | Missing from the Rust connector | Python equivalent |
|---|---|---|
| 1 | Uninstall flow — `ui_state.rs` carries `uninstall_allowed`, but `gui.rs` has no email/password screen to act on it | `begin_uninstall` (line 5287) |
| 2 | Packaging for all three platforms, and CI for the packaging step itself (unit tests now run in CI — see Phase 4) | `packaging/*`, `agent-packages.yml` |

Single-instance lock + "show window" signal is done — `single_instance.rs`,
verified by actually starting two real instances under Xvfb: the second
exits cleanly (code 0) while the first keeps running its proxy and
heartbeat undisturbed, the exact launchd race the Python original's own
comment documents having hit on a real Mac.

---

## Part 4 — The plan

Ordered so that each phase is independently shippable and nothing is left in a
half-migrated state. The Python connector stays the shipping path until Phase 6
says otherwise.

### Phase 1 — Finish "no allowed, anywhere" *(small, server + portal)*
Remove the allowed counters from `portal.go` and `reports.go`, drop the matching
UI in the employee portal, retire the now-dead `allowed` chart colour and the
Web Gateway action-colour branch, and purge the historical allowed rows that
predate the storage fix.

### Phase 2 — Rust connector: monitoring parity ✅ done
`posture.rs`, `screenshot.rs` (capture, work sessions, upload),
`activity_monitor.rs` (input counting), and `open_apps.rs`. Plus the
already-enrolled-shows-Connected fix, found and fixed the same way the
prior session found its GTK/Cancel-button bugs: by actually running the
binary under Xvfb, not by reading the code.

### Phase 3 — Rust connector: lifecycle parity *(partial)*
`update.rs` ✅ done (auto-update with SHA-256 verification). `single_instance.rs`
✅ done (advisory file lock — flock on Unix, exclusive `share_mode(0)` open
on Windows — plus the SIGUSR1 "show window" signal, wired into `main.rs`
before anything else touches the network or the proxy port). Still open:
the uninstall flow behind the existing `uninstall_allowed` flag, which
needs a new GUI screen (admin email/password) `gui.rs` doesn't have yet.

### Phase 4 — Packaging the Rust connector
Rewrite `packaging/{linux,macos,windows}` to wrap `cargo build --release`
instead of PyInstaller, keeping WiX / pkgbuild / dpkg-deb exactly as they are.
Add a Rust build+test job to CI.

### Phase 5 — Release `2.6.0`
Fix the workflow's version default so a dispatch can never publish backwards,
then trigger `agent-packages.yml` with `2.6.0`.

### Phase 6 — Cutover
Ship the Rust connector as the default download once it has run on real macOS
and Windows hardware. Until then Python remains the shipping binary and Rust
ships alongside it.

### Not in scope, and why
**Sandbox detonation backend.** Needs a CAPE/Cuckoo cluster — an infrastructure
decision with a cost attached, not something to quietly stand up. What *is* in
scope is surfacing `would_sandbox` so the difference between "statically scanned"
and "detonated" is visible instead of invisible.

---

## Part 5 — Status

Updated as each phase lands.

| Phase | Status |
|---|---|
| 1 — No allowed, anywhere | ✅ Done — verified against a real registered company + employee account (not seeded fixtures), live SQL matching every handler's query, and a rebuilt/restarted admin-api confirming the boot-time purge |
| 2 — Rust monitoring parity | ✅ Done — posture, screenshot capture, activity monitoring, open-app enumeration; 119 tests, clippy clean, live-verified under Xvfb (real screen capture, real `rdev` listener, real window render) |
| 3 — Rust lifecycle parity | ⚠️ Partial — auto-update and single-instance lock done, live-verified with two real instances under Xvfb; uninstall flow still open (see Part 3) |
| 4 — Rust packaging | Not started |
| 5 — Release 2.6.0 | Not started |
| 6 — Cutover | Blocked on real macOS/Windows hardware |

### What "done" means for Phase 1 and 2, concretely

**Phase 1.** Six more unguarded queries found beyond the original sweep
(`portal.go`'s `Me`/activity-summary, `reports.go`'s `trendByDay`/
`groupCount`/`topDetectors`/`hourlyPattern`, `activity.go`'s `Stats` and
its `top_users` join, `employees.go`'s activity log, `organizations.go`'s
platform counter, `shadowit.go`, `mitm_discovery.go`) — each found by
either reading every `activity_events` query in the codebase or by
actually inserting a test "allowed" row through a real company account
and watching which numbers moved. A boot-time purge
(`PurgeAllowedEvents`) now deletes historical allowed rows every start,
not just a one-off migration. A real `Content-Type`-depends-on-the-host
bug in `storage.go` was fixed along the way.

**Phase 2.** Every new module has unit tests, but the two genuinely
hardware-dependent paths — screen capture and the global input listener
— were additionally run against a real X server (Xvfb), not left to
"compiles, therefore works": both produce real, decodable output. The
full binary was also run end-to-end with a pre-enrolled config and an
unreachable admin URL (simulating a laptop that boots before its network
is up), which is exactly how the already-enrolled-shows-"Not connected"
regression was caught — a window that stayed broken indefinitely until
`background.rs` was fixed to match Python's connect-before-network-call
ordering, confirmed fixed by rerunning the identical scenario and
capturing the window afterward.
