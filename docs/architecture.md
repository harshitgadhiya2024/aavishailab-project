# Architecture

## The endpoint agent

`services/endpoint-agent` (Rust) is the one codebase for macOS, Windows and
Linux. It runs as a local HTTPS-intercepting proxy: the OS system proxy is
pointed at `127.0.0.1`, the agent MITMs TLS with its own locally-trusted CA,
and every request passes through `proxy.rs` (plain HTTP) or `tls_proxy.rs`
(HTTPS) before going upstream. From there it:

- pulls policy rules from admin-api and enforces domain/category blocks
  (`rules.rs`, `enforcement.rs`),
- watches running processes and kills blocked applications
  (`app_control.rs`),
- streams every outbound upload/download to admin-api for DLP and malware
  scanning (`scan.rs`),
- reports activity, posture, screenshots and heartbeats back to admin-api.

**This code is currently frozen** — see
[platform-verification.md](platform-verification.md) for why and what that
means for future changes.

## The control plane

`services/admin-api` (Go) is the one thing every agent and every frontend
talks to. It owns:

- policy storage and resolution (which rules apply to which employee/team),
- the activity-event log (what the dashboards show),
- authentication for company admins, employees and superadmin,
- orchestrating the scanning microservices (below) — it never scans content
  itself, it loads policy, hands the request to the right service, and
  records the verdict.

## Scanning microservices

- **dlp-service-rust** — the entire DLP pipeline: deciding whether a request
  is a real user action, extracting content from documents/archives/PDFs/
  email, OCR, the pattern detectors, and the AI classification tier. See
  [features/dlp.md](features/dlp.md). Endpoint: `POST /v1/scan-upload`.
- **malware-service-rust** — download scanning (hash reputation + ClamAV +
  static heuristics).
- **threatintel-service**, **posture-service**, **shadowit-service**,
  **casb-service** — domain reputation, device posture (OS/disk-encryption/
  firewall checks), shadow-IT app discovery, and CASB-style app-control
  matching, each a small Go/Python service admin-api calls into.

Everything else DLP-related (a Python `extract-service`, and `ai-service`'s
`/v1/dlp/*` endpoints) was retired — the whole pipeline now lives in Rust.
`ai-service` still exists, but only for the AI Assistant chat feature.

## Frontends

- **company-dashboard** — what an org admin sees (Activity, DLP, Web
  Gateway, Application Control, Devices, Employees, Policies).
- **employee-portal** — where an employee downloads and enrolls the agent.
- **superadmin** — platform operator console (organizations, billing,
  global threat-intel, feature flags, support tickets).

## Data

Postgres is the single source of truth (organizations, employees, devices,
policies, activity events). Redis backs the DLP AI tier's cache and daily
budget counters, and the agent-token cache. Both run as containers in
`docker-compose.yml` on the production host by default;
`ADMIN_API_DATABASE_URL` can point admin-api at an external Postgres instead
(this was tried against Neon on 2026-09-29 and reverted — see
[bug-fixes.md](bug-fixes.md) — the bundled container is what's live).
