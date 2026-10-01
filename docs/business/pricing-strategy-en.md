# Aavishield Pricing Strategy and Cost-to-Serve

*Prepared 1 October 2026; updated the same day after the AI model migration (Gemini 2.5 → Mistral Small 4). Model: `scripts/business/pricing_model.py` (run it to regenerate every table). Hinglish version: `pricing-strategy-hinglish.md`.*

---

## 1. Executive summary

**The decision in one paragraph.** Price Aavishield **per protected employee (user), per month, billed annually**, with each user covering up to 3 devices. Sell three plans: **Essentials $4**, **Business $9**, **Enterprise $14** (USD list). In India, the same plans are **₹149 / ₹349 / ₹549** + GST. Discount by volume in fixed bands (0% → 45%), never deeper than 45% without CEO sign-off. At every scale from 100 to 1,000,000 employees, infrastructure costs **$0.13–$0.88 per employee per month**, so infra gross margin stays at **90–98%**. Fully loaded with SRE, support and compliance, margin is **83–95%** from 10,000 employees on (lower around 1,000 employees, when SOC 2 is the dominant cost).

**Why this works for us when it doesn't for Zscaler or Netskope.** Our policy runs **on the device**. We do not run points of presence (POPs) that every byte of customer traffic flows through. We receive only control traffic and security events: kilobytes per device, not gigabytes. That is the structural cost advantage to protect, and it is why we can undercut SSE vendors by 40–70% and still earn better margins than they do.

**Five engineering decisions with real money attached** (section 7):
1. **Done (1 Oct 2026): DLP AI moved off Gemini 2.5** (retiring 16 Oct) to **Mistral Small 4** via OpenRouter, with retries and a fallback model chain; KIE.ai removed. AI cost per DLP seat fell by **~50%** (optimized: $0.33 → $0.16 per month).
2. **Rules polling every 10 seconds becomes a 60-second ETag/long-poll.** This cuts API load by 3x at scale.
3. **DLP AI budget becomes per seat, not a flat 20,000 calls per organisation per day.** The current cap silently stops classifying for any organisation above ~1,000 users. Add a cheap pre-filter in front of the model.
4. **Screenshots switch from lossless to lossy WebP** (417 KB → ~70 KB). This cuts screenshot storage by 6x.
5. **Security events move to a columnar store** (ClickHouse) from 10,000 employees on, with Postgres kept for configuration.

Together, decisions 2–4 cut infra cost by **35–56%** from 10,000 employees on.

**What the cheaper AI changes in the plans (section 4.2):** list prices stay the same, because they are anchored to the market, not to our cost. Instead, the saving goes back into the product: **AI fair use doubles** on Business and Enterprise, **audio/video DLP** is now included, and the **AI assistant** comes to Essentials. A Business seat that uses its full new AI allowance costs us about what the old, smaller allowance did on Gemini (~$0.56 vs $0.54 per month).

---

## 2. What we sell, and why our costs look different

Aavishield is one agent (Rust, macOS/Windows/Linux) that enforces these controls on the device and reports to one console:

| Control | Where the work happens | What reaches our cloud |
|---|---|---|
| Web gateway (categories, domains) | On the device (local HTTPS proxy) | Policy pulls; blocked events only |
| VPN / proxy blocking | On the device | Blocked attempts |
| Application control | On the device | Inventory (hourly) and blocked launches |
| Malware download scanning | Streamed to our scanning service | The file stream, then a verdict |
| Data loss prevention | Agent intercepts; **our DLP service inspects** (patterns, OCR, AI) | The upload body for inspection; findings stored, files not |
| Device posture | On the device | Posture report |
| Activity monitoring | On the device | Screenshots + activity (opt-in seats only) |

**What drives our cost, in order:**
1. **AI classification for DLP** (Mistral Small 4 via OpenRouter). This is 46–62% of infra cost at 10k+ employees (it was 64–74% on Gemini).
2. **Managed PostgreSQL** across regions.
3. **Compute** for the API and DLP/malware scanning.
4. **CDN/edge** (Cloudflare) and **object storage** (Cloudflare R2: screenshots, backups, agent packages, zero egress fees).

**Measured in production today:**
- One Oracle Cloud Ampere A1 VM (4 OCPU, 24 GB, Mumbai) runs the whole stack. Postgres is 125 MB.
- Events stored: 3.7 per device per day (only blocked/alerted; allowed traffic is never stored).
- Screenshot size: 417 KB average (lossless WebP).
- AI (since 1 Oct 2026): `mistralai/mistral-small-2603` for text, vision and the assistant; `google/gemini-3.1-flash-lite` for audio and as a text fallback; `google/gemma-4-26b-a4b-it` as the vision fallback. OpenRouter only, with 3 retries per model, then the next model. Providers that retain prompts are excluded.
- AI budget: capped per organisation per day at 20,000 text / 2,000 image / 500 audio calls.

---

## 3. Competitor landscape (24 vendors)

