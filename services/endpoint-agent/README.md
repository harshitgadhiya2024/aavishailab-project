# aavishield-agent (Rust)

A Rust rewrite of the core data plane of `scripts/agent/aavishield-agent.py`
— the TLS-intercepting forward proxy that runs on every employee laptop.
This is Phase 3 of the Rust migration plan, delivered as scoped groundwork
(a real test suite for the Python original) plus this core rewrite, done
after that groundwork rather than in place of it.

**This does not replace the Python agent in production.** It is not
signed, not notarized, not packaged as an installer, and its macOS system-
integration code has not run on real macOS hardware. See **Scope and
verification status** below before treating this as more than what it is.

## Why Rust, specifically here

At the scale the migration plan targets (100k+ endpoints), the Python
agent's architecture is thread-per-connection with a `BoundedSemaphore`
cap of 1024 and 512KB stacks — up to ~2048 OS threads inside one
GIL-bound CPython process per device. The plan's own comment on this
file, kept accurate here: *"the biggest architectural payoff... but
highest risk: 3,590 lines, zero tests, and it runs on customer machines
where a regression means a broken laptop."* The risk half of that
sentence is why this took the form it did — see below.

## What's actually in this rewrite

Ported field-by-field from the Python original, with a Rust module per
Python class/section:

| Module | Python original | What changed |
|---|---|---|
| `policy_cache.rs` | `PolicyCache` | Same domain-matching algorithm (exact → parent-walk, skipping single-label parents, org-specific-beats-global) |
| `threat_cache.rs` | `ThreatIntelCache` | Same TTL cache semantics |
| `casb_cache.rs` | `CASBControlCache` | Same (host, activity)-keyed TTL cache |
| `enforcement.rs` | `EnforcementGate` | Same full/security_only/paused capability matrix, monotonic `Instant` instead of `time.monotonic()` |
| `rfc3339.rs` | `_parse_rfc3339`/`_seconds_between` | The `time` crate's RFC3339 parser handles arbitrary fractional-second precision natively — the "truncate Go's 9 digits to Python's 6-digit limit" hack simply isn't a problem here |
| `activity.rs` | `ActivityReporter` | Same dedup-window + gate-integration logic |
| `mitm.rs` | `MITMEngine` | Same leaf-cert fetch/cache/prune logic |
| `tls_proxy.rs` + `proxy.rs` | `ProxyConnection`, `_handle_https`/`_handle_mitm_tls`/`_serve_over_tls`/`_handle_http` | **Structurally different, not just translated** — see below. Both the MITM'd HTTPS path (`tls_proxy.rs::relay_one`) and the plain HTTP path (`proxy.rs::forward_plain_http`) call the same `scan.rs` functions, so upload/download scanning can't drift between the two transports |
| `scan.rs` | the DLP/malware/CASB scan calls inside `ProxyConnection` | Same endpoints, same fail-open contract, same CASB-before-DLP ordering. `upload_verdict()`/`download_verdict()` are the single shared decision point both proxy paths call — see **Real-time DLP/CASB coverage** below |
| `system_proxy.rs` | `system_proxy_active`/`clear_system_proxy`/`apply_system_proxy` | Same per-OS commands/registry keys |
| `enroll.rs` | the token-file half of `ensure_enrolled` | Interactive browser-callback flow not ported — see Scope |
| `heartbeat.rs` | `send_heartbeat`/`heartbeat_loop` | Posture collection not ported — see Scope |

### The one deliberately different piece: HTTP parsing

The Python original hand-parses HTTP text: `buf += chunk` for header
reads (O(n²), and — the migration plan's own finding — **unbounded for
requests**), manual `Content-Length`/chunked-encoding handling, and a
comment trail of real production bugs from exactly this kind of code
(`_handle_request` isn't named `_handle` because CPython 3.13 added a
private `_handle` attribute to `threading.Thread` that silently
shadowed it and reset every connection in production).

This rewrite uses `hyper` — the same HTTP engine `dlp-service-rust` and
`malware-service-rust` already trust — for both legs of every relay:
`hyper::server::conn::http1` to parse what the client sends,
`hyper::client::conn::http1` to speak to the real upstream. Content-
Length, chunked encoding, and keep-alive are hyper's problem now, not
hand-rolled text parsing's. This removes that entire bug class by
construction, which is as much the point of this rewrite as performance
is.

## Real-time DLP/CASB coverage

Every upload — any application or browser, any file type, over either
transport this proxy handles — goes through the same two-stage check
before it leaves the machine:

1. **CASB app-control** (`casb_cache.rs` + `scan.rs::upload_verdict`):
   coarse "is this host allowed to receive uploads at all" gate, checked
   first because it's a cached lookup, not a content scan.
2. **DLP content scan** (routed to `dlp-service-rust` via admin-api's
   `/internal/agent/scan-dlp`): the actual body bytes, scored against the
   org's configured detectors (`credit_card`, `aws_key`, `source_code`,
   etc.), with `filename`/`content_type` passed through so
   filetype-aware rules (`bypass_file_types`) work.

Downloads get the mirror-image malware check
(`scan.rs::download_verdict` → `/internal/agent/scan-file`, backed by
ClamAV + hash reputation in `malware-service-rust`).

**This coverage is transport-agnostic on purpose.** An earlier version of
this rewrite only wired scanning into the MITM'd HTTPS path
(`tls_proxy.rs`) and never called CASB at all — a real gap, since plain
HTTP (older internal tools, unencrypted APIs) is a live upload vector too,
and a DLP control that only inspects encrypted traffic isn't actually a
DLP control. Both gaps are closed: `proxy.rs::forward_plain_http` now
calls the identical `scan.rs` functions `tls_proxy.rs::relay_one` does, so
whichever path a given upload takes, the verdict is computed the same
way. Live-verified with real multipart/form-data uploads (`curl -F`,
matching actual browser file-input behavior) of four genuinely
format-valid files — a `.txt` with an embedded AWS key, a `.csv` with
credit card numbers, a hand-built valid `.pdf` with a credit card number
in its visible text stream, and a valid `.png` with an AWS key hidden in
a `tEXt` metadata chunk — each sent over **both** plain HTTP and MITM'd
HTTPS. The AWS-key cases (both file types) blocked with 403 on both
transports; the credit-card cases scored below the configured block
threshold on both transports (confirmed via direct `scan-dlp` calls that
detection genuinely fired — correctly calibrated scoring, not a coverage
gap). Regression coverage for the two specific gaps (CASB never being
checked; plain HTTP never being scanned) lives in `scan.rs`'s
`test_casb_block_applies_even_to_empty_body_uploads`,
`test_disabled_enforcement_skips_casb_check_too`, and
`tests/live_integration_test.sh`'s plain-HTTP DLP block check.

### The block page always names the reason

Matching the SWG domain-block page's pattern, a DLP/CASB/malware block
renders the same branded page a domain block does — the destination
host, a human-readable reason (`"Sensitive company data detected: AWS
Access Key"`, not just "blocked"), and a category (`Data Loss
Prevention` / `Malware Protection` / `CASB App Control`) — instead of a
bare browser connection-error screen:

```html
<h1>Access to this site is blocked</h1>
<p><strong>httpbin.org</strong></p>
<p>Sensitive company data detected: AWS Access Key</p>
<p>Category: Data Loss Prevention</p>
```

## Scope — what's NOT in this rewrite, and why

Every one of these is a real, deliberate cut, not an oversight:

- **Screenshot capture, keystroke/mouse activity counting, the tray UI.**
  Employee-monitoring/UX features, not core interception. Porting them
  needs platform capture APIs (`mss`/`PIL` → something like `xcap`,
  `pynput` → `rdev`, `pystray` → `tray-icon`) that are additional,
  independent scope with no bearing on the actual security data plane.
- **Interactive browser-callback enrollment** (`browser_enroll` — opens
  a browser, listens on loopback :6119). Only **token-file enrollment**
  is ported (env var or a drop file at `~/.aavishield/enroll.json` /
  `/etc/aavishield/enroll.json`), which is what an actual managed
  deployment (packaged installer, MDM push) uses. The interactive flow
  is a first-run convenience for a human clicking through a manual
  install.
- **Posture collection** (disk encryption / firewall / OS-update /
  screen-lock / antivirus probes). The heartbeat still fires and still
  applies the returned enforcement verdict — the security-relevant half
  — but doesn't report device posture signals.
- **Actually installing the CA into the OS trust store**
  (`_install_ca_darwin`/`_install_ca_linux`/`_install_ca_windows`, and
  the privileged `--ca-trust-daemon` process). Only the **check**
  (`config::mitm_ca_trusted`) is ported. This is installer/packaging
  infrastructure, gated on code-signing/notarization this build
  environment doesn't have.
- **CA-trust-daemon, root-privilege separation, packaging.** Same reason.

## Verification status — read this before trusting any of it

**Linux: fully built and live-tested.** Every claim below this line is
measured, not assumed.

