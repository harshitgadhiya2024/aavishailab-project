# Aavishield / Delphic Secure — Feature Status & Zscaler-Parity Roadmap

**Date:** 2026-07-23
**Scope:** Analysis of the current codebase against the requirements in `feature_text.txt`, benchmarked against Zscaler (`Zscaler_features_document.pdf` + web research).
**Purpose:** Show what is **Done / Partial / Missing**, *how* the done parts were built, and *exactly what is required* to bring each feature to a Zscaler-grade, production, scalable level.

---

## 1. Executive Summary

The product today is a **working single-tenant-per-org SWG + DLP + endpoint-enforcement platform** with a genuinely functional data plane. Unlike a mockup, the core loop actually runs end to end:

> Employee installs an agent → the agent becomes a **local HTTP/HTTPS proxy** on the device → it pulls the org's rules from the cloud API → it **blocks/allows domains, scans downloads for malware (ClamAV), scans uploads for sensitive data (DLP), and can do TLS interception (MITM)** → it reports every event back → the company dashboard sees live activity.

That is architecturally the same *shape* as Zscaler Client Connector + ZIA, but **collapsed onto the endpoint** instead of a global cloud edge. The single biggest architectural difference from Zscaler is: **Aavishield enforces on the device (agent = the proxy); Zscaler enforces in the cloud (agent = a tunnel to 150+ PoPs).** See §4.

**Scorecard against `feature_text.txt`:**

| # | Requirement | Status | Confidence |
|---|-------------|--------|-----------|
| 1 | Device & network check (MAC, IP, location) | 🟡 Partial | MAC + IP done, location missing |
| 2 | Delphic Secure Client connector | 🟡 Partial | Works as a Python script + system proxy, not a native app |
| 3 | Web browsing rules | 🟢 Done | Domain + category + policy engine live |
| 4 | Malware detection (risk >80 block, 50–80 alert) | 🟡 Partial | ClamAV signature scan done; the 50–80 *alert band* not wired |
| 5 | SSL/HTTPS inspection (bypass sensitive sites) | 🟢 Done | Per-org MITM with bypass list |
| 6 | Download protection | 🟢 Done (HTTP) / 🟡 (HTTPS) | HTTP scanned; HTTPS only when MITM on |
| 7 | Upload protection – DLP (>80 block, 50–80 alert) | 🟡 Partial | Detectors work; scoring-band model not implemented |
| 8 | Threat Intelligence – risk score | 🟢 Done | Free feeds + 0–100 scoring engine |
| 9 | Shadow IT discovery | 🔴 Missing | No SaaS catalog / discovery |
| 10 | CASB integration | 🔴 Missing | No API-based (out-of-band) CASB |

Legend: 🟢 Done · 🟡 Partial · 🔴 Missing

---

## 2. What Exists Today (Architecture Map)

| Component | Tech | Role | Maturity |
|-----------|------|------|----------|
| `services/admin-api` | Go (Gin, GORM, Postgres, Redis) | Control plane: auth, orgs, employees, policies, SWG rules, DLP scan endpoint, malware scan endpoint, MITM CA + cert signing, threat-intel sync, risk engine | **Solid** |
| `services/endpoint-agent` → `internal/handlers/assets/aavishield-agent.py` | Python local daemon | **The data plane.** Local proxy on `127.0.0.1:6118`, policy cache, download/upload scanning, MITM/TLS termination, heartbeat, activity batching | **Solid, but Python-script based** |
| `services/swg-engine` | Go proxy | A *separate* network-side proxy (LAN gateway model). Largely superseded by the on-device agent | **Legacy/secondary** |
| `services/ai-service` | Python (FastAPI) | Agentic AI assistant with tools (query activity, create policy, stats) | **Working** |
| `frontend/company-dashboard` | Next.js | Org admin console (policies, activity, employees, SWG) | Working |
| `frontend/superadmin` | Next.js | Platform operator console | Working |
| `frontend/employee-portal` | Next.js | Employee self-service + installer download | Working |
| Postgres / Redis / Prometheus / Grafana / cloudflared | Docker Compose | Infra | Dev-grade |