Prices are per user (or per device where noted), USD, list or typical street price. Most enterprise vendors publish no list price. Those figures come from procurement data (Vendr), government price lists (G-Cloud, GSA) and analyst write-ups, and are marked *est.*

### 3.1 SSE / secure web gateway (cloud proxy) — they run POPs

| # | Vendor | Price per user / month | Model | Notes |
|---|---|---|---|---|
| 1 | **Zscaler Internet Access** | $6–$27 (*est.*, $72–$325/yr) | Per user, quote only | Market leader; 35%+ price rises on some SKUs in 2025. DLP is an add-on. |
| 2 | **Netskope** | $4–$8 base, $9–$14 mid, $15+ full (*est.*) | Per user, quote | Median contract ~$96k/yr. |
| 3 | **Cisco Umbrella** | DNS $2.5–$3.3; SIG Essentials $5–$7.5 (*est.*) | Per user, reseller | Enterprise all-in $80–$150/user/yr. |
| 4 | **Cloudflare Zero Trust** | $7 (free ≤ 50 users) | Per user, public | SWG + ZTNA + basic DLP; RBI +$10. |
| 5 | **Palo Alto Prisma Access** | $5–$12.5 list; $3–$7.5 discounted (*est.*) | Per user / per Mbps | Full SASE, heavy enterprise motion. |
| 6 | **Check Point Harmony SASE** (Perimeter 81) | $10 / $15 / $20 | Per user, public | + $50/month per gateway. |
| 7 | **NordLayer** | $8 / $11 / $14 (annual) | Per user, public | VPN-led; 5-user minimum; dedicated IP +$40/month. |
| 8 | **dope.security** | $5 ($60/device/yr) | Per device, public | **Closest architecture to ours** (on-device SWG). No DLP, no monitoring. |

### 3.2 DNS / web filtering for SMB

| # | Vendor | Price per user / month | Notes |
|---|---|---|---|
| 9 | **DNSFilter** | $2.10 Pro / $2.70 Enterprise (annual) | DNS only, no TLS inspection or DLP. |
| 10 | **CurrentWare** | BrowseControl $6; full suite $12–$20 | Web filter + monitoring + USB; on-prem roots. |

### 3.3 Data loss prevention / insider risk

| # | Vendor | Price per user / month | Notes |
|---|---|---|---|
| 11 | **Forcepoint DLP** | ~$4.3 (*est.*, from $52/yr); full stack $6–$12.5 | Legacy leader; heavy deployment. |
| 12 | **Fortra Digital Guardian** | $3.3–$6.7 per endpoint (*est.*); managed +$1.7–$3.3 | Endpoint DLP. |
| 13 | **Netwrix Endpoint Protector** (CoSoSys) | ~$1.9–$3.8 (*est.*) | Device control + content DLP. |
| 14 | **Safetica** | $6 / $8 / $12 (from $72/$96/$144 per yr) | Closest SMB DLP comparison. |
| 15 | **Microsoft Purview Suite** (ex-E5 Compliance) | $12 add-on to M365 E3 | Bundled in E5 ($60). Our main "good enough" threat in M365 shops. |
| 16 | **Cyberhaven** | Quote; median contract ~$38k/yr | Data lineage DDR; enterprise. |
| 17 | **Nightfall AI** | Quote; contracts $75k–$200k+/yr | AI DLP for SaaS/GenAI/endpoint. |
| 18 | **Teramind** | $15 Starter / $30 UAM / $35 DLP | Monitoring + DLP; 5-seat minimum. |
| 19 | **Veriato** | $15 UAM (annual) | Insider risk, monitoring. |

### 3.4 Employee monitoring / productivity

| # | Vendor | Price per user / month | Notes |
|---|---|---|---|
| 20 | **ActivTrak** | $10 / $15 / $19; screenshots +$2 | Productivity analytics; 5-user minimum. |
| 21 | **Hubstaff** | $4.99 / $7.50 / $10 / $25 (annual) | Time tracking + screenshots. |
| 22 | **Controlio** | $6.67 / $9.99 | Monitoring. |
| 23 | **Kickidler** | ~$1.8–$4 | Monitoring, low-cost. |

### 3.5 India

| # | Vendor | Price | Notes |
|---|---|---|---|
| 24 | **Seqrite (Quick Heal) Endpoint Security Total** | ₹850 per user per **year** + GST (≈ ₹71/month) | Antivirus-first with basic DLP and web filtering; the local price anchor. |

### 3.6 What the market tells us

- **To replace what Aavishield does, a buyer stacks 2–3 products.** For example, Cloudflare $7 + Safetica $8 + ActivTrak $15 = **$30 per user per month**. Teramind alone is $35 with DLP. Our Enterprise at $14 sells at **under half of that stack**.
- **The SWG-only floor is ~$2–$7** (DNSFilter, Umbrella DNS, dope, Cloudflare). Essentials at $4 sits in that band but includes posture, app control and VPN control the DNS tools lack.
- **The DLP band is ~$4–$12** (Forcepoint, Safetica, Purview). Business at $9 is mid-band, with web + apps + DLP + AI (now including audio/video) in one agent.
- **Enterprise buyers expect 30–60% off list.** Our bands go to 45%, and the floor still earns >75% margin.
- **India is extremely price sensitive** (Seqrite ≈ ₹71/user/month). We price at ~2x Seqrite for a far broader product, not at US parity.

