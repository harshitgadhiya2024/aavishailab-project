# Aavishield

Aavishield ek SWG + DLP + endpoint-enforcement security platform he — employee ke device pe ek agent chalta he jo local proxy ki tarah kaam karta he: cloud se org ki rules pull karta he, domains block/allow karta he, downloads (malware) aur uploads (DLP) scan karta he, aur TLS interception kar sakta he. Sab kuch admin-api (Go control plane) ke around organize he, teen frontends (company-dashboard, superadmin, employee-portal) ke saath.

Ye file do cheezein consolidate karti he jo pehle alag Markdown docs mein thi: **client ke 13 architecture-suggestions ka triage**, aur **superadmin panel ka feature gap-analysis + roadmap**. Dono ab pura implement ho chuke hain — is doc mein kya suggest hua tha aur actually kya bana, dono ek jagah he.

---

## Part 1 — Client Feedback Assessment (13 Suggestions)

Client ki review mein 13 suggestions aaye — TPM attestation, eBPF, SPIFFE/SPIRE, OpenTelemetry, Confidential Computing (TEE), Sigstore, Prompt Firewall, Knowledge Graph, Federated Learning waghera. Sab genuine, well-known enterprise security patterns hain. Har item actual codebase ke against check kiya gaya — sirf concept pe review nahi.

### At a Glance

| # | Technology | Status |
|---|---|---|
| 1 | OpenTelemetry tracing | ✅ **Done** — live verified |
| 2 | Prompt-injection defense | ✅ **Done** — live verified |
| 3 | Policy bundle signing | ✅ **Done** — live verified |
| 4 | Service-to-service auth fix | ✅ **Done** — live verified |


### ✅ Adopted & Shipped (4 items)

**1. OpenTelemetry — Distributed Tracing**
Prometheus + Grafana pehle se the, lekin distributed tracing bilkul nahi thi. Ab: Grafana **Tempo** (single-binary) + OTLP HTTP export har service mein — Go (`admin-api`, `threatintel-service`, `shadowit-service`, `posture-service`), Python (`dlp-service`, `malware-service`, `casb-service`, `ai-service`), Rust (`dlp-service-rust`, `malware-service-rust`). W3C traceparent propagation se ek cross-service request (admin-api → dlp-service) ab ek hi trace ID mein linked dikhta he. Live verified: real DLP scan se ek single trace mila jo `admin-api` → `dlp-service` span ko sahi se link karta he.

**2. Prompt-Injection Defense (AI Assistant)**
`services/ai-service/app/core/prompt_guard.py` — direct-injection regex scanning user messages pe, tool-result data ko "untrusted" ke roop mein wrap karke defuse karna (indirect injection), aur destructive tool calls (`delete_policy`, `resolve_access_request`, etc.) ke liye server-side confirmation check jo model ke apne self-report se independent he. 18 tests passing.

**3. Policy Bundle Signing**
Sigstore/Cosign ki jagah — jo public container-image trust ke liye bana he — ek lightweight **Ed25519 detached signature** he: admin-api policy JSON sign karta he (`internal/policysig`), Ed25519 chosen kyunki HMAC ke saath ek compromised device pura fleet ke liye policy forge kar sakta tha. Har agent (Go, Rust, Python) TOFU (trust-on-first-use) se public key pin karta he aur verify karta he — fail-closed (bad signature = reject, cached rules use hoti rehti hain). Live verified: real signature independently cryptographically verify kiya gaya, tampering correctly rejected hua.

**4. Service-to-Service Auth — Dual-Secret Rotation**
Static shared HMAC secret ki jagah ab **dual-secret accept window** he (`SERVICE_SECRET` + `SERVICE_SECRET_PREVIOUS`) — 6 microservices (Go + Python) mein, zero-downtime secret rotation enable karta he. Full SPIFFE/SPIRE overkill tha ek single Docker Compose host ke liye. Live verified: real scans (DLP + malware) through poori chain, zero regressions.

### 📋 Planned (3 items — defined phase chahiye, sprint nahi)

**5. TPM 2.0 Device Attestation** — Enrollment token-based he abhi, hardware se bound nahi. TPM attestation isse hardware-backed banayega. Cost: 3 alag platform APIs (Windows TBS, Linux tss-esapi, macOS Secure Enclave) — multi-week kaam. Sequence: Windows/macOS agent parity ke baad.

**6. eBPF — Deeper Linux Telemetry** — Abhi proxy-path se telemetry aati he. eBPF process/syscall-level depth dega. Client ki apni framing sahi he: "future Linux support" — roadmap pe, agent ka next Linux capability pass hone pe.