**Key backend building blocks already present:**
- `internal/riskengine/` — real 0–100 domain risk scoring (threat-intel feed hit, URL category, WHOIS domain age, DNS/entropy heuristics), ClamAV integration, feed workers. `BlockThreshold = 80`.
- `internal/dlp/` — detectors for credit card, PAN, Aadhaar, AWS keys, GitHub tokens, generic API keys, source code, keyword + custom regex; file-type bypass.
- `internal/mitm/` — per-org root CA, encrypted key at rest, short-lived leaf cert signing (72h). This is the hard part of SSL inspection and it is **done**.
- `models.go` — data model already includes `Device` (with MAC/IP/posture), `DomainRule`, `ThreatIntelDomain`, `DomainRiskAssessment`, `AccessRequest`, `OrgCACert`, `AgentToken`, `EnrollmentToken`.

---

## 3. Feature-by-Feature Deep Dive

### 3.1 Device & Network Check — 🟡 Partial

**Requirement:** capture MAC, IP, and location from the device every time.

**How it's built today:**
- **MAC** captured at enrollment (`agents.go` Enroll, `req.MACAddress`, stored on `Device`).
- **IP** captured on every heartbeat (agent `get_local_ip()` → `Heartbeat` handler, every 60s).
- Device posture score field exists (`Device.PostureScore`, default 100) but is not yet computed from real signals.

**Gap to Zscaler level:**
- **Location is not captured.** No geo-IP resolution, no OS location API. `ActivityEvent` has `GeoCountry`/`GeoCity` columns but they're unpopulated.
- MAC is only taken at enroll, not "every time" — and MAC is spoofable/rotating on modern OSes, so Zscaler leans on **device posture + certificate identity**, not MAC.
- No continuous **device posture** (disk encryption, OS patch level, AV present, firewall on) — Zscaler ties policy decisions to posture.

**To reach Zscaler parity:**
1. Add a GeoIP step server-side (MaxMind GeoLite2 DB, free) to fill `GeoCountry/GeoCity` from the reported IP on every heartbeat/event.
2. Add an OS-level posture collector to the agent (encryption on/off, firewall, OS version, screen-lock) → compute `PostureScore` → make it a **policy condition** ("block if posture < 70").
3. Move device identity from MAC to a **per-device client certificate** (already have a CA — reuse it).

---

### 3.2 Delphic Secure Client Connector — 🟡 Partial *(this is your headline question — see §4 for the full answer)*

**Today:** the employee downloads a **shell installer** (`portal.go DownloadInstaller`) that drops the Python agent, registers it as a `launchd`/`systemd` service, and sets the **OS system proxy** to `127.0.0.1:6118`. It even locks Chrome/Edge/Brave/Firefox proxy policy so a VPN browser extension can't bypass it.

**This already behaves like a client connector** — it auto-starts, self-updates rules every 10s, heartbeats, and fails open. But it is a **Python script**, not a signed native application. See §4 for how to turn it into a true Zscaler-style connector.

---

### 3.3 Web Browsing Rules — 🟢 Done

**How:** `DomainRule` + `Policy` (types: `url_category`, `domain`, `application`, `dlp`, `time_based`, …) + `CategoryDomain` mapping + `config/domain_categories.json` seed. The agent's `PolicyCache` pulls effective rules (`/internal/agent/rules`), walks parent domains (so `cdn.instagram.com` inherits `instagram.com`), org rule beats global rule, and serves a branded block page. Policies expand to concrete domain rules per employee/team, and **approved access-requests act as per-employee exceptions**.

**Gap to Zscaler:** category coverage is a small seed JSON vs Zscaler's continuously-updated URL DB across ~100+ categories and 20k+ apps. Also no time-of-day/bandwidth/quota rules enforced yet, and category classification is static (no ML URL classifier). This is a **data-scale** gap, not an architecture gap.

---