---

## 4. Pricing decisions

### 4.1 Unit: per employee (user), not per device — decided

| Option | For | Against | Decision |
|---|---|---|---|
| **Per user** | Matches how buyers budget (HR headcount); one price covers laptop + desktop; standard in SSE/DLP | Shared/kiosk machines need a rule | **Chosen** |
| Per device | Simple to meter (we count enrolled devices) | Punishes multi-device employees; harder to forecast | Offer only as a **device license** for shared/kiosk/lab machines at **60% of the user price** |
| Usage-based (GB / scans) | Tracks cost | Unpredictable bills; security buyers hate it | Rejected (AI is guarded by fair-use instead) |

**Rule:** 1 user license = 1 named employee, up to 3 enrolled devices. Billing counts the **peak number of active users in the billing month**, not every invited user. Over-deployment beyond the purchased count gets a 10% grace, then is trued up quarterly at the contract rate.

### 4.2 Plans and what is in them

| | **Essentials** | **Business** (most chosen) | **Enterprise** |
|---|---|---|---|
| **USD list** (per user / month, annual) | **$4** | **$9** | **$14** |
| **India list** (+ GST) | **₹149** | **₹349** | **₹549** |
| Web gateway + 27 categories + URL checker | ✓ | ✓ | ✓ |
| VPN / proxy blocking | ✓ | ✓ | ✓ |
| Malware download scanning + threat intel | ✓ | ✓ | ✓ |
| Device posture + compliance report | ✓ | ✓ | ✓ |
| AI assistant for admins (ask the console in plain language) | ✓ **new** | ✓ | ✓ |
| Data loss prevention (patterns + OCR) | — | ✓ | ✓ |
| AI classification, fair use per user per day | — | **100 text + 10 image** (was 50 + 5) | **200 text + 20 image** (was 100 + 10) |
| Audio/video DLP (transcribed, then scanned), per user per month | — | **20 min new** | **60 min new** |
| Application control + inventory | — | ✓ | ✓ |
| Per-team policies, access requests | — | ✓ | ✓ |
| Activity monitoring + screenshots | — | add-on $4 | ✓ |
| Event retention | 30 days | 90 days | 12 months |
| SSO/SCIM, audit export, custom block page | — | — | ✓ |
| Data residency (IN / EU / US) | — | — | ✓ |
| Support | Email | Email + chat | Priority SLA, named CSM ≥ 1,000 users |

**Why these upgrades are safe (cost of a user who uses the full allowance, per month):**

| Plan | AI allowance | Our worst-case AI cost | Share of list price |
|---|---|---|---|
| Business (old, on Gemini) | 50 text + 5 image/day | $0.54 | 6% |
| **Business (new, on Mistral)** | 100 text + 10 image/day + 20 min audio | **$0.59** | 7% |
| **Enterprise (new, on Mistral)** | 200 text + 20 image/day + 60 min audio | **$1.20** | 9% |
| Essentials: AI assistant only | Admin questions | ~$0.01 | <1% |

*Per call: text ~$0.000225, image ~$0.000284 (Mistral Small 4, incl. 5% of calls landing on a dearer fallback); audio ~$0.0014 per minute (Gemini 3.1 Flash-Lite). Average users use far less: the model assumes 25 text + 4 image calls a day.*

**Price decision: keep $4 / $9 / $14 (₹149 / ₹349 / ₹549).** We considered cutting Business to $8. We rejected it: the market band is $4–$12 and buyers compare features, so a richer plan at the same price sells better than the same plan $1 cheaper. The margin gain (+1–2 pts) also helps fund SOC 2 earlier.

**Add-ons:**
- Activity monitoring for Business seats: $4 (₹149). Charged only on monitored seats.
- Extra audio/video DLP: +$1 per user per month for 300 minutes (our cost ~$0.42).
- Extended retention: 2 years for +$1.
- Premium 24×7 support: +15% of contract.
- Device license (shared machines): 60% of the plan price.

### 4.3 Volume bands (applied to the whole order, not tiered)

| Users | Discount | Business price per user |
|---|---|---|
| 10–249 | 0% | $9.00 |
| 250–999 | 10% | $8.10 |
| 1,000–4,999 | 20% | $7.20 |
| 5,000–24,999 | 30% | $6.30 |
| 25,000–99,999 | 38% | $5.58 |
| 100,000+ | 45% (floor) | $4.95 |

**Extra levers:**
- Multi-year prepay: 2 years −5%, 3 years −10%.
- Monthly billing: +20% (annual is the default).
- Hard floor: **no deal below 50% off list** without CEO approval. At 50% off, Business is $4.50, which is still ~4x the all-in cost to serve from 10,000 employees on ($1.14).