**7. Graph-Based Correlation** — Koi GNN exist hi nahi karta abhi; risk scoring pure rule-based heuristics he. Jab kabhi heuristics se trained model pe move ho, Knowledge Graph + embedding correlation (GNN se lighter, zyada explainable) + Feature Store (train/serve consistency ke liye) saath mein shuru karna.

### ⏸ Parked (5 items — infra assume karte hain jo abhi exist nahi)

**8. Cilium** — Kubernetes CNI he; koi K8s cluster hi nahi he (`docker-compose.yml` only). Migration decision ban jaye tab dekhna.

**9. SPIFFE/SPIRE (full)** — Same underlying gap jo item #4 mein already lighter fix se close ho chuka he. Multi-node/K8s topology ke liye bana he — muthi bhar containers ke liye disproportionate.

**10. Confidential Computing / TEE** — 5 alag jagah suggest hua (AI inference, logs, session keys, SSL-inspected traffic, DLP memory). AI inference already third-party API (kie.ai) ko clear text jaata he — TEE wo exposed hop cover nahi karega. Sasta alternative abhi: plaintext buffers jaldi discard + zero-out + tight memory permissions. Trigger: specific compliance deal, ya inference self-hosted ho jaye.

**11. Signed AI Models** — URL classification abhi rule-based he, koi trained model file hi nahi he sign karne ko. Jab actual trained classifier ship ho, tab policy-signing jaisa hi integrity-check pattern apply karna.

**12. Federated Learning** — DLP detection regex-based he, koi training pipeline nahi. Agar kabhi trainable model banaya jaye, federated learning ko din-1 se design mein rakhna — baad mein retrofit karna mushkil he.

---

## Part 2 — Superadmin Platform: Feature Roadmap & Status

Superadmin panel product-owner nazariye se audit kiya gaya — jo gaps mile sab actual code padhke nikale gaye, guess karke nahi (jaise `orgApi.get(id)` helper already tha but koi page use nahi karta tha; Settings ke 4 cards literally `"Coming soon"` badge ke sath pade the). Total 14 items identify hue, teen tiers mein — **sab 14 ab implement, tested, aur live-verified hain.**

### At a Glance

| # | Feature | Tier | Status |
|---|---|---|---|
| 1 | Organization Detail Page | Tier 1 | ✅ Done |
| 2 | Platform System Health / Observability | Tier 1 | ✅ Done |
| 3 | Superadmin Audit Log | Tier 1 | ✅ Done |
| 4 | Settings (General/Notifications/Security/Retention) | Tier 1 | ✅ Done |
| 5 | Superadmin Team & RBAC | Tier 1 | ✅ Done |
| 6 | Org Usage & Seat-Limit Alerts | Tier 2 | ✅ Done |
| 7 | Billing & Subscription (real Razorpay) | Tier 2 | ✅ Done |
| 8 | "View as Org" Support Tool | Tier 2 | ✅ Done |
| 9 | Global Threat-Intel / Blocklist Management | Tier 2 | ✅ Done |
| 10 | Broadcast / Platform Announcements | Tier 2 | ✅ Done |
| 11 | Feature Flags (per-org rollout) | Tier 3 | ✅ Done |
| 12 | Compliance — Data Export / Purge | Tier 3 | ✅ Done |
| 13 | Revenue & Growth Analytics | Tier 3 | ✅ Done |
| 14 | Support Ticketing | Tier 3 | ✅ Done |

### Tier 1 — Foundation

**1. Organization Detail Page** — `organizations/[id]` page: org profile, seats used/limit, enrolled devices, dashboard users, recent activity, billing. Backend `Get(id)` extend kiya gaya (devices/users/activity ek response mein).

**2. Platform System Health** — Prometheus ke `up` + `scrape_duration_seconds` metrics se real-time service status — sabhi 8 scraped services (admin-api, ai-service, dlp/malware/threatintel/posture/shadowit/casb-service) up/down + scrape latency. Koi per-service custom metric-name assumption nahi (robust across Go/Python/Rust services jo apna naming alag rakhte hain).

**3. Superadmin Audit Log** — Pehle se maujood `AuditLog` table (jo likha jaata tha but kabhi padha nahi jaata tha) ab superadmin ke har mutating action (org create/update/delete, agent-package publish/rollback, catalog edits, settings changes, team changes, billing, impersonation) pe likhta he. Filterable list page.

**4. Settings** — 4 real, saved-to-DB sections: General, Notifications (seat-limit threshold), Security Policy, Data Retention. Data Retention **actually enforce hoti he** — daily background sweep (`internal/retention`) purane activity/audit rows delete karta he configured window ke hisaab se.