### 3.4 Malware Detection — 🟡 Partial

**Requirement:** generate a risk score; **>80 block, 50–80 alert**.

**How it's built:**
- **Downloads:** the agent buffers HTTP downloads and posts them to `/internal/agent/scan-file` → `riskengine.ScanBytes` → **ClamAV** signature scan. Infected → block page; clean → pass. Fail-open on scanner outage.
- **Domains:** `riskengine.Assess` produces an honest 0–100 score (feed hit +85, category risk, WHOIS age, DNS entropy) with `BlockThreshold = 80`.

**Gaps to requirement + Zscaler:**
- The **50–80 "alert" band is not wired into enforcement.** Today it's binary (ClamAV infected = block; domain score ≥80 = block). You need a three-way decision: `≥80 block / 50–79 alert+allow / <50 allow`.
- ClamAV catches *known* signatures only — **no behavioral sandbox** (Zscaler detonates unknown files in a VM). Zero-days pass.
- HTTPS downloads are invisible unless MITM is on (same TLS limitation as everywhere).

**To reach parity:**
1. Return a **numeric risk score** from `scan-file` (combine ClamAV verdict + file reputation/hash lookup + heuristics) and apply the 80/50 bands in the agent.
2. Add a **sandbox stage** (open-source: Cuckoo/CAPE, or cloud detonation) for unknown/unsigned executables. This is the single biggest malware gap vs Zscaler Cloud Sandbox.
3. Add hash-reputation lookups (e.g. MalwareBazaar) before detonation to short-circuit known-bad/known-good.

---

### 3.5 SSL / HTTPS Inspection — 🟢 Done

**How:** `internal/mitm` issues a **per-org root CA** (private key encrypted at rest, never leaves the server). The agent requests short-lived **leaf certs per host** (`/internal/agent/sign-cert`), terminates TLS locally, inspects plaintext (for DLP + malware), and re-encrypts upstream with full verification. Keep-alive is handled so pages don't crawl. **Bypass list** is enforced (org-configurable + a hard floor of pinned OS/update domains like Apple/Microsoft/Chrome update) — this covers the requirement's "bypass banking/government/sensitive sites." Fail-open on any handshake/pinning failure.

This is the **most impressive, most Zscaler-like** part of the build — TLS interception at scale is exactly what most competitors get wrong.

**Gap to Zscaler:** CA trust must be installed on each device (the installer does this on macOS; verify Windows/Linux trust-store steps and mobile). No selective decryption *by category* yet (Zscaler can say "don't decrypt Finance/Health category"); today it's per-host bypass only. No HTTP/2 or QUIC handling (forces HTTP/1.1) — acceptable but a perf/coverage gap.

---

### 3.6 Download Protection — 🟢 Done (HTTP) / 🟡 (HTTPS)

Covered by 3.4's ClamAV pipeline. HTTP downloads fully scanned; HTTPS downloads scanned **only when SSL inspection is enabled** for the org. Size cap 20 MB (larger files relayed unscanned). To reach parity: stream-scan larger files, add the sandbox stage, and scan HTTPS by default (needs MITM on by default).

---

### 3.7 Upload Protection – DLP — 🟡 Partial

**Requirement:** sensitive-data **score >80 block, 50–80 alert**.

**How it's built:** the agent buffers `POST/PUT/PATCH` bodies (plain HTTP directly; HTTPS when MITM on) and posts to `/internal/agent/scan-dlp`. `dlp.Scan` runs the detectors, first matching **enabled DLP policy wins**, and the **policy's action** (block/alert/log) decides the outcome. Every match is logged to `ActivityEvent` and broadcast live to the dashboard. File-type bypass (images/PDFs) supported.

**Gap to requirement + Zscaler:**
- **There is no numeric sensitivity score / 80–50 banding.** It's match-count → policy action, not "score the document, then 80=block / 50=alert." You need a **confidence/severity score per match** and an aggregate document score, then the two-band decision. The detectors return matches, not weighted scores.
- No **Exact Data Match / fingerprinting** (Zscaler EDM/IDM), no OCR of images, no true document classification.
- Detectors are solid but finite (cards, PAN, Aadhaar, AWS, GitHub, generic keys, source code). Zscaler ships hundreds of pre-built dictionaries + compliance templates (PCI, HIPAA, GDPR).