### 4.4 What one customer pays (annual billing)

**USD per month for the whole company:**

| Company size | Discount | Essentials | Business | Enterprise | Business per user |
|---|---|---|---|---|---|
| 100 | 0% | $400 | $900 | $1,400 | $9.00 |
| 1,000 | 20% | $3,200 | $7,200 | $11,200 | $7.20 |
| 10,000 | 30% | $28,000 | $63,000 | $98,000 | $6.30 |
| 100,000 | 45% | $220,000 | $495,000 | $770,000 | $4.95 |
| 500,000 | 45% | $1,100,000 | $2,475,000 | $3,850,000 | $4.95 |
| 1,000,000 | 45% | $2,200,000 | $4,950,000 | $7,700,000 | $4.95 |

**India, INR per month + 18% GST:**

| Company size | Discount | Essentials | Business | Enterprise |
|---|---|---|---|---|
| 100 | 0% | ₹14,900 | ₹34,900 | ₹54,900 |
| 1,000 | 20% | ₹1,19,200 | ₹2,79,200 | ₹4,39,200 |
| 10,000 | 30% | ₹10,43,000 | ₹24,43,000 | ₹38,43,000 |
| 100,000 | 45% | ₹81,95,000 | ₹1,91,95,000 | ₹3,01,95,000 |
| 500,000 | 45% | ₹4,09,75,000 | ₹9,59,75,000 | ₹15,09,75,000 |
| 1,000,000 | 45% | ₹8,19,50,000 | ₹19,19,50,000 | ₹30,19,50,000 |

*In practice, 100k+ deals are negotiated individually. The table is the ceiling before negotiation.*

### 4.5 International pricing

| Region | Currency | Price level vs USD list | Why |
|---|---|---|---|
| US, Canada, UK, EU, Australia, Gulf | USD (EUR/GBP shown at fixed rates) | 100% | Benchmark market |
| India | INR | ~45% (₹349 ≈ $4.15 for Business) | Price-sensitive; Seqrite anchor ≈ ₹71 |
| SE Asia, LATAM, Africa | USD | 70% | PPP-adjusted, via partners |

- **Billing:** Razorpay for INR; Stripe/Paddle for USD/EUR (Paddle as merchant of record removes global VAT/sales-tax filing). Budget ~2.5% for payment fees.
- **Partners:** MSPs/resellers get **20% margin** (30% for certified partners), on the same list, so prices stay consistent.

### 4.6 Trials and sales motion

| Customer size | Motion |
|---|---|
| ≤ 250 users | Self-serve 14-day trial, card at checkout, monthly or annual |
| 250–5,000 users | Sales-assisted 30-day pilot on up to 25 devices, then annual contract |
| 5,000+ users | Enterprise: security review, pilot, procurement. Expect 3–6 month cycles. |

- **Minimum:** 10 users ($40/month on Essentials).
- **Free tier:** none. A 14-day trial is enough, and a free tier for a monitoring/DLP product attracts misuse.

---

## 5. Cost to serve at each scale

### 5.1 Key assumptions (all in the model)

| Assumption | Value | Basis |
|---|---|---|
| Devices per employee | 1.2 | Laptop + occasional second machine |
| Peak share online | 60% (one region), 45% (global, 100k+) | Office hours across time zones |
| API requests per online device | 0.135/s today → **0.043/s optimized** | Agent: rules 10s, heartbeat 60s, mitm 300s, lookups, events |
| Scanning CPU per employee per workday | 9 CPU-seconds | DLP text/files/OCR + malware download scans |
| AI text calls per DLP employee per workday | 60 today → **25 optimized** | Every outbound message not already blocked, minus pre-filter/cache |
| AI image calls per employee per workday | 4 | Uploaded images/screens |
| AI prices | $0.15 / $0.60 per M tokens (text and vision); 5% of calls at $0.25 / $1.50 (fallback) | Mistral Small 4 list on OpenRouter; Gemini 3.1 Flash-Lite as the dearest fallback |
| Seats with screenshots | 25% | Enterprise + add-on |
| Screenshots | 120/day; 417 KB today → **70 KB optimized**; 90-day retention | Measured in production |
| Stored events | 30 per device per day, 12-month retention, ~50 B compressed | Blocked/alerted only |
| Compute | OCI Ampere A1: $7.30/OCPU-month + $1.10/GB-month | OCI list price |
| Managed Postgres | AWS RDS Multi-AZ list (conservative proxy) | RDS list price |
| Object storage | Cloudflare R2: $0.015/GB-month, $4.50/M writes, $0 egress | R2 list price |

### 5.2 Architecture by scale

