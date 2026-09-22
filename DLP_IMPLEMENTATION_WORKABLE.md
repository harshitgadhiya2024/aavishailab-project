# DLP End-to-End — How Data Loss Prevention Works in Delphic Secure

This document explains the complete DLP flow as it is actually implemented in
this repository today: where content is intercepted (browser side and app
side), how a policy is created and stored, how the scan itself runs, how the
block/alert decision is made, what the employee sees when something is
blocked, what the admin sees afterwards, and how every score in the product is
generated.

It is written against the code, not against the roadmap. Anything that is
built-but-not-wired, or deliberately fails open, is called out in
[§10 Known gaps](#10-known-gaps-and-honest-limitations) rather than glossed
over.

Companion docs:
- [`DLP_COVERAGE.md`](DLP_COVERAGE.md) — file-type coverage and live test results
- [`EMAIL_PROTECTION_PLAN.md`](EMAIL_PROTECTION_PLAN.md) — the mail-specific phases
- [`../dlp-test-kit/README.md`](../dlp-test-kit/README.md) — the repeatable scan test kit

---

## Table of contents

1. [The one-paragraph version](#1-the-one-paragraph-version)
2. [Component map](#2-component-map)
3. [How a policy is created](#3-how-a-policy-is-created)
4. [Enforcement point A — browser side](#4-enforcement-point-a--browser-side)
5. [Enforcement point B — app side](#5-enforcement-point-b--app-side)
6. [The scan itself — how checking actually happens](#6-the-scan-itself--how-checking-actually-happens)
7. [The decision — block vs alert vs log](#7-the-decision--block-vs-alert-vs-log)
8. [What the user sees](#8-what-the-user-sees)
9. [What the admin sees](#9-what-the-admin-sees)
10. [Scores — how each one is generated](#10-scores--how-each-one-is-generated)
11. [Known gaps and honest limitations](#11-known-gaps-and-honest-limitations)
12. [How to verify it yourself](#12-how-to-verify-it-yourself)

---

## 1. The one-paragraph version

An agent on the employee's machine makes itself the system proxy and (when the
org enables SSL Inspection) terminates TLS locally, so it can read the
plaintext of everything going out. For every outbound `POST`/`PUT`/`PATCH`
body and every outgoing WebSocket text message, it buffers the content and
POSTs it to `admin-api` at `/internal/agent/scan-dlp`. The backend loads that
org's enabled DLP policies in priority order, converts the content to scannable
text (PDF text layer, DOCX XML, image OCR), runs the policy's configured
detectors over it, and returns `block` or `allow` plus a sensitivity score.
On `block`, the agent never forwards the bytes — it answers the client itself
with a block page (or a WebSocket close, or an SMTP `550`, depending on the
protocol) and the backend writes an `ActivityEvent` that shows up live on the
admin's DLP dashboard.

---

## 2. Component map

| Component | Path | Role in DLP |
|---|---|---|
| Agent (endpoint) | [`scripts/agent/delphic-secure-agent.py`](../scripts/agent/delphic-secure-agent.py) | System proxy + TLS MITM; buffers uploads, calls the scan API, renders the block response |
| Agent (mail) | [`scripts/agent/mail_intercept.py`](../scripts/agent/mail_intercept.py) | IMAP/POP3/SMTP interception for desktop mail clients |
| Installers | [`scripts/agent/install-*.sh` / `.ps1`](../scripts/agent/) | Trust-store install, system proxy, QUIC (UDP/443) firewall block |
| DLP engine | [`services/admin-api/internal/dlp/`](../services/admin-api/internal/dlp/) | Detectors, text extraction, redaction, policy scan, sensitivity score |
| Scan endpoint | [`services/admin-api/internal/handlers/agents.go`](../services/admin-api/internal/handlers/agents.go) (`ScanDLP`) | Policy load → scan → decision → audit event → response |
| Policy CRUD | [`services/admin-api/internal/handlers/policies.go`](../services/admin-api/internal/handlers/policies.go) | Create/update/toggle/duplicate/import/export |
| Risk engine | [`services/admin-api/internal/riskengine/`](../services/admin-api/internal/riskengine/) | Shared score→action thresholds; domain risk scoring |
| Inbound mail relay | [`services/admin-api/internal/mailrelay/`](../services/admin-api/internal/mailrelay/) | MX-side SMTP relay that reuses the same DLP scan on attachments |
| Company Dashboard | [`frontend/company-dashboard/src/app/dashboard/dlp/`](../frontend/company-dashboard/src/app/dashboard/dlp/) | DLP incident view |
| Policy wizard | [`frontend/company-dashboard/src/app/dashboard/policies/page.tsx`](../frontend/company-dashboard/src/app/dashboard/policies/page.tsx) + [`lib/policies.ts`](../frontend/company-dashboard/src/lib/policies.ts) | The 3-step create/edit flow |
| Employee Portal | [`frontend/employee-portal/src/app/dashboard/activity/`](../frontend/employee-portal/src/app/dashboard/activity/) | Employee's own events + "Request Access" |

Note: `services/swg-engine` is the network-level domain/DNS filter. It does
**no** DLP at all — no content scanning lives there. All DLP runs through the
endpoint agent plus `admin-api`.

---

## 3. How a policy is created

### 3.1 The UI flow (3-step wizard)

`Dashboard → Policies → New Policy` opens a 3-screen wizard:

**Screen 1 — Who does this apply to?**
Three cards: `Full Organization` / `Teams` / `Employees`.

**Screen 2 — Pick the teams or employees** (skipped for "Full Organization").
Employee picker has search + department filter.

**Screen 3 — Policy details.**
Name, Type (`Web Filter` / `Data Loss Prevention` / `Network / Domain`),
Priority (1 = highest), Description — then, when Type is DLP, the DLP builder:

| Field | Control | Maps to |
|---|---|---|
| **Detect & Block** | Toggle chips for the 7 built-in detectors | `rules.detectors[]` |
| **Keywords** | Textarea, one per line | `rules.keywords[]` |
| **Custom Patterns** | Repeating (Name, Regex) rows | `rules.custom_patterns[]` |
| **Allow (skip scanning)** | Toggle chips: Images, PDFs | `rules.bypass_file_types[]` |
| **Actions** | `block` / `alert` / `allow` / `log` chips | `action` |

The form's own defaults ([`lib/policies.ts`](../frontend/company-dashboard/src/lib/policies.ts),
`EMPTY_DLP_FORM`) pre-select detectors `credit_card`, `pan_india`, `aadhaar`
and pre-select bypass for `image` + `pdf`.

Even though Actions is a multi-select in the UI, only one action is sent.
`formToApiPayload` collapses the selection by fixed precedence:
`block` > `allow` > `alert` > `log`, defaulting to `block`.

### 3.2 What gets stored

`POST /api/v1/policies` → [`PolicyHandler.Create`](../services/admin-api/internal/handlers/policies.go).
Validation only accepts three types: `domain`, `url_category`, `dlp` —
anything else is rejected with *"policy type is not enforced yet"*.

The row that lands in `policies`:

```jsonc
{
  "org_id":   "…",
  "name":     "Block credit card uploads",
  "type":     "dlp",
  "action":   "block",          // block | alert | allow | log
  "priority": 100,              // lower number = evaluated first
  "enabled":  true,
  "rules": {                    // jsonb — the DLP config
    "detectors":         ["credit_card", "aws_key", "source_code"],
    "keywords":          ["confidential", "customer database"],
    "custom_patterns":   [{ "name": "Project Codename", "regex": "PROJECT-X-\\d+" }],
    "bypass_file_types": ["image", "pdf"]
  },
  "targets": { "scope": "all", "team_ids": [], "employee_ids": [] }
}
```

Creation also writes an `AuditLog` row and generates a `rego_bundle` string.
**The Rego bundle is generated and stored but never evaluated anywhere** —
there is no OPA in the request path. Enforcement is the Go code described
below. (See [§11](#11-known-gaps-and-honest-limitations).)

### 3.3 The default policy every org gets

[`models.NewDefaultDLPPolicy`](../services/admin-api/internal/models/models.go) —
seeded per org, `is_default: true` so `PolicyHandler.Delete` refuses to remove
it (it can still be edited or disabled):

```jsonc
{
  "name":     "Default DLP Policy",
  "action":   "block",
  "priority": 100,
  "enabled":  true,
  "rules": {
    "detectors":         ["credit_card", "pan_india", "aadhaar"],
    "keywords":          [],
    "custom_patterns":   [],
    "bypass_file_types": []      // ← nothing exempt: images and PDFs ARE scanned
  }
}
```

Worth noting: the seeded default scans images and PDFs (`bypass_file_types: []`),
while the **UI's** new-policy form pre-selects Images + PDFs as *bypassed*. An
admin who creates a second policy and leaves the defaults alone gets weaker
coverage than the one they were given. That is a real inconsistency between
`EMPTY_DLP_FORM` and `NewDefaultDLPPolicy`, not a documentation error.

---

## 4. Enforcement point A — browser side

### 4.1 Getting into the traffic path

The installer configures the machine's **system proxy** to `127.0.0.1:6118`,
where the agent listens as an HTTP/HTTPS proxy. Every browser request goes
through it.

For HTTPS — which is essentially everything — a proxy only sees a `CONNECT`
line and an opaque tunnel, so it can see the *destination* but not the
*content*. To read content, the agent does **TLS interception (MITM)**
([`MITMEngine`](../scripts/agent/delphic-secure-agent.py)):

- It terminates TLS locally using a short-lived per-host leaf certificate
  fetched from `admin-api`'s org CA. The CA private key never leaves the
  server; only narrow, expiring leaves reach the device.
- The installer adds the org CA to the machine trust store, so the browser
  accepts the leaf.
- Because the agent is an *explicit* proxy, the hostname comes from the
  `CONNECT` line — no SNI sniffing needed.

MITM is **per-org and opt-in** (`mitm_enabled` in org settings). It is also
**fail-open** by design: if SSL Inspection is off, if the host is on the bypass
catalog (cert-pinned apps, OS update services), if the org added it to its own
bypass list, or if the leaf can't be obtained, the connection falls back to a
blind tunnel — and DLP simply doesn't see that body.

### 4.2 The upload hook

Inside a MITM'd connection (`_serve_over_tls`) and in the plain-HTTP path
(`_handle_http`), for every request whose method is in
`UPLOAD_METHODS = ("POST", "PUT", "PATCH")`:

1. Read the headers, find framing.
2. If `Transfer-Encoding: chunked` → decode into a buffer (capped at
   `MAX_SCAN_SIZE`).
   If `Content-Length` is present and `≤ MAX_SCAN_SIZE` → read exactly that many bytes.
   **Otherwise the body is forwarded unscanned**, with a diagnostic log line.
3. Call `_scan_upload(...)`.
4. If the verdict is `block` → `_send_dlp_block(...)` and the upstream socket
   never receives the body.
5. Otherwise forward the original bytes unchanged.

### 4.3 Working out what is actually being uploaded

`_scan_upload` has to answer two questions before it can scan: *what is the
filename* and *which bytes are the file*. Both are messier than they sound,
and each fallback below exists because a real upload silently escaped DLP:

**Filename resolution order** (`_upload_filename`):

| Order | Source | Why it exists |
|---|---|---|
| 1 | `Content-Disposition: … filename=` | Standard attachment header |
| 2 | `X-Goog-Upload-File-Name` | Google's resumable protocol (Gmail attach, Drive, Photos) sends raw file bytes with no multipart wrapper; the name only appears here |
| 3 | `filename="…"` inside the multipart body | A normal `<input type=file>` puts the name in the *part's* header, not the outer request's |
| 4 | Microsoft Graph `…/report.png:/content` | OneDrive/SharePoint — and therefore Teams file share — puts the name as the second-to-last path segment |
| 5 | Last URL path segment | Last resort (often just `upload` / `media`) |

**Body extraction** (`_multipart_file_part`): for `multipart/form-data`, the
first file part's raw bytes and its *own* `Content-Type` are pulled out.
Without this, the scanner received boundary markers and part headers wrapped
around the file. Text and DOCX/PDF tolerated that; **image OCR did not** — an
image decoder needs the file to start exactly at its magic bytes, so every
real browser image upload was invisible to DLP.

**Malware pre-check**: if it looks like a real file (`_looks_like_file_upload`
— attachment disposition, a known binary content type, or a known extension),
the bytes go to `/internal/agent/scan-file` (ClamAV) first. A malware hit is a
hard block independent of DLP policy.

**Self-traffic exemption** (`_is_own_admin_host`): requests to the org's own
`admin-api` are never scanned. Without this, an admin saving a DLP policy whose
keyword list contains `"confidential"` had that very save request blocked by
its own keyword — confirmed live.

**Fail-open**: if the scan endpoint is unreachable or times out
(`DLP_SCAN_TIMEOUT = 15s`), `_scan_upload` returns `None` and the upload is
allowed through unscanned, with a warning logged.

### 4.4 WebSocket messages

Modern chat apps (M365 Copilot, ChatGPT, Teams) send messages over a `wss://`
WebSocket, not a `POST`. A WebSocket upgrade hands the connection to a framed
binary protocol, so the upload hook above never fires.

`_relay_websocket` handles that: the client→upstream leg is parsed frame by
frame (RFC 6455 §5.2), text frames are unmasked and reassembled across
continuation frames, and each **complete** text message is run through the same
`_scan_upload`. Allowed frames are forwarded byte-for-byte (original mask
intact, so no re-encoding). A blocked message gets a Close frame with code
**1008 Policy Violation** and the connection ends.

Deliberate scope: server→client frames are relayed raw and unscanned (same as
HTTP responses). Binary frames are not scanned — guessing at an unknown
encoding isn't worth the false positives. If the app negotiated a WebSocket
extension such as `permessage-deflate`, frame parsing bails and the rest of the
connection is relayed raw rather than risking a desync. (The agent strips the
compression offer from the upgrade request to make this rare.)

### 4.5 Webmail send interception (a separate policy, same plumbing)

Gmail and Outlook Web sends are also intercepted, but they are evaluated
against the **outgoing email domain policy** (allowed recipient domains), not
the DLP detectors:

- **Gmail** rides a persistent channel (`/sync/u/N/i/s`). Draft-autosave writes
  carry subject/body/recipients keyed by a msg-id; the send is either a
  separate content-free trigger or — when label tags `^r`/`^r_bt` are absent —
  the content-bearing write itself.
- **OWA** (`outlook.cloud.microsoft`, `outlook.office.com`) uses Exchange's
  JSON-RPC `UpdateItem` with an explicit `MessageDisposition` field
  (`SendOnly` / `SendAndSaveCopy`), so no heuristic is needed.

Both funnel into `_evaluate_email_policy` → `_report_email_send` →
`_send_email_policy_block`.

---

## 5. Enforcement point B — app side

"App side" means three distinct problems, each solved differently.

### 5.1 Electron/Chromium apps and the QUIC hole

Microsoft Teams and other Chromium-based desktop apps can send traffic over
**QUIC (HTTP/3)**, which runs on **UDP/443**. System proxy settings do not
apply to UDP at all, so that traffic tunnels straight past the agent and DLP
never runs on it. This is why a file with a card number could be uploaded
through Teams and get through, while the identical file was correctly blocked
in a browser.

This is not evasion on the app's part — QUIC is simply the modern default
(one-step handshake, no head-of-line blocking, survives network changes, and
it's built into Chromium so every Electron app inherits it).

**Fix — installers block outbound UDP/443 at the OS firewall:**

| OS | Mechanism |
|---|---|
| macOS | `pf` anchor `com.delphic-secure`: `block drop quick proto udp from any to any port 443`, referenced from `/etc/pf.conf` (appended as an anchor, so it composes with VPN/Docker/Little Snitch rules rather than replacing them) |
| Linux | `iptables` OUTPUT rule |
| Windows | `New-NetFirewallRule` outbound block |

QUIC clients are built to fall back to TCP/TLS when UDP/443 gets no response —
restrictive corporate networks already force this — so the app keeps working,
its traffic just takes the TCP path the proxy can inspect. Install and
uninstall handle the rule automatically. On macOS, if no admin password is
given, the installer warns explicitly that QUIC-capable apps may bypass DLP
entirely.

Live-verified on macOS (Teams image + file uploads blocked after the rule was
loaded). The Linux and Windows variants are written and syntax-checked but not
yet run against a real machine.

### 5.2 Desktop mail clients (Outlook desktop, Apple Mail, Thunderbird)

IMAP/POP3/SMTP clients don't honour proxy settings at all — there is no PAC
file or system-proxy equivalent for these protocols. So
[`mail_intercept.py`](../scripts/agent/mail_intercept.py) takes a different
route: an **OS-level port redirect** to `127.0.0.1:6119`, recovering the real
destination from `SO_ORIGINAL_DST` (or, on implicit-TLS ports, by sniffing the
TLS ClientHello's SNI).

| Ports | Protocols | TLS handling |
|---|---|---|
| 993, 995, 465 | IMAPS, POP3S, SMTPS | TLS from the first byte |
| 143, 110, 587, 25 | IMAP, POP3, SMTP submission | Plaintext, upgraded mid-session via `STARTTLS` / `STLS` |

What reuses cleanly from the HTTP agent: `MITMEngine.get_leaf(host)` for the
leaf certificate, `/internal/agent/scan-dlp` + `/internal/agent/scan-file` for
scanning (an RFC 822 message is just another blob of bytes), and
`ActivityReporter.record()` for audit.

- **Incoming (IMAP/POP3)** — `FETCH BODY[]`/`RFC822` message bodies are pulled
  out of the response stream and scanned. On block, the body handed to the
  client is replaced with a short stand-in message.
- **Outgoing (SMTP)** — two checkpoints: each `RCPT TO` address is checked
  against the recipient-domain policy, and the full `DATA` body is scanned
  before it's committed.

The module's own scope note says Linux-only for redirection (Windows'
WinDivert path and macOS' Network Extension path are tracked as separate
tasks); the protocol/scanning logic is shared. The repo's commit history
records outgoing SMTP (task 13) as live-verified.

### 5.3 Inbound MX relay (server side, no agent)

[`services/admin-api/internal/mailrelay`](../services/admin-api/internal/mailrelay/)
is a Go SMTP server that scans inbound mail with the same
`dlp.Scan` + ClamAV + spam heuristics, and combines the signals into one
per-message verdict (`severity()` ordering so an "alert" from one attachment
never masks a "block" from another). A block is a hard SMTP-level reject
*before* the message is accepted. **Quarantine is not implemented** — it needs
storage and a review UI that don't exist yet, and the code says so rather than
half-building it.

---

## 6. The scan itself — how checking actually happens

Everything above converges on one endpoint:

```
POST /internal/agent/scan-dlp?filename=…&content_type=…&destination=…
Body: the exact bytes being evaluated
```

Metadata travels as query params so the body stays byte-exact.

### 6.1 Step 1 — bound the input

`MaxScanSize = 20 MB`. Larger content returns `413` with `scanned: false`; the
caller allows it rather than blocking on an unbounded in-memory read.

### 6.2 Step 2 — categorise the file

`fileCategory(filename, contentType)` buckets into exactly four categories.
This same function drives both extraction dispatch and the bypass list, so the
two can never disagree:

| Category | Matched by |
|---|---|
| `image` | `image/*` content type, or `.png .jpg .jpeg .gif .webp .svg` |
| `pdf` | `application/pdf` or `.pdf` |
| `archive` | zip/compressed content types, or `.zip .rar .7z` |
| `document` | everything else |

### 6.3 Step 3 — walk policies in priority order

`dlp.Scan(policies, filename, contentType, data)` — policies arrive already
filtered to `enabled = true AND type = 'dlp'` for the org, sorted
`priority ASC`. For each policy:

- If this file's category is in the policy's `bypass_file_types` → skip it.
- Otherwise extract text (once, cached across policies — it doesn't depend on
  per-policy rules) and run that policy's detectors.
- **First policy with at least one match wins** and returns immediately —
  the same first-match-wins semantics domain rules use.

### 6.4 Step 4 — text extraction

Regex matching only sees literal bytes. A PDF's text is stream-compressed, a
DOCX is a zip of XML, and an image has no text bytes at all — so without
extraction those formats never match any detector regardless of policy config.

| Category | Extraction |
|---|---|
| `pdf` | Text layer via `ledongthuc/pdf`. If empty (a scan, a photo, "print to PDF") → rasterise and OCR, capped at **10 pages / 45s / 200 DPI** |
| `image` | `tesseract` OCR, **15s** timeout — so a card number in a screenshot is read out and scanned like any other text |
| `document` | DOCX: unzip, parse `word/document.xml`, concatenate text runs |
| anything else / any failure | Fall back to the raw bytes |

Every extraction failure (corrupt file, unsupported sub-format, tesseract not
installed) falls back to raw bytes rather than erroring the scan.

### 6.5 Step 5 — the detectors

| Detector | Matching logic |
|---|---|
| `credit_card` | 13–19 digit run → **Luhn** checksum → **known BIN prefix** (Visa/MC/Amex/Discover/Maestro/RuPay ranges) → **plus a card-related word within 300 bytes** (`card, credit, debit, visa, mastercard, maestro, amex, discover, cvv, cvc, pan, payment, billing`) |
| `pan_india` | `[A-Z]{5}[0-9]{4}[A-Z]` — format only; PAN has no public checksum |
| `aadhaar` | 12 digits → **Verhoeff** checksum → **plus an Aadhaar-related word within 300 bytes** (`aadhaar, aadhar, adhaar, uidai, uid`) |
| `aws_key` | `(AKIA\|ASIA)[0-9A-Z]{16}` |
| `github_token` | `gh[pousr]_[A-Za-z0-9]{36,255}` |
| `generic_api_key` | `(api_key\|secret_key\|access_token\|auth_token\|client_secret\|private_key\|password)\s*[:=]\s*<value≥12 chars>` — keyword-adjacent on purpose, so it doesn't match every long string |
| `source_code` | Filename extension only, against a 21-entry list (`.go .py .js .ts .tsx .java .c .cpp .cs .rb .php .rs .swift .kt .scala .sql .sh …`) |
| `keyword` | Case-insensitive substring, per configured keyword — always runs, independent of the detector list |
| `custom_regex` | Org-supplied named regex; an invalid regex is **skipped**, not fatal, so one typo can't disable DLP for the org |

**Why the context requirement exists.** Luhn alone has a roughly 1-in-10
coincidental pass rate, and Verhoeff is the same class of check-digit scheme.
Real telemetry payloads (Microsoft 1DS, Datadog RUM) are full of 12–19 digit
session IDs, correlation counters and epoch timestamps — three different
vendors produced false blocks inside a single test session. Two earlier fix
attempts used a *blocklist* of telemetry field names; that has to be re-extended
every time a new SDK invents its own naming convention. Requiring a *positive*
context word instead is robust against SDKs nobody has seen yet, because
machine-generated telemetry never says "cvv" next to a number.

**Why the window is 300 bytes, not ~40.** A sentence like "Card on file:
4111…" needs almost no window. But a real ID card OCR'd is a 2D layout
linearised into 1D — on a real Aadhaar card image, the word "Aadhaar" and the
checksum-valid number came out **168 bytes apart**, past the original 40-byte
window, producing a false *allow* even though both required signals were
present.

**The deliberate trade-off:** a bare card number pasted with zero surrounding
text is not flagged.

### 6.6 Step 6 — redacted previews

Nothing full is ever stored or logged. `redactDigits` keeps only the last 4
(`************1111`); `redactAlnum` keeps a 4-character prefix (`AKIA****`,
`ghp_****`) — enough to identify the credential type, never the secret.

---

## 7. The decision — block vs alert vs log

Handled in [`AgentHandler.ScanDLP`](../services/admin-api/internal/handlers/agents.go).

### 7.1 Sensitivity score

```
credit_card | pan_india | aadhaar | aws_key | github_token | generic_api_key  → 40 each
source_code                                                                  → 25 each
keyword | custom_regex                                                       → 15 each
                                                              total capped at 100
```

### 7.2 Score bands

Shared with the malware/domain paths via `riskengine.ActionForScore`:

| Score | Action |
|---|---|
| `> 80` | **block** |
| `50 – 80` | **alert** (content is still allowed through) |
| `0 – 49` | **log** |

`BlockThreshold = 80`, `AlertThreshold = 50`.

### 7.3 Precedence

```
1. Fast path      → no policy match AND score band = log  → allow, nothing written
2. Policy block   → matched policy with action "block"    → BLOCK (always wins)
3. Score band     → block / alert per the table above
4. Policy alert   → score band = log but policy action is "alert" → ALERT
5. Approved access request → downgrades a block to allow (see below)
```

A worked example worth internalising: **one** credit-card hit scores 40, which
is in the *log* band. It still blocks, because the matched policy's action is
`block` (rule 2). **Two** high-severity hits score 80 — which is *not* `> 80`
— so a policy set to `alert` produces an alert, not a block. Three hits reach
100 and block on score alone.

### 7.4 Approved access requests as exceptions

If the verdict is `block` and there is an `AccessRequest` matching
`(employee_id, policy_id, domain = destination, status = approved)`, the
response is downgraded to `allow` and the event is recorded as `logged`.

This check exists specifically because DLP policies never produce a
`DomainRule`, so the existing domain-rule exception filter
(`filterApprovedExceptions`) could never affect them. Confirmed live: an
employee's approved request for a DLP block on `inc-excel.officeapps.live.com`
kept blocking every subsequent upload until this was added.

### 7.5 What gets written

Everything except the fast path writes an `ActivityEvent`:

```jsonc
{
  "event_type":    "policy_violation",
  "action":        "blocked" | "alerted" | "logged",
  "category":      "dlp",
  "target":        "<filename>",
  "target_domain": "<destination host>",
  "policy_id":     "…",
  "policy_name":   "Block credit card uploads",
  "metadata": {
    "detectors":         ["credit_card"],
    "matches":           ["Credit Card Number: ************1111"],
    "sensitivity_score": 40,
    "risk_score":        40
  }
}
```

It is then broadcast over WebSocket (`BroadcastActivityEvent`) — scoped so
Employee Portal connections only ever receive their own events, while
company-dashboard and superadmin connections see everything in the org.

### 7.6 The response the agent acts on

```jsonc
{
  "scanned": true,
  "action": "block",
  "sensitivity_score": 40,
  "risk_score": 40,
  "policy_name": "Block credit card uploads",
  "detectors": ["credit_card"],
  "reason": "Sensitive company data detected: Credit Card Number"
}
```

---

## 8. What the user sees

This is the part that differs most by protocol, because the agent is a MITM
proxy — it can control the *response*, but it cannot inject UI into Gmail or
Teams.

### 8.1 HTTP upload blocked → full block page

`_send_dlp_block` returns **HTTP 403** with `BLOCK_PAGE_HTML`:

```
                         🛡️
                  Access Blocked

   This website has been blocked by your organization's
                 security policy.

   ┌──────────────────────────────────────────────┐
   │ Domain:    drive.google.com                  │
   │ Reason:    Sensitive company data detected:  │
   │            Credit Card Number                │
   │ Category:  Data Loss Prevention              │
   └──────────────────────────────────────────────┘

   If you believe this is a mistake, please contact
              your IT administrator.

        Protected by Delphic Secure Zero Trust Security
```

- **Domain** — the destination host the upload was headed to
- **Reason** — `"Sensitive company data detected: <first match label>"` from the
  backend, so the employee learns *which category* tripped, never the value
- **Category** — `Data Loss Prevention`, or `Malware Detection` when ClamAV
  caught it first

**Important caveat:** most modern uploads are XHR/`fetch`, not a page
navigation. In that case the browser hands this HTML to the app's own
JavaScript, which shows *its* generic upload-failed error. The employee sees
the block page in full only when the upload was a real form navigation. This is
the structural ceiling of interception-at-the-response-layer.

### 8.2 WebSocket message blocked → Close 1008

A Close frame with code **1008 (Policy Violation)** and the reason text
(truncated to 120 bytes), rather than just severing the connection — an app
that receives a clean close can show a real error instead of a bare `1006`.
In practice the user sees the chat app's own "message failed to send".

### 8.3 Webmail send blocked → structured 403 JSON

`_send_email_policy_block` returns **403** with:

```json
{
  "error": "blocked_by_policy",
  "category": "email_policy",
  "reason": "Recipient domain(s) not allowed: gmail.com",
  "blocked_domains": ["gmail.com"]
}
```

Deliberately *not* the HTML block page: Gmail's send is XHR, and HTML there
reads as a broken request to Gmail's own JS. The 403 is confirmed live to make
Gmail render its **native "couldn't send" banner**. `blocked_domains` is a real
field rather than prose baked into `reason`, so the audit log and any future
consumer have something structured to read. The same response is reused for
OWA (not yet live-verified against a real OWA client).

### 8.4 SMTP blocked → standard rejection codes

- Recipient not allowed: `550 5.7.1 Recipient not allowed by organization policy`
- Message content blocked: `550 5.7.1 Message blocked by organization policy`

The mail client surfaces its own send-failure dialog carrying that text.

### 8.5 Incoming mail blocked → stand-in message

The blocked body is replaced before it reaches the client:

```
From: Delphic Secure <security@delphic.local>
Subject: A message was blocked by your organization's mail policy

This message was blocked: <reason>
```

### 8.6 Alert → the user sees nothing

This matters and is easy to miss: on an `alert` verdict the response action is
`allow`. The upload goes through, no page, no banner, no notification. "Alert"
is an *admin-side* signal only — the event is written as `alerted` and appears
on the dashboard. Nothing is shown to the employee.

### 8.7 Employee Portal → "Request Access"

The employee's own Activity page lists their events. A blocked event carries a
**Request Access** button (`POST /api/v1/portal/access-requests` with
`policy_id` + `domain`). The backend verifies a matching blocked event actually
exists before creating the request. Once an admin approves it, §7.4 makes the
next scan allow that exact `(employee, policy, domain)` combination — approving
one request never opens access wider than what was asked for.

---

## 9. What the admin sees

### 9.1 The DLP page (`Dashboard → DLP`)

Four stat cards, computed over the most recent 100 `policy_violation` events:

| Card | Source |
|---|---|
| Active DLP Policies | count of enabled `type=dlp` policies |
| Uploads Blocked | events with `action = blocked` |
| Alerts Raised | events with `action = alerted` |
| Employees Involved | distinct employee emails across those events |

The header states the enforcement contract verbatim: *"Upload sensitivity score
bands: 0–49 log, 50–80 alert (allow), >80 block. Policy action 'block' always
wins when matched."*

If zero DLP policies are enabled, a yellow banner says so outright —
*"sensitive data won't be scanned until you create one"* — with a link to
create one.

Below that, the **Incidents** table (15 per page, auto-refreshing every 30s):

| Employee | File | Destination | Policy | Detector | Action | Time |
|---|---|---|---|---|---|---|
| Priya Sharma | `q3-report.pdf` | `drive.google.com` | Block credit card uploads | credit card | **blocked** | 22 Sep 2026, 14:03 |

Action is colour-coded: red `blocked`, yellow `alerted`, grey `logged`.

### 9.2 Elsewhere

- **Activity page** — the full event feed with filters; DLP events carry
  `category = "dlp"`
- **Live updates** — the WebSocket broadcast pushes events without a refresh
- **Notifications** — the bell feed / dropdown
- **Reports** — CSV/PDF exports including per-employee and per-domain rollups
- **SIEM export** — `/siem` forwards events including `risk_score`
- **Policy detail** — `GET /policies/:id/blocked-employees` lists who a given
  policy has blocked, and the access requests raised against it

---

## 10. Scores — how each one is generated

There are five distinct scores in this product. They are frequently confused,
so here is each one with its actual source.

### 10.1 DLP sensitivity score (0–100) — per scan

`dlp.SensitivityScore(matches)`. Sum of per-detector weights (40 / 25 / 15 as
in §7.1), capped at 100. Stored on the activity event as **both**
`sensitivity_score` and `risk_score`, which is why DLP events participate in the
org-wide risk average below.

### 10.2 Domain risk score (0–100) — per domain

`riskengine.Assess(db, domain)` — four additive signals, each one something the
system can actually back up. No paid APIs, no ML:

| Signal | Contribution |
|---|---|
| Listed on a threat-intel feed (URLhaus malware, OpenPhish phishing — free, periodically synced) | **+85** |
| URL category risk level (0–4) × 10 | **up to +40** |
| Domain registered within 7 days (real WHOIS) | **+25** |
| Domain registered within 30 days | **+15** |
| DNS/name-structure heuristics — Shannon entropy, digit ratio, subdomain depth (the same class of signal DGA detectors use) | **0 – +15** |

Capped at 100. Every contributing signal is recorded in `Reasons[]`, so the
audit trail always shows *why* a domain scored what it did — never a bare
number. Persisted to `domain_risk_assessments` so repeat visits don't re-run
WHOIS. A feed hit alone lands past the block threshold; the other signals exist
mainly to catch domains not on a feed yet. A WHOIS lookup that fails
contributes nothing rather than guessing.

### 10.3 Device posture score (0–100) — per device

`scoreDevicePosture(posture)`, recomputed on each agent heartbeat that includes
a `posture` object. Starts at 100 and subtracts:

| Failed signal | Penalty |
|---|---|
| `proxy_configured` = false | **−25** |
| `firewall_enabled` = false | **−20** |
| `disk_encryption_enabled` = false | **−25** |

Floored at 0. A missing or non-boolean signal counts as `unknown` and costs
nothing. Derived status: **healthy** (no failures) / **warning** (≥ 70) /
**risky** (< 70). The score, the raw signals, the human-readable reasons and a
`checked_at` timestamp are all merged into `device.metadata.posture`.

### 10.4 Org "Average Risk Score" — dashboard banner

`AVG(activity_events.risk_score)` over the selected window (default 7 days),
from `GET /activity/stats`. Since DLP events write their sensitivity score into
`risk_score`, DLP incidents pull this average up directly. UI colour bands:
red ≥ 70, yellow ≥ 40, green below.

### 10.5 Employee risk score — **stored but never computed**

`employees.risk_score` is a real column, surfaced on the dashboard's "Users by
Risk Score" card, in the employee reports, the portal profile, and the digest
emails. **No code in this repository ever writes to it.** There is no recompute
job, no trigger, no aggregation from activity events. It stays at whatever the
schema default (`0.00`) or seed data set.

If an employee-level risk score is expected to be meaningful, that aggregation
still has to be built. Treat the current display as a placeholder.

### 10.6 Shared thresholds

| Constant | Value | Used by |
|---|---|---|
| `riskengine.BlockThreshold` | 80 | DLP sensitivity, domain risk, spam score, malware |
| `riskengine.AlertThreshold` | 50 | same |
| UI `riskColor` / `riskBg` | 70 / 40 | display colour only — **not** enforcement |

The UI's 70/40 colour bands do not line up with the enforcement bands 80/50.
That is display-only, but it does mean a score of 75 renders red while being
in the *alert* band, not the block band.

---

## 11. Known gaps and honest limitations

### Enforcement gaps

- **Policy targeting is not applied to DLP.** `ScanDLP` loads *every* enabled
  DLP policy for the org — it never calls `policyTargetMatches`. That function
  is only used when expanding policies into domain rules for web filtering.
  So a DLP policy scoped to one team in the wizard is stored, displayed as
  "1 team" in the policy list, and then enforced against **everyone**. The
  wizard's Screen 1/2 are effectively cosmetic for DLP policies.
- **Downloads are not DLP-scanned at all** — only malware/ClamAV covers
  downloads. DLP applies to uploads and outgoing content only.
- **The Rego bundle is dead code in the request path.** Every create/update/
  duplicate regenerates and stores a `rego_bundle`, and nothing ever reads it.
  Enforcement is entirely the Go path described here.

### Fail-open behaviour (deliberate, but worth knowing)

Every one of these allows content through rather than blocking:

- DLP scan endpoint unreachable or slower than 15s
- Content larger than 20 MB
- An upload with neither `Content-Length` nor chunked framing
- A chunked body that exceeds `MAX_SCAN_SIZE` mid-stream (truncated → unscanned)
- SSL Inspection disabled for the org → all HTTPS bodies invisible
- A host on the MITM bypass catalog, the org's bypass list, or the session
  bypass set (added after a TLS handshake failure, typically cert pinning)
- Extraction failure of any kind → falls back to raw bytes
- Malware scanner unreachable → attachment not held to a standard it was never
  checked against

### Coverage gaps

- **Scanned/photo PDFs** are OCR'd, but only the first 10 pages, within 45s
- **Legacy `.doc`** (pre-2007 binary Word) is not parsed — only `.docx`
- **Archives are not unpacked.** `extractText` has no `archive` case, so a zip
  falls through to raw-byte matching, which finds nothing inside compressed
  members. Also note the bypass chips in the UI only offer Images and PDFs,
  even though the backend accepts `archive` and `document` as bypass values —
  those can only be set by editing the policy JSON directly
- **Only the first file part** of a multipart upload is name-checked and
  content-extracted; other parts no longer get raw-byte scanned as a side effect
- **WebSocket:** server→client frames unscanned, binary frames unscanned, and
  a negotiated extension (`permessage-deflate`) stops inspection for the rest
  of the connection
- **A bare card number with no nearby context word is not flagged** — the
  accepted cost of eliminating telemetry false positives
- **`source_code` is extension-only.** Reliable content classification (a
  plaintext README vs. a source file) needs a model that is out of scope
- **IMAP:** one literal per response line; a `FETCH` requesting multiple body
  parts in one call only has its first literal scanned
- **SMTP:** an oversized message gives up scanning for the remainder of that
  session rather than risking an unbounded buffer
- **Mail relay:** block only, no quarantine

### Platform gaps

- QUIC/UDP-443 block live-verified on **macOS only**; Linux `iptables` and
  Windows `New-NetFirewallRule` variants are written and syntax-checked but
  not yet run on a real machine
- Mail interception redirection is Linux-scoped in `mail_intercept.py`;
  Windows (WinDivert) and macOS (Network Extension) are tracked separately
- OWA send-block response shape is not yet live-verified against a real client

### Configuration inconsistency

- The seeded **Default DLP Policy** has `bypass_file_types: []` (images and
  PDFs *are* scanned), while the **UI's new-policy form** pre-selects Images +
  PDFs as bypassed. A new policy created with defaults is weaker than the
  seeded one.

---

## 12. How to verify it yourself

### 12.1 Fast — API only, no browser, no agent

```bash
docker compose up -d postgres redis clamav admin-api
cd dlp-test-kit && ./run-tests.sh
```

Hits `POST /internal/agent/scan-dlp` directly with 14 real file scenarios —
TXT, DOCX, PDF and images, each with and without sensitive content (card
number, AWS key, `confidential` keyword). Prints a pass/fail table. Point it
elsewhere with `ADMIN_API_URL=http://… ./run-tests.sh`.

### 12.2 Unit tests

```bash
cd services/admin-api && go test ./internal/dlp/... ./internal/riskengine/... ./internal/handlers/...
```

Covers the detectors (including the telemetry false-positive cases), text
extraction, and the scanner's policy walk.

### 12.3 Full end-to-end through a browser

1. `docker compose up -d`
2. Enrol a device from the Employee Portal or Company Dashboard, into an org
   with an active DLP policy (every org has "Default DLP Policy"; the seeded
   Acme Corporation also has "Block credit card uploads").
3. Confirm the system proxy points at `127.0.0.1:6118`, and that SSL
   Inspection is enabled for the org.
4. Upload each file from `dlp-test-kit/files/` through a real upload form.
   Card-number / AWS-key / `confidential` files should be blocked; clean files
   should upload normally.
5. Check `Dashboard → DLP` — each block should appear within ~30s with the
   matched detector.

### 12.4 Verify the QUIC block specifically

```bash
# macOS
sudo pfctl -s info | grep Status                      # → Enabled
sudo pfctl -a com.delphic-secure -s rules             # → the UDP/443 drop rule
# Linux
sudo iptables -L OUTPUT -v -n | grep 443
# Windows
Get-NetFirewallRule -DisplayName "Delphic Secure - Block QUIC"
```

Then upload a file containing a card number through Microsoft Teams. It should
be blocked exactly as a browser upload would be. To prove the rule is what's
doing the work, remove it and re-test — the upload succeeds again — then
reinstall it.
