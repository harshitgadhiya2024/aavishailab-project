# Aavishield / Delphic Secure — Implementation Summary

**What was built**, feature by feature, to bring the platform to Zscaler-style
breadth. Every capability is a **separate microservice** (multi-microservice
architecture) with org-bound HMAC service auth, fail-open/degraded fallbacks,
its own tests, and a live end-to-end HTTP check. `admin-api` is the control
plane / API gateway; each service is stateless compute you can scale
horizontally.

**Verify everything:** `./scripts/run-all-tests.sh` → *7 passed, 0 failed*.

| # | Feature | Service (port) | Lang | Tests |
|---|---------|----------------|------|-------|
| 1 | DLP (weighted scoring, >80 block / 50-80 alert) | `dlp-service` (6200) | Python | 40 |
| 2 | Malware + sandbox hook + ML hook | `malware-service` (6210) | Python | 29 |
| 3 | Threat intel (domain/IP/hash reputation) | `threatintel-service` (6220) | Go | ✓ |
| 4 | Device posture + GeoIP | `posture-service` (6230) | Go | ✓ |
| 5 | Shadow IT discovery | `shadowit-service` (6240) | Go | ✓ |
| 6 | CASB (inline + out-of-band) | `casb-service` (6250) | Python | 23 |
| 7 | Native client connector (packaging) | `endpoint-connector` | Python | syntax-verified |

---

## Cross-cutting security (every service)
- **Org-bound HMAC service token** minted by admin-api, verified per request — a
  token for org A can never scan/act for org B (each cross-language pairing was
  E2E-tested: Go mints ↔ Python/Go verifies; wrong-org ⇒ 401; expired ⇒ 401).
- **Per-service secret**, non-root containers, size caps, no raw sensitive data
  persisted or echoed (DLP/malware return only **masked** previews).
- **Fail-open / graceful degrade**: if a service is unreachable, admin-api falls
  back (DLP → in-process scanner, malware → in-process ClamAV, threat-intel →
  in-process engine) so protection never hard-breaks on an outage.

---

## 1. DLP — `dlp-service` (Python)
- Detectors ported from the Go engine (credit card+Luhn, Aadhaar+Verhoeff, PAN,
  AWS key+entropy, GitHub token, generic API key, source code, keywords, custom
  regex) with **per-match weights** → a **0–100 document score** → the required
  **≥80 block / 50–79 alert / <50 allow** bands (per-org configurable).
- Most-severe-policy-wins; policy action caps the band (alert-only never blocks).
- **Wiring:** agent → admin-api `/internal/agent/scan-dlp` proxies to the
  service; events logged with score+band. **Dashboard:** threshold sliders +
  "test a sample" box + score column on incidents.

## 2. Malware — `malware-service` (Python)
- Score = hash reputation (known-bad/good, EICAR) → ClamAV signature → **static
  heuristics** (exe-masquerading-as-doc, Office macros, packed/high-entropy,
  obfuscated scripts, double extensions) → **0–100 + bands**.
- **Sandbox hook**: suspicious unknowns flagged `would_sandbox`; pluggable CAPE
  backend. **ML hook**: heuristic scorer is where a trained PE classifier slots
  in (shipped deterministic heuristics, not a faked model).
- **Wiring:** agent download-scan path now sends file metadata, respects
  block/alert/allow, logs incidents with score+band; fail-open to ClamAV.

## 3. Threat Intel — `threatintel-service` (Go, stdlib-only)
- Syncs free feeds into memory (URLhaus, OpenPhish, Feodo, MalwareBazaar) and
  scores **domain / IP / file-hash** reputation (feed hit + DNS heuristics) →
  0–100 + bands. Extends the old domain-only engine to **IPs and hashes**.
- **Wiring:** admin-api `GET /api/v1/swg/threat-lookup?domain=|ip=|hash=`
  (fallback to in-process riskengine for domains).

## 4. Device Posture + GeoIP — `posture-service` (Go, stdlib-only)
- **Posture:** disk encryption / firewall / OS patch / screen lock / AV →
  0–100 → pass/warn/fail (off = full penalty, unknown = half).
- **GeoIP:** private/CGNAT detected natively; public IPs via a mounted free
  country CSV (works without it). Closes the "location missing" gap.
- **Wiring:** the **agent now reports posture each heartbeat** (best-effort,
  read-only, per-OS); admin-api resolves country, stores `posture_score` +
  `geo_country` on the device, and raises an incident on posture **fail**.

## 5. Shadow IT — `shadowit-service` (Go, stdlib-only)
- Classifies domains against a ~50-app catalog (app, category, 0–100 risk),
  parent-domain matching, JSON override to grow the catalog.
- **Wiring:** admin-api rolls up `activity_events` by domain (requests, distinct
  users, first/last seen), classifies each, marks sanction status from domain
  rules; **sanction/block/reset** writes a `source=shadow_it` domain rule that
  flows to devices. **Dashboard:** Shadow IT page with one-click actions.

## 6. CASB — `casb-service` (Python)
- **Inline app-control:** allow/alert/block a SaaS activity (upload/download/
  share/post) by category / sanction / risk; org rules override conservative
  defaults.
- **Out-of-band:** provider-agnostic analyzer flags risky cloud shares (public
  links, external shares of sensitive docs) with severity + remediation;
  Google/M365/Box adapters are a documented OAuth seam, `manual` provider works.
- **Wiring:** admin-api `/api/v1/casb/app-control` + `/api/v1/casb/oob/analyze`.
  **Dashboard:** CASB page (inline decision tester + cloud-share scanner).

## 7. Native Client Connector — `endpoint-connector` (packaging)
- Turns the downloaded shell script into a **signed native app with a menu-bar/
  tray UI** (`tray.py`: status, device identity, portal/logs, pause/resume).
- `aavishield-connector.spec` (PyInstaller) bundles tray + agent; `build-macos.sh`
  (sign + notarize → `.pkg`) and `build-windows.ps1` (sign → Inno Setup `.exe`).
  Enforcement logic reused 100%. Phase-2 native tunnel (Network Extension / WFP)
  documented as the next step.

---

## New/changed integration points in `admin-api`
- Clients: `dlpclient`, `malwareclient`, `threatintelclient`, `postureclient`,
  `shadowitclient`, `casbclient` (each mints the HMAC token + proxies, with
  fallback).
- Handlers/routes: `POST /api/v1/dlp/test`, `GET /api/v1/swg/threat-lookup`,
  posture+geo enrichment in `Heartbeat`, `GET/POST /api/v1/shadow-it/*`,
  `POST /api/v1/casb/*`.
- Agent (`aavishield-agent.py`): download-scan uses new bands + metadata; posture
  collector reports each heartbeat.
- `docker-compose.yml` + `.env(.example)`: all six services wired.

## What is production-ready vs reference
- **Production-ready & tested:** all scoring/detection engines, inline CASB,
  OOB analyzer, posture, threat-intel, shadow-IT, all admin-api wiring, agent
  changes.
- **Reference / needs credentials or infra:** malware **sandbox** detonation
  (needs a CAPE cluster), CASB **out-of-band connectors** (need per-tenant
  OAuth), GeoIP **country CSV** (mount a free export), native installer
  **signing** (needs Apple Developer ID / Windows cert). Each is a documented,
  isolated seam — the surrounding logic is done and tested.