| Employees | Stack | Regions |
|---|---|---|
| **100** | Today's setup: 1 VM (4 OCPU/24 GB) runs everything with Docker Compose; Postgres on the VM with nightly off-site backups; Cloudflare Tunnel; R2 | 1 (Mumbai) |
| **1,000** | 1 bigger VM (or 2 for HA) + **managed Postgres** (small, Multi-AZ); Redis on VM | 1 |
| **10,000** | **Kubernetes** (OKE, 3+ nodes, autoscaling); managed Postgres HA; Redis HA; **ClickHouse** for events; Cloudflare Business | 1 |
| **100,000** | K8s multi-AZ in **2 regions** (India + EU or US) for data residency; Postgres HA + read replica per region; ClickHouse cluster; Cloudflare Enterprise; 24×7 on-call | 2 |
| **500,000** | **3 regions** (IN, EU, US); per-region cells; evaluate **self-hosting Mistral Small 4** (open weights) on GPUs, ~30% saving; regional scanning pools | 3 |
| **1,000,000** | **4 regions** (+ Middle East or APAC); cell-based architecture (each cell ~100k employees) so failures stay local | 4 |

**On "POPs": we don't need traffic POPs.** Zscaler/Netskope need 150+ data centres because every web request goes through them. Ours never does: the device enforces policy and fetches the web directly. "Regions" for us means **API + data-residency endpoints**, a far smaller and cheaper footprint. Cloudflare's edge (300+ cities) terminates TLS close to every device for free.

### 5.3 Monthly infra cost (optimized architecture)

| Employees | Devices | Regions | Compute | K8s | Postgres | Events DB | Object storage | AI | Network + CDN | Observability | **Infra total** | **Per employee** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 100 | 120 | 1 | $55 | $0 | $15 | $0 | $0.80 | $11 | $0 | $6 | **$88** | **$0.88** |
| 1,000 | 1,200 | 1 | $122 | $0 | $106 | $0 | $7 | $111 | $20 | $12 | **$379** | **$0.38** |
| 10,000 | 12,000 | 1 | $275 | $74 | $372 | $129 | $58 | $1,110 | $250 | $140 | **$2,431** | **$0.24** |
| 100,000 | 120,000 | 2 | $1,515 | $149 | $2,278 | $391 | $550 | $11,101 | $3,000 | $391 | **$19,415** | **$0.19** |
| 500,000 | 600,000 | 3 | $6,186 | $223 | $7,109 | $801 | $2,667 | $39,904 | $6,176 | $999 | **$64,184** | **$0.13** |
| 1,000,000 | 1,200,000 | 4 | $12,038 | $298 | $18,589 | $1,217 | $5,421 | $79,807 | $10,438 | $1,726 | **$129,753** | **$0.13** |

*AI applies to the ~70% of seats on DLP plans. From 500k, AI runs on self-hosted Mistral Small 4 (~70% of API cost). Before the migration (Gemini prices) the AI column was 2.1x higher up to 100k: e.g. $23,213 instead of $11,101 at 100k.*

### 5.4 Today's architecture vs optimized

| Employees | Today's design | Optimized | Saving | API requests/s (today → optimized) | Screenshot storage TB (today → optimized) |
|---|---|---|---|---|---|
| 100 | $101 | $88 | 13% | 10 → 3 | 0.1 → 0.0 |
| 1,000 | $512 | $379 | 26% | 97 → 31 | 0.8 → 0.1 |
| 10,000 | $3,758 | $2,431 | 35% | 972 → 312 | 8.3 → 1.4 |
| 100,000 | $32,735 | $19,415 | 41% | 7,290 → 2,340 | 82.6 → 13.9 |
| 500,000 | $146,552 | $64,184 | 56% | 36,450 → 11,700 | 412.8 → 69.3 |
| 1,000,000 | $294,488 | $129,753 | 56% | 72,900 → 23,400 | 825.7 → 138.6 |

### 5.5 All-in cost (infra + people + compliance)

| Employees | Infra | SRE + support | Compliance (SOC 2, ISO 27001, pen tests; amortised) | **All-in per month** | **All-in per employee** |
|---|---|---|---|---|---|
| 100 | $88 | $0 (founders) | $0 | **$88** | **$0.88** |
| 1,000 | $379 | $650 | $2,500 | **$3,529** | **$3.53** |
| 10,000 | $2,431 | $5,000 | $4,000 | **$11,431** | **$1.14** |
| 100,000 | $19,415 | $16,500 | $6,000 | **$41,915** | **$0.42** |
| 500,000 | $64,184 | $39,000 | $8,000 | **$111,184** | **$0.22** |
| 1,000,000 | $129,753 | $58,000 | $10,000 | **$197,753** | **$0.20** |

*People are India-based fully loaded costs: SRE $3,500/month, support $1,500/month. Sales, marketing and R&D are not cost-to-serve and are excluded.*

### 5.6 Revenue and margin

Blended across plans (mix shifts toward Enterprise as customers grow) and after typical volume discounts:

| Employees | Blended ARPU (per user / month) | MRR | ARR | Infra margin | All-in margin (incl. people, compliance, 2.5% payment fees) |
|---|---|---|---|---|---|
| 100 | $8.50 | $850 | $10,200 | 90% | 87% |
| 1,000 | $8.50 | $8,500 | $102,000 | 96% | 56% |
| 10,000 | $7.88 | $78,750 | $945,000 | 97% | 83% |
| 100,000 | $8.10 | $810,000 | $9.72M | 98% | 92% |
| 500,000 | $7.60 | $3.8M | $45.6M | 98% | 95% |
| 1,000,000 | $7.80 | $7.8M | $93.6M | 98% | 95% |

**The 1,000-employee dip is intentional and temporary.** SOC 2 Type II and an ISO 27001 programme cost the same whether we have 1,000 or 100,000 users. They are what unlock enterprise deals, so we pay for them early.

### 5.7 Sensitivity: what if we are wrong

| Scenario | 10k employees | 100k | 1M | Margin effect |
|---|---|---|---|---|
| Base | $2,431 | $19,415 | $129,753 | — |
| AI usage 2x higher | $3,471 | $29,816 | $202,560 | −1 pt |
| Screenshots on 50% of seats (not 25%) | $2,481 | $19,919 | $134,802 | ~0 |
| Run on AWS instead of OCI | $3,037 | $22,274 | $154,013 | ~0 to −10 pts at 100 users |
| Every call on the dearest fallback (Gemini 3.1 Flash-Lite) for a whole month | $3,197 | $27,078 | $183,395 | −1 pt |

**Conclusion:** pricing is safe. **AI usage is still the variable to watch**, but up to 100k employees even a month with Mistral fully down costs less than the old Gemini baseline did. Fair-use limits per seat (section 4.2) cap our exposure.

---

## 6. Answering the brief directly

> *"100, 1,000, 10K, 100K, 500K, 1,000K employees: what price, what cost?"*

| Employees | What a customer of this size pays (Business, USD/month) | Our infra cost at this platform size (per month) | Our all-in cost per employee |
|---|---|---|---|
| 100 | $900 | $88 | $0.88 |
| 1,000 | $7,200 | $379 | $3.53 (SOC 2 year) |
| 10,000 | $63,000 | $2,431 | $1.14 |
| 100,000 | $495,000 | $19,415 | $0.42 |
| 500,000 | $2,475,000 | $64,184 | $0.22 |
| 1,000,000 | $4,950,000 | $129,753 | $0.20 |

---

## 7. Engineering decisions this requires (CTO)

| # | Decision | Why | When | Effect |
|---|---|---|---|---|
| 1 | **Done 1 Oct 2026: DLP AI and assistant moved off Gemini 2.5 to Mistral Small 4** (fallbacks Gemma 4 / Gemini 3.1 Flash-Lite; audio on Gemini 3.1 Flash-Lite). KIE.ai removed; OpenRouter calls retried 3x with backoff, then the next model | Gemini 2.5 retires **16 Oct 2026**; Mistral Small 4 won our eval on accuracy, speed and price | **Shipped** | AI cost per seat −50%; funds the plan upgrades |
| 2 | **Per-seat AI budget** (100 text + 10 image per Business user per day; 200 + 20 Enterprise; audio minutes per month) instead of a flat 20,000/org/day | Today an org of 10,000 users gets 2 AI checks per user per day; large customers silently lose AI DLP | Before first 1,000-user customer | Fair, predictable, sellable as "fair use" |
| 3 | **Pre-filter before AI:** skip text < 40 chars, skip text already clean on entity/keyword pre-scan, cache by hash (already done), batch where latency allows | Most messages are harmless chit-chat | Next sprint | ~60% fewer AI calls (60 → 25/day) |
| 4 | **Rules: 10s polling → ETag + long-poll (60s), server push for urgent changes** | 1M employees × 10s polling ≈ 73k req/s for data that rarely changes | Before 10k | 3x less API load |
| 5 | **Screenshots: lossy WebP (q≈60, ≤1600 px)** | 417 KB → ~70 KB; still readable | Next agent release | 6x less screenshot storage and upload bandwidth |
| 6 | **Events → ClickHouse** (Postgres keeps config, users, devices) | Event tables grow without bound; columnar is ~8x smaller and faster for reports | At 10k | Keeps Postgres small and fast |
| 7 | **Kubernetes (OKE) + infrastructure as code** (Terraform/Helm); same Helm chart for every region | Repeatable regions, autoscaling, zero-downtime deploys | Between 1k and 10k | Prerequisite for multi-region |
| 8 | **Data residency regions**: IN first, then EU (GDPR), then US | Enterprise and EU buyers require it; per-region cells | 2nd region at ~50–100k or first EU enterprise deal | Unlocks EU/US enterprise |
| 9 | **Self-hosted classifier** (Mistral Small 4 is open-weights, so the same model on our GPUs) | API cost is still the biggest line at scale | Evaluate at ~500k; only if it beats the API by >25% after ops | AI cost to ~70% |
| 10 | **Backups and DR**: PITR on Postgres, daily ClickHouse snapshots to R2 in another region, quarterly restore drills | A security product cannot lose evidence | From 1k | RPO ≤ 15 min, RTO ≤ 4 h |
| 11 | **Compliance**: SOC 2 Type II, ISO 27001, DPDP Act and GDPR DPA, annual pen test | Enterprise procurement gate | Start at ~1k, certify by ~10k | Unlocks deals > $50k |
| 12 | **Stay on OCI for compute; Cloudflare edge; R2 for objects** | OCI A1 is ~2–3x cheaper than AWS for this workload; R2 has zero egress | Ongoing | Keeps infra margin > 90% |

