# Requirement Audit & Implementation Plan

Audit date: **2026-09-23** · Branch `main` @ `4226815` · Verified against a freshly
rebuilt local Docker stack (all images rebuilt `--no-cache --pull` on this date),
the live database, and the three test suites.

Source of truth for requirements: [`requirement-details.md`](requirement-details.md).
Prior session transcript (different account): [`another-session-document.md`](another-session-document.md).

**Last published connector version: `2.7.1`** (Rust connector — cutover live,
see Phase 6) — released by `agent-packages.yml` run
[35965572986](https://github.com/harshitgadhiya2024/aavishailab-project/actions/runs/35965572986)
on 2026-09-24, all nine jobs green. `manifest`'s "Publish to production"
step now builds from `macos-rust`/`windows-rust`/`linux-rust` and its own
log confirms all three Rust packages were accepted:
```
==> Publishing dist/aavishield-agent-rust-2.7.1.pkg as macos
{"filename":"aavishield-agent-rust-2.7.1.pkg","platform":"macos","status":"published","version":"2.7.1"}
==> Publishing dist/aavishield-agent-rust-2.7.1.msi as windows
{"filename":"aavishield-agent-rust-2.7.1.msi","platform":"windows","status":"published","version":"2.7.1"}
==> Publishing dist/aavishield-agent-rust-2.7.1-amd64.deb as linux
{"filename":"aavishield-agent-rust-2.7.1-amd64.deb","platform":"linux","status":"published","version":"2.7.1"}
```
`2.7.1` fixes a real bug `2.7.0` shipped with: after an employee
disconnected a personal device, the "Connect" button that appeared was a
documented no-op inside the same running process (see
`services/endpoint-agent/src/background.rs`'s `handle_disconnect` —
commit `89d3243`) — the only way to actually reconnect was to fully quit
and relaunch the app, which nothing in the UI prompted anyone to do.
Fixed by exiting the process after disconnect (once the confirmation has
had a moment to paint) so the OS-level supervisor (LaunchAgent `KeepAlive`
on macOS, `systemd`'s `Restart=always` on Linux) brings it back into a
genuine cold start, where the already-removed config file correctly
triggers real browser-based re-enrollment. Windows has no such
supervisor on its Run-key launch, so there the employee reopens the app
from the Start Menu — the same manual step quitting any ordinary Windows
tray app already requires.
The old Python build path still exists as `python-manifest` (CI artifacts
only, `agent-packages-python`, no "Publish to production" step) — an
explicit rollback path, not the live one anymore. There are no git tags in
this repo; every release so far went out through `workflow_dispatch`.

The project's other Docker services — `grafana`, `prometheus`,
`casb-service`, `shadowit-service` — were removed from `docker-compose.yml`
(and their images deleted) on 2026-09-24, since none of them were in
scope for this product and each was standing infra that could only
consume space or drift into a conflict later. `admin-api`'s clients for
the two removed backend services (`casbclient`/`shadowitclient`) already
fail open (`Enabled()` returns `false` when their `*_SERVICE_URL` env var
is unset, and the hot-path caller returns a clean "not configured" allow),
so removing them introduced no new failure mode — verified by reading
that code before removing anything, not assumed. Their source directories
(`services/casb-service`, `services/shadowit-service`,
`infra/grafana`, `infra/prometheus`) are still in the repo, just no
longer part of the running stack or referenced by compose.

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
| 1 | Packaging for all three platforms, and CI for the packaging step itself (unit tests now run in CI — see Phase 4) | `packaging/*`, `agent-packages.yml` |

Everything else in the original gap list is done. Single-instance lock +
"show window" signal (`single_instance.rs`) was verified by actually
starting two real instances under Xvfb: the second exits cleanly (code 0)
while the first keeps running its proxy and heartbeat undisturbed, the
exact launchd race the Python original's own comment documents having hit
on a real Mac. The uninstall flow (`uninstall.rs` + a `gui.rs` dialog) was
verified against a real server with real admin credentials — see Part 5.

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

### Phase 3 — Rust connector: lifecycle parity ✅ done
`update.rs` (auto-update with SHA-256 verification), `single_instance.rs`
(advisory file lock — flock on Unix, exclusive `share_mode(0)` open on
Windows — plus the SIGUSR1 "show window" signal), and the uninstall flow
(`uninstall.rs` + a `gui.rs` dialog for a company administrator's email/
password). The uninstall work also surfaced two more never-wired fields —
`uninstall_allowed` was never sent by the server at all, and never applied
by the Rust heartbeat loop even though every other piece of it existed —
both fixed; see the commit history for the live verification against a
real server with real admin credentials.

### Phase 4 — Packaging the Rust connector *(macOS + Linux done, live-tested; Windows written, unverified; CI wiring still open)*
`packaging/macos/build-rust.sh` and `packaging/linux/build-rust.sh` wrap
`cargo build --release` instead of PyInstaller, keeping pkgbuild/productbuild
and dpkg-deb exactly as they were — same LaunchAgent/systemd-unit shape,
same postinstall self-update chown fix, same enrollment-token contract.
Both were built for real and installed for real, not just written:

- **macOS**: an unsigned `.pkg` built on this Mac, expanded and inspected
  (Info.plist, the real arm64 Mach-O binary, the LaunchAgent plist with its
  `EnvironmentVariables` correctly carrying the deployment URLs), and the
  extracted binary actually run to confirm it starts.
- **Linux**: a real `.deb` built inside the same Docker image CI uses, then
  installed with `apt-get install` into a *clean* `debian:bookworm`
  container (not the build image) — which is what caught a genuinely
  release-blocking bug: the connector's `Depends:` was hand-omitted, so the
  first real install failed with `libgbm.so.1: cannot open shared object
  file`. Fixed by computing `Depends:` with `dpkg-shlibdeps` instead of a
  hand-written list (the GTK stack this links against pulls in ~80
  transitive libraries — a hand list would only ever be an approximation,
  and a wrong one fails exactly like this, only on an employee's machine
  instead of here). Reinstalled clean afterward: `apt-get install` pulled
  every dependency automatically, the binary loaded and ran, `dpkg -r`
  removed cleanly.

`packaging/windows/build-rust.ps1` is written (same WiX shape as the
Python build, CA-trust scheduled task correctly omitted — Rust doesn't
install the CA yet) but **unverified**: no Windows machine, and no way to
even dry-run candle.exe, exists anywhere this was written. Marked as such
in its own header, matching this codebase's existing standard for
Windows/macOS code nobody has run — **until this phase's own CI run
overturned it**, see below.

`agent-packages.yml` gained `macos-rust`/`windows-rust`/`linux-rust`/
`rust-manifest` jobs, building the three Rust packages on GitHub's real
runners and uploading them as their own CI artifacts — kept structurally
separate from the Python connector's `manifest` job so nothing Rust ever
reaches "Publish to production" without a deliberate Phase 6 decision.

The first real run of these jobs found two more genuine bugs — on top of
everything Part 3/README already found by hand on this session's own
Mac — that only a real second platform and a real Windows machine could
surface:

- **linux-rust** failed to even compile on `ubuntu-22.04`:
  `error[E0609]: no field \`flags\` on type \`spa_video_info_raw\``. xcap's
  PipeWire/Wayland-portal backend generates its Rust bindings from
  whatever PipeWire C headers are on the *build* machine, not purely from
  the pinned crate version, and jammy's PipeWire (~0.3.48) predates a
  field `libspa` 0.8.0 assumes exists. Fixed by building on `ubuntu-24.04`
  instead — this crate's dependency chain makes the Python job's "build on
  the oldest glibc" choice untenable for Rust specifically, but
  `dpkg-shlibdeps` still computes an honest, correspondingly newer
  `Depends:` from whatever the newer machine actually links against, so
  the resulting `.deb`'s stated requirements stay accurate.
- **windows-rust** — **the first time any Rust code in this connector had
  ever run on a real Windows machine** — failed with a genuine PowerShell
  parse error against code that parsed cleanly everywhere else this could
  check it (independently verified via a real `System.Management.
  Automation.Language.Parser` call, not just "looks right"). Root cause:
  the workflow invoked it through a *nested* `powershell -File ...` call
  — legacy Windows PowerShell 5.1, a different engine than the pwsh 7
  already running the step — and that path choked on something never
  conclusively isolated (a BOM fix was tried first and did not resolve
  it). Fixed by invoking the script directly (`& .\packaging\windows\
  build-rust.ps1 ...`) from the pwsh step already running, sidestepping
  the legacy shell entirely rather than continuing to chase its exact
  incompatibility with no PS 5.1 anywhere to debug it against.

Both fixes verified by a second full run: all nine jobs green, including
a genuine, first-ever successful `windows-rust` build
(run [35955630878](https://github.com/harshitgadhiya2024/aavishailab-project/actions/runs/35955630878)).
A successful CI package build is not the same claim as "the GUI runs
correctly on a Windows desktop" — see Phase 6 below — but it is real,
new, positive evidence this connector had never had for Windows before
today, and it directly narrows what Phase 6 is still actually waiting on.

### Phase 5 — Release `2.6.0` ✅ done
Fixed the workflow's version-drift bug (a `resolve-version` job every
other job now reads from, instead of each repeating its own
`inputs.version || '1.1.0'` fallback — see Part 2.3), then triggered
`agent-packages.yml` with `2.6.0` for real. All three Python packages
published to production successfully — verified from the run's own log,
not assumed:
```
==> Publishing dist/aavishield-agent-2.6.0.pkg as macos
==> Publishing dist/aavishield-agent-2.6.0.msi as windows
==> Publishing dist/aavishield-agent-2.6.0-amd64.deb as linux
```

### Phase 6 — Cutover ✅ live
The Rust connector is now what "Publish to production" ships. Fixed one
real correctness bug before cutting over: `config::AGENT_VERSION` was a
hardcoded `"1.0.0-rust"` constant no packaging script ever stamped — left
as-is, every real device would have seen the manifest's version as
permanently "newer" and looped `update.rs`'s download-and-swap every six
hours forever. Added `services/endpoint-agent/build.rs` (stamps
`AAVISHIELD_VERSION` at compile time via `cargo:rustc-env`) and updated
all three packaging scripts (`packaging/{macos,linux,windows}/build-rust.sh`/`.ps1`)
to set it before invoking `cargo build`. Then flipped
`agent-packages.yml`'s `manifest` job to depend on
`macos-rust`/`windows-rust`/`linux-rust` instead of the Python jobs, and
released `2.7.0` — publish confirmed live from the run's own log (header,
above). Python's build path is kept as `python-manifest`, CI-artifacts-only,
an explicit one-line-revert rollback if the Rust connector needs to be
pulled back.

**What's still a known gap, not blocking the cutover:** nobody has yet
installed the real Windows `.msi` and clicked through it on an actual
Windows desktop (GUI render, tray icon, Screen Recording/Input Monitoring
prompts, install→enroll→uninstall). macOS *has* been through that full
interactive cycle, this session, on real hardware (Part 3). The Windows
gap was accepted knowingly, not overlooked, before cutting over — CI's
`windows-latest` runner is real Windows hardware and has proven the build
+ unit tests, just not the interactive GUI path a headless runner can't
exercise. Worth closing before the Windows `.msi` sees real fleet volume.

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
| 3 — Rust lifecycle parity | ✅ Done — auto-update, single-instance lock (live-verified with two real instances), and the uninstall flow (live-verified against a real server: correct rejection on a wrong password, correct authorization + device-offline transition on the real org_admin's) |
| 4 — Rust packaging | ✅ Done — macOS + Linux built and live-installed locally; all three (macOS/Windows/Linux) now also build successfully in CI on GitHub's real runners, including the first-ever successful Windows build, after fixing two real bugs that run surfaced (Linux: PipeWire header ABI; Windows: legacy PowerShell parser) |
| 5 — Release 2.6.0 (Python) | ✅ Done — superseded by Phase 6; kept as `python-manifest` rollback path |
| 6 — Cutover to Rust 2.7.0 | ✅ Live — `manifest`'s "Publish to production" now ships Rust packages, verified from the publish step's own log (three `"status":"published"` responses). Remaining known gap: nobody has run the Windows `.msi` through an interactive install→enroll→uninstall cycle on a real desktop yet (macOS has been, this session) |

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

**Phase 3, plus real macOS hardware.** A Rust toolchain was installed on
this Mac and the connector was built natively (`aarch64-apple-darwin`)
for the first time ever — every prior build and test ran inside a Linux
Docker container. That surfaced bugs Linux could not: `libc` had silently
landed under the wrong `[target...]` section in Cargo.toml (resolved by
coincidence on Linux, failed to link everywhere else) and three
`clippy::needless_return` lints in `system_proxy.rs`'s macOS branches,
never linted before because no platform that compiles them had ever run
clippy. Then, going further than a clean build: a real enrollment token
was minted against the real local admin-api and the actual compiled
binary was run — which is how the single biggest gap of this session was
found, **`AAVISHIELD_ENROLL_TOKEN` was implemented (`enroll::
ensure_enrolled`) but never called from the GUI binary's own startup**,
meaning a managed/MDM-pushed install with nobody at the keyboard had no
way to enroll itself. Fixed, then verified: the binary enrolled for
real, its policy-signing key pinned, its local proxy came up, and —
checked directly with `networksetup` and `lsof`, not assumed — this
Mac's real Wi-Fi system proxy flipped on and real applications already
running (Chrome, Microsoft Teams, Cursor) immediately routed through it.
Torn down immediately after and confirmed restored to the exact
pre-test state. The uninstall flow that followed found two more
instances of the identical "implemented, never connected" shape (see
Part 3) before its own real-server verification.

---

## Part 6 — Tech stack: what's built in which language, and why

Asked plainly: for every moving part of this product, which language is it
in, and is that the shipping version or a work-in-progress one. Verified
against the actual repo (`go.mod`/`Cargo.toml`/`requirements.txt` per
directory, and what `docker-compose.yml` actually builds from — not
assumed from a directory name).

### Backend services

| Service | Language | What it does | Notes |
|---|---|---|---|
| `admin-api` | **Go** | The control plane — REST API for both dashboards and the portal, Postgres/GORM, auth, RBAC, billing, all policy/activity/report queries | Database-bound, not CPU-bound — no reason to move off Go (see Part 3) |
| `dlp-service-rust` | **Rust** | Real-time DLP content classification (regex + entropy + file-type detectors) on every upload/download the connector streams through it | The *only* copy — `dlp-service` (Python) was fully retired, not kept as a rollback |
| `malware-service-rust` | **Rust** | ClamAV + hash reputation + static heuristics scoring for every download; `would_sandbox` flag (Part 1, Q5) | `docker-compose.yml` builds from this directory. `services/malware-service` (Python) still exists in the repo as a rollback reference, unused by the running stack |
| `extract-service` | **Python** | Deep content extraction — documents, archives, images+OCR — feeding DLP's classifiers | Python's ecosystem (OCR, document parsers) is the reason this one stayed Python |
| `ai-service` | **Python** | The AI Assistant tab's backend | |
| `casb-service` | **Python** | Cloud-app control-plane checks (the CASB rules the connector's `casb_cache`/`CASBControlCache` consult) | **Removed from `docker-compose.yml` 2026-09-24** — out of scope, not run; `admin-api`'s `casbclient.Enabled()` fails open cleanly (confirmed by reading the code, not assumed) so nothing else broke. Source kept in repo, unused |
| `threatintel-service` | **Go** | Threat-feed ingestion + the domain risk-scoring engine (Part 1, Q2 — 10,746+ feed domains) | |
| `posture-service` | **Go** | Scores the posture signals every connector's heartbeat carries (disk encryption, firewall, etc.) into a device posture verdict | Stays Go — trivial weighted-boolean scoring + sorted-array binary search, no CPU-bound or untrusted-binary-parsing work that would justify Rust here |
| `shadowit-service` | **Go** | Shadow-IT domain rollup / discovery | **Removed from `docker-compose.yml` 2026-09-24** — same reasoning and same fail-open safety check as `casb-service` above. Source kept in repo, unused |
| `scripts/loadtest` | **Go** | Load-testing harness against the live stack — not a shipped service | |

### Frontends

All three dashboards and the docs site are **TypeScript / Next.js / React**:
`frontend/company-dashboard`, `frontend/employee-portal`,
`frontend/superadmin`, `frontend/docs`.

### The client connector — the one piece split across two languages right now

This is the actual nuanced answer, because it's mid-migration (see Part 3
for the full decision). **Python is what real employees download today**
(`scripts/agent/aavishield-agent.py`, 5,713 lines) — every requirement in
this document works there. **Rust** (`services/endpoint-agent`, ~7,900
lines across 37 modules) has reached full feature parity as of this
session and now builds successfully on all three real platforms in CI, but
has not yet been interactively verified on Windows and isn't shipped
anywhere yet (Phase 6, still open).

| Capability | Python (shipping) | Rust (CI-built, not yet shipped) |
|---|---|---|
| Proxy, MITM/TLS, policy/threat/CASB cache | ✅ | ✅ |
| DLP monitor-only, malware scan calls | ✅ | ✅ |
| Heartbeat, device posture | ✅ | ✅ |
| Token-file + interactive browser enrollment | ✅ | ✅ |
| Software inventory | ✅ | ✅ |
| Application control + block notification | ✅ | ✅ |
| Company-branded block page | ✅ | ✅ |
| Screenshot capture + work sessions + open-app list | ✅ | ✅ |
| Keyboard/mouse/scroll activity counting | ✅ | ✅ |
| Auto-update | ✅ | ✅ |
| Single-instance lock | ✅ | ✅ |
| Uninstall flow | ✅ | ✅ |
| Desktop window + tray icon | ✅ (pywebview + pystray) | ✅ (native egui — see README's "Why egui, not a webview") |
| Packaging (macOS `.pkg` / Windows `.msi` / Linux `.deb`) | ✅ — this is what installs on a real employee machine today | ✅ builds in CI on real runners (Part 4/5); not signed, not distributed |
| Real-device interactive verification | ✅ (it's been shipping) | ⚠️ macOS: yes, this session, on real hardware. Windows: builds, not yet run interactively. This is the entire Phase 6 gate |

The two are **not** duplicate implementations of the whole system — they're
the same connector, one battle-tested in production, one built to the same
spec and now hardware-verified for build correctness on every platform,
gated on the last mile (real interactive Windows testing) before cutover.

### Why this split, briefly

- **Go**: database-bound control-plane work (`admin-api`) and services
  whose job is mostly "poll a feed / score against Postgres"
  (`threatintel-service`, `posture-service`, `shadowit-service`). CPU
  isn't the bottleneck there, so Rust would cost real effort for no
  measurable gain.
- **Rust**: everywhere a memory-safety bug is a security incident, or
  per-device CPU/memory footprint matters at fleet scale —
  content-scanning services already committed to it
  (`dlp-service-rust`, `malware-service-rust`), and the connector is
  mid-migration to it for the same reason (Part 3 has the full
  reasoning).
- **Python**: where the ecosystem is the actual advantage — document/
  OCR extraction (`extract-service`), and historically the connector,
  before this migration.
- **TypeScript/Next.js**: all three dashboards and docs — no reason to
  diverge there; it's a UI concern, not a performance one.