**Windows: cross-compiles cleanly, not device-tested.**
```
rustup target add x86_64-pc-windows-gnu
cargo build --target x86_64-pc-windows-gnu
```
produces a real `aavishield-agent.exe` (`file` reports `PE32+ executable
... for MS Windows`). The registry-based system-proxy code
(`system_proxy.rs`'s `#[cfg(target_os = "windows")]` branches) compiles
against the real `winreg` crate but has never run against a real
Windows registry.

**macOS: written, not even compile-checked.** Cross-compiling for macOS
from Linux needs Apple's SDK, which isn't something to fetch from an
unofficial source into a build pipeline. The `networksetup`-based
`#[cfg(target_os = "macos")]` branches are a faithful translation of the
Python original's command sequences, but have not been type-checked by
a macOS toolchain, let alone run.

**Before shipping this to a single real endpoint**, at minimum: build
and run on real macOS and Windows hardware, verify the system-proxy
code actually changes a real desktop's settings (not just "doesn't
crash"), and get a code-signing/notarization pipeline in place — none
of that is possible in this environment.

### What live testing actually proved (Linux, this build host)

Ran `tests/live_integration_test.sh` against the **real, running
docker-compose stack** — actual admin-api, actual Postgres, actual
dlp-service — not mocks:

```
$ cd services/endpoint-agent && cargo build --release
$ ./tests/live_integration_test.sh
  OK   enrolled (config written)
  OK   plain HTTP to example.com -> 200
  OK   plain HTTP to blocked httpbin.org -> 403
  OK   fetched org CA cert
  OK   default-trust HTTPS correctly rejects our leaf cert
  OK   MITM'd HTTPS to example.com -> 200, verified against our own CA
  OK   response body is genuine upstream content
  OK   AWS key upload -> 403 (DLP block)
  OK   block page correctly names the detector
  OK   AWS key upload over plain HTTP -> 403 (DLP block)
  OK   plain-HTTP block page correctly names detector and category
  OK   5 activity events recorded
=== ALL LIVE INTEGRATION CHECKS PASSED ===
```

The MITM checks are the ones that matter most: a request through the
proxy **fails TLS verification against curl's default trust store**,
and **only succeeds when explicitly trusting the org's own CA** fetched
live from admin-api's real `/internal/mitm`-backed endpoint. That's
cryptographic proof this is genuinely terminating and re-encrypting
TLS with a dynamically-issued leaf certificate — not a blind tunnel
that happens to pass traffic through.

### A real bug this live testing caught (not in this crate)

Testing this agent against the real admin-api surfaced a genuine
correctness bug in the Go admin-api's Redis caching added in Phase 1.2
of the migration plan: `GetRules`' cache TTL was refreshed on every
cache *hit*, so a continuously-polling device (the normal case — every
device polls every 10s) would keep its cache alive indefinitely. An
admin's policy change would then **never** reach an actively-connected
device, not "within one missed poll" as documented. Seeded a
`domain_rules` row against a running instance of this agent and watched
it never take effect until the fix. See
`services/admin-api/internal/handlers/agents.go`'s `GetRules` comment
and `agents_cache_test.go`'s
`TestRulesCacheEntryExpiresDespiteContinuousReads` for the fix and its
regression test. This is exactly the kind of bug that a rewrite's own
test suite won't catch and only running the real thing against the
real system will — the reason `tests/live_integration_test.sh` exists
as a checked-in, repeatable script rather than a one-off manual pass.

## Tests

```bash
cargo test          # 56 unit/integration tests, no network
cargo clippy --all-targets   # clean, zero warnings
```

56 tests across every module, largely mirroring the 51-test suite
written for the Python original (`scripts/agent/tests/`) so both
implementations are checked against the same behavioral spec — domain-
matching edge cases (TLD protection, org-vs-global precedence, `www.`
stripping), the enforcement gate's full capability matrix per mode,
RFC3339 edge cases, activity dedup, cache TTL/eviction, and MITM bypass-
list matching (exact/wildcard/parent-domain).

## Local development

```bash
cargo build --release
cargo test
cargo clippy --all-targets

# Enroll and run against a local admin-api:
AAVISHIELD_ENROLL_TOKEN=<token> AAVISHIELD_ADMIN_URL=http://127.0.0.1:7100 \
  RUST_LOG=info ./target/release/aavishield-agent
```

The local proxy listens on `127.0.0.1:6118` (matches
`config::LOCAL_PORT`, same as the Python original) — point a browser or
`curl -x http://127.0.0.1:6118` at it once enrolled.