---

## 8. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| AI model price or availability changes | Cost spikes or DLP AI outage | Retries + model fallback chain on OpenRouter (Mistral → Gemma/Gemini), models switchable by config, per-seat budgets, open-weights model we can self-host |
| A big customer floods DLP (e.g. chat-heavy support teams) | AI cost per seat 3–5x higher | Fair-use caps per seat; pre-filter; Enterprise contract states limits |
| Microsoft Purview "good enough" in M365 shops | Lost deals | Position on cross-platform (macOS/Linux), web + apps + DLP in one agent, faster rollout, price |
| Privacy law on monitoring (EU works councils, DPDP) | Monitoring add-on blocked | Opt-in per device, blur, retention controls, DPA templates, acceptable use policy (already published) |
| OCI regional capacity | Can't scale a region | Helm/Terraform portable to AWS/GCP; model shows AWS still ~96% infra margin at 100k |
| Discounting pressure | Margin erosion | Fixed bands; 45% floor; CEO approval beyond |

---

## 9. Roadmap by scale

| Milestone | Pricing / business | Engineering |
|---|---|---|
| **Now → 1,000 users** | Publish pricing page with the 3 upgraded plans; self-serve checkout (Razorpay + Paddle); 14-day trial | Decision 1 done; decisions 2–3, 5; managed Postgres; backups |
| **1k → 10k** | Start SOC 2 Type II; sales-assisted pilots; partner program | Kubernetes, ClickHouse, rules long-poll (decision 4), IaC |
| **10k → 100k** | ISO 27001; EU entity / DPA; first enterprise deals | 2nd region (EU or US), cell architecture, 24×7 on-call |
| **100k → 500k** | Enterprise pricing desk; MSP channel | 3rd region; evaluate self-hosted classifier |
| **500k → 1M** | Global partners | 4th region; cost reviews per cell |

---

## 10. Decision log

| # | Decision | Chosen | Alternatives considered |
|---|---|---|---|
| D1 | Pricing unit | Per user (≤ 3 devices); device license at 60% for shared machines | Per device; usage-based |
| D2 | Plans | Essentials $4 / Business $9 / Enterprise $14 | 2 plans; à-la-carte modules (too complex to buy) |
| D3 | India | ₹149 / ₹349 / ₹549 + GST | USD parity (uncompetitive); Seqrite parity (unsustainable for DLP/AI) |
| D4 | Discounts | 6 fixed bands, 45% floor, multi-year −5/−10% | Free negotiation (erodes price integrity) |
| D5 | Billing | Annual default, monthly +20% | Monthly default |
| D6 | Free tier | None; 14-day trial | Free ≤ 10 users (misuse risk for monitoring) |
| D7 | AI | Mistral Small 4 via OpenRouter with retries + fallback chain; fair use per seat (100+10 Business, 200+20 Enterprise); self-host evaluated at 500k | Gemini 3.1 Flash-Lite as primary (1.7–2.5x dearer, weaker on vision); Chinese-hosted models (data residency); unlimited AI; per-scan billing |
| D10 | Use of the AI saving | Keep list prices; double AI fair use; add audio/video DLP; AI assistant in Essentials | Cut Business to $8; keep the saving as margin only |
| D8 | Infra | OCI compute + Cloudflare edge + R2 + managed Postgres + ClickHouse | All-AWS (2–3x compute cost) |
| D9 | Regions | IN → EU → US → 4th; no traffic POPs | Own POP network (unnecessary for on-device enforcement) |

---

## 11. Sources