**To reach parity:** add per-detector weights → aggregate score → 80/50 bands (matches the requirement exactly), then layer EDM/fingerprinting, OCR, and compliance dictionary packs.

---

### 3.8 Threat Intelligence – Risk Score — 🟢 Done

**How:** `internal/riskengine/feeds.go` + `worker.go` sync **free, no-key feeds** — URLhaus (malware), OpenPhish (phishing), Feodo Tracker (botnet C2) — into `ThreatIntelDomain`. `Assess()` combines feed membership (+85), category risk, WHOIS domain age, and DNS/entropy heuristics into a 0–100 score persisted with human-readable reasons (audit trail). `BlockThreshold = 80`.

**Gap to Zscaler:** Zscaler's ThreatLabz ingests hundreds of commercial + first-party feeds and inline ML. Here it's 3 free feeds + heuristics. Good foundation; to scale, add more feeds (AlienVault OTX, abuse.ch full set), IP/file-hash intel (not just domains), and wire the 50–80 alert band into enforcement (same gap as malware).

---

### 3.9 Shadow IT Discovery — 🔴 Missing

**Nothing built.** Activity events *are* being logged (every domain each employee hits), so **the raw data for discovery already exists** — but there is no SaaS-app catalog, no "discovered apps," no per-app risk score, no sanctioned/unsanctioned classification.

**To build (Zscaler maintains a 20,000+ app DB and classifies inline):**
1. Ship a **cloud-app catalog** (domain → app name → category → risk score). Seed from an open list (e.g. Netskope/other public app lists) then curate.
2. A **discovery job** that rolls up `ActivityEvent` domains against the catalog → per-org "Apps in use," volume, user count, first/last seen, risk.
3. Dashboard: Discovered Apps view with **sanction / unsanction** toggle that writes a `DomainRule`/policy → closes the loop from *discovery* to *control*.

This is **medium effort and high visible value** — most of the plumbing (activity logging) is already there.

---

### 3.10 CASB Integration — 🔴 Missing

**Nothing built.** Two modes matter (per Zscaler):
- **Inline CASB** — you already have the inline proxy + TLS inspection + DLP, so inline CASB is mostly **"apply DLP/threat policy to specific SaaS apps"** — largely a productization of what exists once Shadow IT (3.9) lands.
- **Out-of-band CASB** — API integrations into SaaS tenants (Google Workspace, M365, Box, Salesforce) to scan **data at rest**, find risky external shares, revoke them, and catch malware in cloud storage. **This is genuinely new work** (OAuth apps per SaaS vendor, per-API scanners).

**To build:** start with inline CASB app-control (cheap, reuses everything), then add one out-of-band connector (Google Workspace or M365) as a reference implementation before generalizing.

---

## 4. Your Headline Question: A Native "Delphic Secure Client Connector" (instead of downloading a script)

**Short answer: Yes — and you're ~70% of the way there already.** The current agent already does everything a connector must do (auto-start service, local proxy, cloud policy sync, heartbeat, self-healing, TLS interception). What's missing is **packaging and polish**, not core capability.