**5. Superadmin Team & RBAC** — `full` vs `support` access level. Full = sab kuch including destructive actions. Support = read-only, `SuperAdminFullOnly()` middleware se blocked destructive routes pe. Last-full-admin protection — akela full admin khud ko demote/remove nahi kar sakta.

### Tier 2 — Operations & Growth

**6. Seat-Limit Alerts** — Dashboard widget, `notifications` setting ke threshold (default 80%) ke against live compute.

**7. Billing & Subscription — Real Razorpay Integration** — Manual tracking nahi, **real Razorpay Payment Links API** — superadmin ek invoice banata he, real payment link generate hota he, org ka finance contact use pay karta he. Webhook (`POST /webhooks/razorpay`, HMAC-signature verified, idempotent) se payment status auto-update. Org Detail page pe "New Invoice" button.

**8. View as Org (Impersonation)** — Superadmin ek one-time code se company-dashboard mein org-admin ban ke sign in kar sakta he — naya NextAuth `impersonation` provider + `/impersonate` bridge page. Session 15 min mein auto-expire hoti he (koi refresh token issue nahi hota), poora audit trail (`impersonate_start` + `impersonate_login`) ke saath.

**9. Global Threat-Intel & Blocklist** — Platform-wide domain rules (existing `DomainRule` model, `org_id IS NULL`) ke liye superadmin-only CRUD page + threat-feed sync status (URLhaus/OpenPhish/Feodo Tracker).

**10. Announcements** — Superadmin banner publish karta he (info/warning/critical severity), company-dashboard mein automatically dikhta he (polled every 5 min).

### Tier 3 — Scale & Governance

**11. Feature Flags** — Global toggle + per-org override table. Real, queryable infra (`handlers.IsEnabled(db, key, orgID)`) — abhi kisi existing feature ko retrofit nahi kiya gaya, lekin infrastructure functional he agla feature jab gradual-rollout chahe.

**12. Compliance — Data Export / Purge** — `GET .../export` pura org data JSON bundle download karta he. `POST .../purge` — sirf deactivated (soft-deleted) org pe, aur request body mein org ka slug exactly type karke confirm karna padta he (typed confirmation, sirf boolean nahi) — permanently sab related rows delete karta he ek transaction mein.

**13. Revenue Analytics** — Real Razorpay billing data se: MRR estimate (monthly/annual normalize), collected/pending amounts, monthly revenue trend chart, overdue invoice count.

**14. Support Tickets** — Built-in lightweight system (external tool integration nahi, deliberate choice) — `SupportTicket` + `SupportTicketMessage` models. Company-dashboard mein naya "Support" page (org users raise/reply kar sakte hain), superadmin side full triage view (status/priority/assignment). Resolved ticket pe reply aane se auto-reopen hota he.

### Implementation ke dauraan mile 3 real bugs (fix bhi ho gaye)

1. **Pre-existing security bug**: `POST /swg/rules` mein koi bhi org_admin `is_global: true` bhejke ek platform-wide domain rule bana sakta tha (cross-tenant privilege escalation) — ab superadmin-only he, baaki sab request org-scoped force hoti he regardless of the flag.
2. **Webhook body-reuse bug**: Razorpay webhook handler signature-verification ke liye `c.Request.Body` padhta tha, phir `ShouldBindJSON` usi (ab-empty) body se parse karne ki koshish karta — hamesha fail hota. Fix: signature-verify kiye hue raw bytes pe direct `json.Unmarshal`.
3. **Purge incompleteness**: Org purge support tickets/messages aur feature-flag org-overrides delete nahi karta tha — orphaned rows reh jaate the org delete hone ke baad. Fix: transaction mein add kiya.

---

## Setup Notes

Is kaam ke dauraan naye environment variables add hue (`.env.example` mein documented, `.env` mein real values):

| Variable | Purpose |
|---|---|
| `POLICY_SIGNING_KEY` | Ed25519 seed (base64) — policy bundle signing |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Razorpay API credentials (billing) |
| `RAZORPAY_WEBHOOK_SECRET` | Webhook signature verification |
| `RAZORPAY_CURRENCY` | Default `INR` |
| `NEXT_PUBLIC_COMPANY_URL` (superadmin build arg) | "View as Org" redirect target |
| `SERVICE_SECRET_PREVIOUS` (per microservice) | Dual-secret rotation window |

**⚠️ `razorpay_credential.txt`** repo root mein rakha he (gitignored) — live Razorpay keys plaintext mein. Kabhi commit mat karna; agar naya machine pe setup ho raha he to values manually `.env` mein copy karo.

Observability stack: Tempo (traces) + Prometheus (metrics) + Grafana (dashboards) — sab `docker-compose.yml` mein already wired, superadmin ke **System Health** page se bhi live status dikhta he.