**Competitor pricing**
- Zscaler: [Venn](https://www.venn.com/learn/zscaler-pricing/), [Vendr](https://www.vendr.com/marketplace/zscaler), [zerotrustcost](https://zerotrustcost.com/zscaler-pricing)
- Netskope: [Vendr](https://www.vendr.com/marketplace/netskope), [dope.security analysis](https://dope.security/post/netskope-pricing-2026), [zerotrustcost](https://zerotrustcost.com/netskope-pricing)
- Cisco Umbrella: [dope.security](https://dope.security/post/cisco-umbrella-pricing-2026), [Control D](https://controld.com/blog/cisco-umbrella-pricing/)
- Cloudflare Zero Trust: [costbench](https://costbench.com/software/business-vpn/cloudflare-zero-trust/), [zerotrustcost](https://zerotrustcost.com/cloudflare-zero-trust-pricing)
- Palo Alto Prisma Access: [zerotrustcost](https://zerotrustcost.com/prisma-access-pricing), [UnderDefense](https://underdefense.com/industry-pricings/palo-alto-networks-pricing-ultimate-guide-for-security-products/)
- Check Point Harmony SASE: [TrustRadius](https://www.trustradius.com/products/check-point-harmony-sase/pricing), [costbench](https://costbench.com/software/sase/perimeter81/)
- NordLayer: [costbench](https://costbench.com/software/business-vpn/nordlayer/), [security.org](https://www.security.org/vpn/nordlayer/)
- dope.security: [dope.security](https://dope.security/post/zscaler-alternative-real-pricing-comparison-2026)
- DNSFilter: [Control D](https://controld.com/blog/dnsfilter-pricing/), [G2](https://www.g2.com/products/dnsfilter/pricing)
- CurrentWare: [CurrentWare store](https://www.currentware.com/store/)
- Forcepoint: [Nightfall analysis](https://www.nightfall.ai/blog/forcepoint-dlp-pricing), [Capterra](https://www.capterra.com/p/170409/Forcepoint-DLP/)
- Fortra Digital Guardian: [Vendr](https://www.vendr.com/marketplace/fortra), [G2](https://www.g2.com/products/fortra-dlp-formerly-digital-guardian/pricing)
- Netwrix Endpoint Protector: [TrustRadius](https://www.trustradius.com/products/endpoint-protector-by-cososys/pricing), [Software Advice](https://www.softwareadvice.com/security/endpoint-protector-4-profile/)
- Safetica: [Capterra](https://www.capterra.com/p/254806/Safetica-NXT/pricing/), [safetica.com](https://safetica.com/pricing)
- Microsoft Purview: [comparedge](https://comparedge.com/tools/microsoft-purview/pricing), [Microsoft](https://www.microsoft.com/en-us/microsoft-365/enterprise/microsoft-365-plans-and-pricing)
- Cyberhaven: [Vendr](https://www.vendr.com/marketplace/cyberhaven)
- Nightfall: [nightfall.ai](https://www.nightfall.ai/pricing), [Vendr](https://www.vendr.com/marketplace/nightfall)
- Teramind: [checkthat.ai](https://checkthat.ai/brands/teramind/pricing), [SaaSworthy](https://www.saasworthy.com/product/teramind/pricing)
- Veriato: [veriato.com](https://veriato.com/veriato-pricing/), [SelectHub](https://www.selecthub.com/p/employee-monitoring-software/veriato/)
- ActivTrak: [Capterra](https://www.capterra.com/p/135366/ActivTrak/), [Business News Daily](https://www.businessnewsdaily.com/15128-activtrak-review.html)
- Hubstaff: [hubstaff.com](https://hubstaff.com/hubstaff-pricing-guide)
- Controlio: [controlio.net](https://controlio.net/prices.html)
- Kickidler: [G2](https://www.g2.com/products/kickidler/pricing)
- Seqrite: [Techjockey](https://www.techjockey.com/detail/seqrite-eps-for-business), [Cloudfy](https://cloudfysystems.com/security-cybersecurity/endpoint-security/seqrite-endpoint-security-editions-and-pricing/)

**Infrastructure prices**
- AI models: [OpenRouter Mistral Small 4](https://openrouter.ai/mistralai/mistral-small-2603), [OpenRouter Gemini 3.1 Flash-Lite](https://openrouter.ai/google/gemini-3.1-flash-lite), [OpenRouter Gemma 4 26B](https://openrouter.ai/google/gemma-4-26b-a4b-it); prices read from the OpenRouter models API, 1 Oct 2026. Gemini 2.5 retirement: [CloudZero](https://www.cloudzero.com/blog/gemini-pricing/) (16 Oct 2026)
- Model choice: internal eval on the production DLP and assistant prompts, 1 Oct 2026 (text 40/40, vision 14/14, assistant tools 8/8 for Mistral Small 4)
- Cloudflare R2: [egresscost](https://egresscost.com/cloudflare/), [mecanik](https://mecanik.dev/en/posts/cloudflare-r2-pricing-explained-real-costs-vs-s3-and-backblaze/)
- OCI Ampere A1 and OKE: [Oracle](https://www.oracle.com/cloud/compute/arm/), [Oracle OKE pricing](https://www.oracle.com/cloud/cloud-native/kubernetes-engine/pricing/), [CloudZero](https://www.cloudzero.com/blog/oracle-cloud-pricing/)
- AWS RDS: [Vantage](https://instances.vantage.sh/aws/rds/db.r7g.2xlarge), [AWS](https://aws.amazon.com/rds/pricing/)

**Internal measurements**
- Production host spec, container footprint, database size: read on the production server, 1 Oct 2026.
- Event, screenshot and AI-assistant volumes: read-only queries on the production database, 1 Oct 2026.
- Agent intervals and DLP AI limits: `services/endpoint-agent/src/background.rs`, `services/dlp-service-rust/src/ai.rs`.

*Third-party competitor figures are estimates where vendors do not publish prices, and are labelled* est. *Re-check before quoting a competitor's price to a customer.*