### What Zscaler Client Connector actually is (from research)
A lightweight signed native app that: finds the nearest cloud edge by geolocation, builds a **Z-Tunnel** (DTLS/TLS) to it, forwards traffic via **packet-filter, route-based, or proxy** modes, enforces per-app tunnelling, shows a **tray/menu-bar UI** (status, enrollment, "why was I blocked"), auto-updates, and is **tamper-resistant** (users can't just kill it).
Sources: [ZCC Reference Architecture](https://www.zscaler.com/resources/reference-architectures/secure-mobile-access-with-zcc.pdf), [Choosing Traffic Forwarding Methods](https://help.zscaler.com/zia/choosing-traffic-forwarding-methods), [DCLessons: Zscaler Client Connector](https://www.dclessons.com/zscaler-client-connector).

### Current agent vs a true connector

| Capability | Aavishield agent today | Zscaler Client Connector |
|-----------|------------------------|--------------------------|
| Runs as background service | ✅ launchd/systemd | ✅ native service |
| Intercepts traffic | ✅ system **proxy** (`127.0.0.1:6118`) | ✅ proxy **and** packet-filter/route-based tunnel |
| Cloud policy sync | ✅ every 10s | ✅ |
| TLS inspection | ✅ | ✅ |
| Distribution | 🟡 **shell script + Python** | ✅ **signed `.pkg`/`.msi`/`.exe`** |
| User UI (tray icon, status) | 🔴 none | ✅ |
| Tamper resistance | 🟡 proxy-lock only; user can kill the process | ✅ protected service, MDM-locked |
| Covers **all** traffic (not just proxy-aware apps) | 🟡 proxy-based only | ✅ full tunnel captures everything |
| Auto-update binary | 🟡 script re-download | ✅ built-in updater |

### What to build to make it a real client connector (recommended path)

**Phase 1 — Package the existing agent as a native app (fast, high ROI):**
- Bundle the Python agent with **PyInstaller** → single binary → wrap in a **signed & notarized `.pkg` (macOS)** and **signed `.msi` (Windows via WiX)**. No more "download a script."
- Add a **tray/menu-bar UI** (status: protected/off, device ID, last sync, "request access" deep-link to the portal). This alone makes it *feel* like Zscaler.
- Code-sign everything (Apple Developer ID + Windows Authenticode) so OS/Gatekeeper/SmartScreen don't flag it.

**Phase 2 — Rewrite the data plane as a native tunnel (real parity):**
- Move from **system-proxy** to a **network-layer capture** so *all* traffic is covered, not just proxy-aware apps:
  - macOS: **Network Extension / Content Filter** (App Proxy Provider).
  - Windows: **WFP (Windows Filtering Platform)** or a TUN adapter (WinTun).
  - Linux: `nftables`/TUN.
- Rewrite the daemon in **Go** (you already have Go expertise across the backend) for a single static binary, lower footprint, and easier signing — sharing models with `admin-api`.
- Add **tamper resistance**: run as a protected system service, restart-on-kill, and support **MDM deployment** (Intune/Jamf) so users can't uninstall.

**Phase 3 — Connector-grade robustness:** built-in auto-updater, crash telemetry, per-app tunnelling, and captive-portal detection.

> **Recommendation:** do **Phase 1 now** (packaging + tray UI + signing) — it delivers the "native client connector" experience your requirement asks for within days, reusing 100% of the working logic. Schedule **Phase 2** (native tunnel in Go) as the path to true "captures-everything, tamper-proof" Zscaler parity.

---

## 5. The Big Architectural Gap vs Zscaler (read this before scaling)

Zscaler enforces in a **global cloud fabric (150+ PoPs)**; the endpoint agent is just a *tunnel*. Aavishield enforces **on the endpoint itself** (the agent *is* the proxy + scanner). Consequences:

**Pros of the current on-device model:** works on any network instantly, no backhaul, no global infra to run, cheap. Genuinely clever for an early product.

**Cons / what blocks "Zscaler-scale, production":**
1. **Trust boundary is on the device.** A determined user can kill the agent → §4 Phase 2 tamper-resistance is required.
2. **Heavy scanning runs client-side or round-trips to one API.** ClamAV/DLP scans go to a single `admin-api`. At scale this needs to become a **horizontally-scaled, regional scanning tier** (stateless workers behind a load balancer), not one box.
3. **No global points of presence / no cloud data plane.** If you want true "route 100% of traffic through our cloud" (branch offices, GRE/IPsec tunnels, unmanaged devices), you need at least one **cloud proxy tier** (the `swg-engine` is the seed of this) deployed multi-region.
4. **Single-region infra.** Docker Compose + one Postgres/Redis is dev-grade. Production needs managed Postgres (HA), Redis cluster, object storage for quarantined files, autoscaling API, and a real observability/SIEM export path.
5. **No SIEM/log streaming** (Zscaler NSS). Add a log-export pipeline (Splunk/QRadar/S3) — enterprises require it.
6. **Identity federation** is basic (local + social). Enterprises need **SAML/OIDC (Okta, Azure AD)** with group-based policy — Zscaler's whole policy model is identity-driven.

---

## 6. Prioritized Roadmap to "Full Functional, Zscaler-Level"

**Tier 0 — Close the exact gaps in `feature_text.txt` (days–2 weeks):**
1. Wire the **50–80 alert / >80 block** bands into malware, DLP, and threat-intel enforcement (the requirement's explicit scoring model). *Backend + agent, small.*
2. Add **GeoIP location** (MaxMind GeoLite2) to fill `GeoCountry/GeoCity` on every event/heartbeat. *Small.*
3. Give DLP detectors **weights → aggregate document score** so the 80/50 bands are meaningful. *Small–medium.*
4. **Package the agent as a signed native installer + tray UI** (§4 Phase 1) — delivers the "client connector." *Medium.*

**Tier 1 — High-value features that reuse existing plumbing (2–5 weeks):**
5. **Shadow IT discovery** — cloud-app catalog + rollup job + dashboard + sanction toggle. *Medium; data already logged.*
6. **Inline CASB** app-control (per-SaaS DLP/threat policy). *Medium; reuses inline stack.*
7. **Device posture** collector + posture-conditioned policies. *Medium.*
8. **SAML/OIDC SSO** + group-based policy. *Medium.*

**Tier 2 — True enterprise/Zscaler parity (multi-month):**
9. **Malware sandbox** (CAPE/Cuckoo or cloud detonation) for zero-days. *Large.*
10. **Native tunnel data plane** in Go (Network Extension / WFP / TUN) + tamper resistance (§4 Phase 2). *Large.*
11. **Out-of-band CASB** API connectors (start with Google Workspace or M365). *Large per connector.*
12. **Cloud data-plane / multi-region scanning tier + SIEM streaming + HA infra** (§5). *Large, ongoing.*

---

## 7. Bottom Line

- **What's genuinely done and good:** web-browsing rules, SSL/TLS inspection (the hard one), HTTP download AV, DLP detection, threat-intel scoring, and a working on-device enforcement agent. This is a real product, not a demo.
- **What's partial and easy to finish:** the **50–80 / >80 scoring bands** (asked for explicitly), **device location**, and turning the agent into a **native, signed client connector** — all small-to-medium and high-impact.
- **What's missing and needs real investment:** **Shadow IT discovery** and **CASB** (one medium, one large), plus the enterprise-grade concerns (sandbox, native tunnel, SSO, multi-region cloud, SIEM) that separate "works" from "Zscaler-scale production."

**Suggested next step:** knock out **Tier 0** (it directly satisfies `feature_text.txt`'s explicit requirements and produces the native client connector), then tackle **Shadow IT + inline CASB** in Tier 1 for the biggest visible jump toward Zscaler-like breadth.

---

### Sources
- `Zscaler_features_document.pdf` (provided)
- [Zscaler Client Connector Reference Architecture](https://www.zscaler.com/resources/reference-architectures/secure-mobile-access-with-zcc.pdf)
- [Zscaler — Choosing Traffic Forwarding Methods](https://help.zscaler.com/zia/choosing-traffic-forwarding-methods)
- [DCLessons — Zscaler Client Connector](https://www.dclessons.com/zscaler-client-connector)
- [Zscaler — SSE Components: SWG, ZTNA, CASB](https://www.zscaler.com/blogs/product-insights/sse-components-explained-swg-ztna-casb-and-how-they-work-together)
- [Zscaler — What Is a CASB](https://www.zscaler.com/resources/security-terms-glossary/what-is-cloud-access-security-broker)
