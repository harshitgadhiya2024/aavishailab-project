# Aavishield Pricing Strategy aur Cost-to-Serve (Hinglish)

*1 October 2026 ko tayyar kiya; usi din AI model migration (Gemini 2.5 → Mistral Small 4) ke baad update kiya. Model: `scripts/business/pricing_model.py` (chalane par saari tables dobara ban jaati hain). English version: `pricing-strategy-en.md`.*

---

## 1. Executive summary (ek page me poora faisla)

**Faisla ek paragraph me.** Aavishield ki pricing **har protected employee (user) ke hisaab se, per month, saal bhar ke liye advance (annual billing)** hogi. Ek user license me us employee ke 3 devices tak cover honge. Teen plan bechenge: **Essentials $4**, **Business $9**, **Enterprise $14** (USD list price). India me yahi plan **₹149 / ₹349 / ₹549** + GST honge. Badi company ko volume ke hisaab se fixed bands me discount milega (0% se 45% tak); 45% se zyada discount CEO ki approval ke bina nahi. 100 se 10 lakh employees tak har scale par infra ka kharcha **$0.13–$0.88 per employee per month** aata hai, isliye infra margin **90–98%** rehta hai. SRE, support aur compliance (SOC 2 waghaira) jod kar bhi 10,000 employees ke baad margin **83–95%** hai. Sirf 1,000 employees ke aas-paas margin kam rehta hai, kyunki tab SOC 2 sabse bada kharcha hota hai.

**Ye model hamare liye kyun kaam karta hai, Zscaler ya Netskope ke liye kyun nahi.** Hamari policy **device par hi chalti hai**. Hum aise data centres (POPs) nahi chalate jinse customer ka saara internet traffic guzre. Hamare paas sirf control traffic aur security events aate hain: har device ke kuch kilobytes, gigabytes nahi. Yahi hamara asli cost advantage hai, aur isi wajah se hum SSE vendors se 40–70% saste rehkar bhi unse behtar margin kama sakte hain.

**Paanch engineering faisle jinke saath asli paisa juda hai** (section 7):
1. **Ho gaya (1 Oct 2026): DLP AI ko Gemini 2.5 se hata diya** (16 Oct ko band ho raha hai). Ab OpenRouter ke through **Mistral Small 4** chalta hai, retries aur fallback model chain ke saath; KIE.ai poori tarah hata diya. Per DLP seat AI kharcha **~50% kam** hua (optimized: $0.33 → $0.16 per month).
2. **Har 10 second wali rules polling ko 60 second ke ETag/long-poll par le jaana.** Isse scale par API load 3 guna kam hoga.
3. **DLP AI ka budget per seat karna, har company ke liye flat 20,000 calls per din nahi.** Abhi ka cap ~1,000 users se badi company ke liye chupchaap classification band kar deta hai. Model se pehle ek sasta pre-filter lagana.
4. **Screenshots ko lossless se lossy WebP karna** (417 KB → ~70 KB). Screenshot storage 6 guna kam hoga.
5. **10,000 employees ke baad security events ko columnar database (ClickHouse) me le jaana**, aur Postgres sirf configuration ke liye rakhna.

Faisle 2–4 milkar 10,000 employees ke baad infra cost **35–56%** kam karte hain.

**Saste AI se plans me kya badla (section 4.2):** list price wahi rahega, kyunki wo market ke hisaab se tay hai, hamari cost se nahi. Bachat product me wapas daali hai: Business aur Enterprise me **AI fair use double**, **audio/video DLP** ab shaamil, aur **AI assistant** ab Essentials me bhi. Business ka ek user agar naya poora AI allowance use kare, to hamara kharcha lagbhag utna hi hai jitna purane chhote allowance ka Gemini par tha (~$0.56 vs $0.54 per month).

---

## 2. Hum kya bechte hain, aur hamari cost alag kyun hai

Aavishield ek agent hai (Rust me, macOS/Windows/Linux par) jo ye controls device par lagata hai aur ek console ko report karta hai:

| Control | Kaam kahan hota hai | Hamare cloud tak kya aata hai |
|---|---|---|
| Web gateway (categories, domains) | Device par (local HTTPS proxy) | Policy pull; sirf blocked events |
| VPN / proxy blocking | Device par | Block ki gayi koshishein |
| Application control | Device par | Inventory (har ghante) aur blocked launches |
| Malware download scanning | Hamari scanning service tak stream hota hai | File stream, phir verdict |
| Data loss prevention | Agent pakadta hai; **hamari DLP service jaanch karti hai** (patterns, OCR, AI) | Upload ka content jaanch ke liye; findings save hote hain, files nahi |
| Device posture | Device par | Posture report |
| Activity monitoring | Device par | Screenshots + activity (sirf opt-in seats) |

**Hamari cost kis cheez se banti hai, kram se:**
1. **DLP ke liye AI classification** (OpenRouter ke through Mistral Small 4). 10k+ employees par infra cost ka 46–62% yahi hai (Gemini par 64–74% tha).
2. **Managed PostgreSQL**, saare regions me.
3. **Compute**, API aur DLP/malware scanning ke liye.
4. **CDN/edge** (Cloudflare) aur **object storage** (Cloudflare R2: screenshots, backups, agent packages; egress free).

**Production me aaj naapa gaya:**
- Ek Oracle Cloud Ampere A1 VM (4 OCPU, 24 GB, Mumbai) poora stack chalata hai. Postgres 125 MB ka hai.
- Save hone wale events: 3.7 per device per din (sirf blocked/alerted; allowed traffic kabhi save nahi hota).
- Screenshot ka size: average 417 KB (lossless WebP).
- AI (1 Oct 2026 se): text, images aur assistant ke liye `mistralai/mistral-small-2603`; audio ke liye aur text fallback ke roop me `google/gemini-3.1-flash-lite`; image fallback `google/gemma-4-26b-a4b-it`. Sirf OpenRouter; har model par 3 retries, phir agla model. Jo providers prompts save karte hain, wo bahar.
- AI budget: har company par per din 20,000 text / 2,000 image / 500 audio calls ka cap.

---

## 3. Competitors (24 vendors)

Price per user (ya jahan likha ho, per device), USD me, list ya typical bazaar price. Zyaadatar enterprise vendors list price publish nahi karte. Unke numbers procurement data (Vendr), sarkari price lists (G-Cloud, GSA) aur analyst reports se hain, aur *est.* (anumaan) likha hai.

### 3.1 SSE / secure web gateway (cloud proxy) — ye POPs chalate hain

| # | Vendor | Price per user / month | Model | Notes |
|---|---|---|---|---|
| 1 | **Zscaler Internet Access** | $6–$27 (*est.*, $72–$325/saal) | Per user, sirf quote | Market leader; 2025 me kuch SKUs par 35%+ daam badhe. DLP alag add-on hai. |
| 2 | **Netskope** | $4–$8 base, $9–$14 mid, $15+ full (*est.*) | Per user, quote | Median contract ~$96k/saal. |
| 3 | **Cisco Umbrella** | DNS $2.5–$3.3; SIG Essentials $5–$7.5 (*est.*) | Per user, reseller | Enterprise all-in $80–$150/user/saal. |
| 4 | **Cloudflare Zero Trust** | $7 (50 users tak free) | Per user, public | SWG + ZTNA + basic DLP; RBI +$10. |
| 5 | **Palo Alto Prisma Access** | $5–$12.5 list; $3–$7.5 discount ke baad (*est.*) | Per user / per Mbps | Poora SASE, bhaari enterprise sales. |
| 6 | **Check Point Harmony SASE** (Perimeter 81) | $10 / $15 / $20 | Per user, public | + $50/month per gateway. |
| 7 | **NordLayer** | $8 / $11 / $14 (annual) | Per user, public | VPN par focus; kam se kam 5 users; dedicated IP +$40/month. |
| 8 | **dope.security** | $5 ($60/device/saal) | Per device, public | **Architecture me hamare sabse kareeb** (device par SWG). DLP aur monitoring nahi. |

### 3.2 SMB ke liye DNS / web filtering

| # | Vendor | Price per user / month | Notes |
|---|---|---|---|
| 9 | **DNSFilter** | $2.10 Pro / $2.70 Enterprise (annual) | Sirf DNS; TLS inspection ya DLP nahi. |
| 10 | **CurrentWare** | BrowseControl $6; poora suite $12–$20 | Web filter + monitoring + USB; on-prem se shuru hua. |

### 3.3 Data loss prevention / insider risk

| # | Vendor | Price per user / month | Notes |
|---|---|---|---|
| 11 | **Forcepoint DLP** | ~$4.3 (*est.*, $52/saal se); full stack $6–$12.5 | Purana leader; deploy karna bhaari. |
| 12 | **Fortra Digital Guardian** | $3.3–$6.7 per endpoint (*est.*); managed +$1.7–$3.3 | Endpoint DLP. |
| 13 | **Netwrix Endpoint Protector** (CoSoSys) | ~$1.9–$3.8 (*est.*) | Device control + content DLP. |
| 14 | **Safetica** | $6 / $8 / $12 ($72/$96/$144 per saal se) | SMB DLP me sabse kareebi comparison. |
| 15 | **Microsoft Purview Suite** (pehle E5 Compliance) | M365 E3 par $12 add-on | E5 ($60) me bundled. M365 wali companies me "itna kaafi hai" wala sabse bada khatra. |
| 16 | **Cyberhaven** | Quote; median contract ~$38k/saal | Data lineage DDR; enterprise. |
| 17 | **Nightfall AI** | Quote; contracts $75k–$200k+/saal | SaaS/GenAI/endpoint ke liye AI DLP. |
| 18 | **Teramind** | $15 Starter / $30 UAM / $35 DLP | Monitoring + DLP; kam se kam 5 seats. |
| 19 | **Veriato** | $15 UAM (annual) | Insider risk, monitoring. |

### 3.4 Employee monitoring / productivity

| # | Vendor | Price per user / month | Notes |
|---|---|---|---|
| 20 | **ActivTrak** | $10 / $15 / $19; screenshots +$2 | Productivity analytics; kam se kam 5 users. |
| 21 | **Hubstaff** | $4.99 / $7.50 / $10 / $25 (annual) | Time tracking + screenshots. |
| 22 | **Controlio** | $6.67 / $9.99 | Monitoring. |
| 23 | **Kickidler** | ~$1.8–$4 | Monitoring, sasta. |

### 3.5 India

| # | Vendor | Price | Notes |
|---|---|---|---|
| 24 | **Seqrite (Quick Heal) Endpoint Security Total** | ₹850 per user per **saal** + GST (≈ ₹71/month) | Antivirus pehle, saath me basic DLP aur web filtering; local price anchor. |

### 3.6 Market se kya samajh aata hai

- **Jo Aavishield akela karta hai, uske liye buyer ko 2–3 products jodne padte hain.** Jaise Cloudflare $7 + Safetica $8 + ActivTrak $15 = **$30 per user per month**. Sirf Teramind DLP ke saath $35 hai. Hamara Enterprise $14 par us stack ke **aadhe se bhi kam** me milta hai.
- **Sirf web filtering (SWG) ka floor ~$2–$7 hai** (DNSFilter, Umbrella DNS, dope, Cloudflare). Essentials $4 isi band me hai, par isme posture, app control aur VPN control bhi hain jo DNS tools me nahi.
- **DLP ka band ~$4–$12 hai** (Forcepoint, Safetica, Purview). Business $9 beech me hai, aur isme web + apps + DLP + AI (ab audio/video bhi) sab ek agent me hai.
- **Enterprise buyers list se 30–60% discount ki ummeed rakhte hain.** Hamare bands 45% tak jaate hain, aur us floor par bhi margin 75% se upar rehta hai.
- **India bahut price-sensitive hai** (Seqrite ≈ ₹71/user/month). Hum Seqrite se ~2 guna par price karte hain, kyunki product kahin zyada bada hai. US ke barabar nahi.

---

## 4. Pricing ke faisle

### 4.1 Unit: per employee (user), per device nahi — tay hai

| Option | Faayda | Nuksaan | Faisla |
|---|---|---|---|
| **Per user** | Buyer isi tarah budget banata hai (HR headcount); ek price me laptop + desktop dono; SSE/DLP me yahi standard hai | Shared/kiosk machines ke liye alag niyam chahiye | **Yahi chuna** |
| Per device | Ginna aasaan (enrolled devices hum ginte hain) | Kai devices wale employees par bojh; forecast mushkil | Sirf shared/kiosk/lab machines ke liye **device license**, user price ke **60%** par |
| Usage-based (GB / scans) | Cost ke saath chalta hai | Bill ka andaza nahi lagta; security buyers ise pasand nahi karte | Reject (AI ko fair-use se control karte hain) |

**Niyam:** 1 user license = 1 naamit employee, 3 enrolled devices tak. Billing me **mahine ke peak active users** gine jaate hain, har invite kiya hua user nahi. Khareede gaye count se 10% tak zyada chalega; uske upar har quarter contract rate par adjust hoga.

### 4.2 Plans aur unme kya hai

| | **Essentials** | **Business** (sabse zyada chuna jaata) | **Enterprise** |
|---|---|---|---|
| **USD list** (per user / month, annual) | **$4** | **$9** | **$14** |
| **India list** (+ GST) | **₹149** | **₹349** | **₹549** |
| Web gateway + 27 categories + URL checker | ✓ | ✓ | ✓ |
| VPN / proxy blocking | ✓ | ✓ | ✓ |
| Malware download scanning + threat intel | ✓ | ✓ | ✓ |
| Device posture + compliance report | ✓ | ✓ | ✓ |
| Admins ke liye AI assistant (console se seedhi bhasha me sawaal) | ✓ **naya** | ✓ | ✓ |
| Data loss prevention (patterns + OCR) | — | ✓ | ✓ |
| AI classification, fair use per user per din | — | **100 text + 10 image** (pehle 50 + 5) | **200 text + 20 image** (pehle 100 + 10) |
| Audio/video DLP (transcribe karke scan), per user per month | — | **20 min naya** | **60 min naya** |
| Application control + inventory | — | ✓ | ✓ |
| Per-team policies, access requests | — | ✓ | ✓ |
| Activity monitoring + screenshots | — | add-on $4 | ✓ |
| Event retention | 30 din | 90 din | 12 mahine |
| SSO/SCIM, audit export, custom block page | — | — | ✓ |
| Data residency (IN / EU / US) | — | — | ✓ |
| Support | Email | Email + chat | Priority SLA; 1,000+ users par named CSM |

**Ye upgrade surakshit kyun hain (poora allowance use karne wale user ka hamara kharcha, per month):**

| Plan | AI allowance | Hamara worst-case AI kharcha | List price ka hissa |
|---|---|---|---|
| Business (purana, Gemini par) | 50 text + 5 image/din | $0.54 | 6% |
| **Business (naya, Mistral par)** | 100 text + 10 image/din + 20 min audio | **$0.59** | 7% |
| **Enterprise (naya, Mistral par)** | 200 text + 20 image/din + 60 min audio | **$1.20** | 9% |
| Essentials: sirf AI assistant | Admin ke sawaal | ~$0.01 | <1% |

*Per call: text ~$0.000225, image ~$0.000284 (Mistral Small 4; 5% calls mehenge fallback par maan kar); audio ~$0.0014 per minute (Gemini 3.1 Flash-Lite). Average user isse kaafi kam use karta hai: model 25 text + 4 image calls per din maanta hai.*

**Price ka faisla: $4 / $9 / $14 (₹149 / ₹349 / ₹549) hi rakhenge.** Business ko $8 karne ka socha tha, par reject kiya: market band $4–$12 hai aur buyer features compare karta hai, isliye usi price par zyada features wala plan, $1 saste same plan se behtar bikta hai. Margin me +1–2 pts ka faayda SOC 2 ko jaldi fund karne me madad karta hai.

**Add-ons:**
- Business seats ke liye activity monitoring: $4 (₹149). Sirf monitored seats par lagta hai.
- Extra audio/video DLP: +$1 per user per month me 300 minute (hamara kharcha ~$0.42).
- Extended retention: 2 saal, +$1.
- Premium 24×7 support: contract ka +15%.
- Device license (shared machines): plan price ka 60%.

### 4.3 Volume bands (poore order par lagta hai, tukdon me nahi)

| Users | Discount | Business price per user |
|---|---|---|
| 10–249 | 0% | $9.00 |
| 250–999 | 10% | $8.10 |
| 1,000–4,999 | 20% | $7.20 |
| 5,000–24,999 | 30% | $6.30 |
| 25,000–99,999 | 38% | $5.58 |
| 100,000+ | 45% (floor) | $4.95 |

**Baaki levers:**
- Multi-year advance: 2 saal −5%, 3 saal −10%.
- Monthly billing: +20% (default annual hai).
- Hard floor: CEO approval ke bina **list se 50% se zyada discount nahi**. 50% off par bhi Business $4.50 hai, jo 10,000 employees ke baad all-in cost ($1.14) ka ~4 guna hai.

### 4.4 Ek customer kitna dega (annual billing)

**USD per month, poori company ke liye:**

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

*Asal me 1 lakh+ wale deals alag se negotiate hote hain. Ye table negotiation se pehle ki upari seema hai.*

### 4.5 International pricing

| Region | Currency | USD list ke mukable price | Kyun |
|---|---|---|---|
| US, Canada, UK, EU, Australia, Gulf | USD (EUR/GBP fixed rate par) | 100% | Benchmark market |
| India | INR | ~45% (Business ₹349 ≈ $4.15) | Price-sensitive; Seqrite anchor ≈ ₹71 |
| SE Asia, LATAM, Africa | USD | 70% | PPP ke hisaab se, partners ke through |

- **Billing:** INR ke liye Razorpay; USD/EUR ke liye Stripe/Paddle (Paddle merchant of record banta hai, isliye duniya bhar ka VAT/sales-tax filing hamein nahi karna padta). Payment fees ke liye ~2.5% rakhein.
- **Partners:** MSPs/resellers ko **20% margin** (certified partners ko 30%), same list price par, taaki price har jagah ek jaisa rahe.

### 4.6 Trial aur sales ka tareeka

| Customer size | Tareeka |
|---|---|
| ≤ 250 users | Self-serve 14 din ka trial, checkout par card, monthly ya annual |
| 250–5,000 users | Sales ke saath 30 din ka pilot, 25 devices tak, phir annual contract |
| 5,000+ users | Enterprise: security review, pilot, procurement. 3–6 mahine ka cycle maan kar chalein. |

- **Minimum:** 10 users (Essentials par $40/month).
- **Free tier:** nahi. 14 din ka trial kaafi hai, aur monitoring/DLP product ka free tier galat istemaal ko bulata hai.

---

## 5. Har scale par cost-to-serve

### 5.1 Mukhya assumptions (sab model me hain)

| Assumption | Value | Aadhaar |
|---|---|---|
| Devices per employee | 1.2 | Laptop + kabhi-kabhi doosri machine |
| Peak par online devices | 60% (ek region), 45% (global, 100k+) | Alag time zones ke office hours |
| Online device ki API requests | 0.135/sec aaj → **0.043/sec optimized** | Agent: rules 10s, heartbeat 60s, mitm 300s, lookups, events |
| Per employee per workday scanning CPU | 9 CPU-seconds | DLP text/files/OCR + malware download scans |
| DLP employee ki per workday AI text calls | 60 aaj → **25 optimized** | Har outbound message jo pehle block na hua ho, pre-filter/cache ke baad |
| Per employee per workday AI image calls | 4 | Upload ki gayi images/screens |
| AI rates | $0.15 / $0.60 per M tokens (text aur vision); 5% calls $0.25 / $1.50 par (fallback) | OpenRouter par Mistral Small 4 list; sabse mehenga fallback Gemini 3.1 Flash-Lite |
| Screenshots wali seats | 25% | Enterprise + add-on |
| Screenshots | 120/din; 417 KB aaj → **70 KB optimized**; 90 din retention | Production me naapa |
| Save hone wale events | 30 per device per din, 12 mahine retention, ~50 B compressed | Sirf blocked/alerted |
| Compute | OCI Ampere A1: $7.30/OCPU-month + $1.10/GB-month | OCI list price |
| Managed Postgres | AWS RDS Multi-AZ list (savdhani wala proxy) | RDS list price |
| Object storage | Cloudflare R2: $0.015/GB-month, $4.50/M writes, $0 egress | R2 list price |

### 5.2 Har scale par architecture

| Employees | Stack | Regions |
|---|---|---|
| **100** | Aaj wala setup: 1 VM (4 OCPU/24 GB) par Docker Compose se sab kuch; Postgres usi VM par, roz off-site backup; Cloudflare Tunnel; R2 | 1 (Mumbai) |
| **1,000** | 1 bada VM (ya HA ke liye 2) + **managed Postgres** (chhota, Multi-AZ); Redis VM par | 1 |
| **10,000** | **Kubernetes** (OKE, 3+ nodes, autoscaling); managed Postgres HA; Redis HA; events ke liye **ClickHouse**; Cloudflare Business | 1 |
| **100,000** | Data residency ke liye **2 regions** (India + EU ya US) me K8s multi-AZ; har region me Postgres HA + read replica; ClickHouse cluster; Cloudflare Enterprise; 24×7 on-call | 2 |
| **500,000** | **3 regions** (IN, EU, US); har region me cells; **Mistral Small 4 ko apne GPUs par self-host** karna evaluate (~30% bachat); regional scanning pools | 3 |
| **1,000,000** | **4 regions** (+ Middle East ya APAC); cell-based architecture (har cell ~1 lakh employees), taaki koi failure sirf us cell tak rahe | 4 |

**"POPs" ke baare me: hamein traffic POPs nahi chahiye.** Zscaler/Netskope ko 150+ data centres chahiye, kyunki har web request unse hokar jaati hai. Hamare yahan kabhi nahi jaati: device khud policy lagata hai aur web seedha kholta hai. Hamare liye "region" ka matlab hai **API + data-residency endpoints**, jo kahin chhota aur sasta hai. Cloudflare ka edge (300+ shehar) har device ke paas TLS free me sambhal leta hai.

### 5.3 Monthly infra cost (optimized architecture)

| Employees | Devices | Regions | Compute | K8s | Postgres | Events DB | Object storage | AI | Network + CDN | Observability | **Infra total** | **Per employee** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 100 | 120 | 1 | $55 | $0 | $15 | $0 | $0.80 | $11 | $0 | $6 | **$88** | **$0.88** |
| 1,000 | 1,200 | 1 | $122 | $0 | $106 | $0 | $7 | $111 | $20 | $12 | **$379** | **$0.38** |
| 10,000 | 12,000 | 1 | $275 | $74 | $372 | $129 | $58 | $1,110 | $250 | $140 | **$2,431** | **$0.24** |
| 100,000 | 120,000 | 2 | $1,515 | $149 | $2,278 | $391 | $550 | $11,101 | $3,000 | $391 | **$19,415** | **$0.19** |
| 500,000 | 600,000 | 3 | $6,186 | $223 | $7,109 | $801 | $2,667 | $39,904 | $6,176 | $999 | **$64,184** | **$0.13** |
| 1,000,000 | 1,200,000 | 4 | $12,038 | $298 | $18,589 | $1,217 | $5,421 | $79,807 | $10,438 | $1,726 | **$129,753** | **$0.13** |

*AI sirf ~70% seats par lagta hai (jo DLP wale plans par hain). 500k se AI self-hosted Mistral Small 4 par (~70% API cost). Migration se pehle (Gemini rates) 100k tak AI column 2.1 guna tha: jaise 100k par $11,101 ki jagah $23,213.*

### 5.4 Aaj ka design vs optimized

| Employees | Aaj ka design | Optimized | Bachat | API requests/sec (aaj → optimized) | Screenshot storage TB (aaj → optimized) |
|---|---|---|---|---|---|
| 100 | $101 | $88 | 13% | 10 → 3 | 0.1 → 0.0 |
| 1,000 | $512 | $379 | 26% | 97 → 31 | 0.8 → 0.1 |
| 10,000 | $3,758 | $2,431 | 35% | 972 → 312 | 8.3 → 1.4 |
| 100,000 | $32,735 | $19,415 | 41% | 7,290 → 2,340 | 82.6 → 13.9 |
| 500,000 | $146,552 | $64,184 | 56% | 36,450 → 11,700 | 412.8 → 69.3 |
| 1,000,000 | $294,488 | $129,753 | 56% | 72,900 → 23,400 | 825.7 → 138.6 |

### 5.5 All-in cost (infra + log + compliance)

| Employees | Infra | SRE + support | Compliance (SOC 2, ISO 27001, pen tests; amortised) | **All-in per month** | **All-in per employee** |
|---|---|---|---|---|---|
| 100 | $88 | $0 (founders) | $0 | **$88** | **$0.88** |
| 1,000 | $379 | $650 | $2,500 | **$3,529** | **$3.53** |
| 10,000 | $2,431 | $5,000 | $4,000 | **$11,431** | **$1.14** |
| 100,000 | $19,415 | $16,500 | $6,000 | **$41,915** | **$0.42** |
| 500,000 | $64,184 | $39,000 | $8,000 | **$111,184** | **$0.22** |
| 1,000,000 | $129,753 | $58,000 | $10,000 | **$197,753** | **$0.20** |

*Log India-based fully loaded cost par hain: SRE $3,500/month, support $1,500/month. Sales, marketing aur R&D cost-to-serve me nahi aate, isliye shaamil nahi.*

### 5.6 Revenue aur margin

Saare plans ka mix (customer bade hone par mix Enterprise ki taraf jaata hai), typical volume discount ke baad:

| Employees | Blended ARPU (per user / month) | MRR | ARR | Infra margin | All-in margin (log, compliance, 2.5% payment fees ke baad) |
|---|---|---|---|---|---|
| 100 | $8.50 | $850 | $10,200 | 90% | 87% |
| 1,000 | $8.50 | $8,500 | $102,000 | 96% | 56% |
| 10,000 | $7.88 | $78,750 | $945,000 | 97% | 83% |
| 100,000 | $8.10 | $810,000 | $9.72M | 98% | 92% |
| 500,000 | $7.60 | $3.8M | $45.6M | 98% | 95% |
| 1,000,000 | $7.80 | $7.8M | $93.6M | 98% | 95% |

**1,000 employees par margin ka girna jaan-boojh kar hai aur temporary hai.** SOC 2 Type II aur ISO 27001 ka kharcha 1,000 users par bhi utna hi hai jitna 1,00,000 par. Enterprise deals inhi se khulte hain, isliye ye kharcha pehle karna padta hai.

### 5.7 Sensitivity: agar andaze galat nikle to

| Scenario | 10k employees | 100k | 1M | Margin par asar |
|---|---|---|---|---|
| Base | $2,431 | $19,415 | $129,753 | — |
| AI usage 2 guna | $3,471 | $29,816 | $202,560 | −1 pt |
| 50% seats par screenshots (25% ki jagah) | $2,481 | $19,919 | $134,802 | ~0 |
| OCI ki jagah AWS par chalayein | $3,037 | $22,274 | $154,013 | ~0; sirf 100 users par −10 pts |
| Poore mahine har call sabse mehenge fallback (Gemini 3.1 Flash-Lite) par | $3,197 | $27,078 | $183,395 | −1 pt |

**Nateeja:** pricing surakshit hai. **Nazar rakhne wali cheez ab bhi AI usage hai**, par 100k employees tak, poore mahine Mistral band rahe tab bhi kharcha purane Gemini base se kam hai. Per-seat fair-use limits (section 4.2) is jokhim ko control karti hain.

---

## 6. Aapke sawaal ka seedha jawab

> *"100, 1,000, 10K, 100K, 500K, 1,000K employees: price kya, cost kya?"*

| Employees | Is size ki company kitna degi (Business, USD/month) | Is platform size par hamara infra cost (per month) | Hamara all-in cost per employee |
|---|---|---|---|
| 100 | $900 | $88 | $0.88 |
| 1,000 | $7,200 | $379 | $3.53 (SOC 2 wala saal) |
| 10,000 | $63,000 | $2,431 | $1.14 |
| 100,000 | $495,000 | $19,415 | $0.42 |
| 500,000 | $2,475,000 | $64,184 | $0.22 |
| 1,000,000 | $4,950,000 | $129,753 | $0.20 |

---

## 7. Iske liye zaroori engineering faisle (CTO)

| # | Faisla | Kyun | Kab | Asar |
|---|---|---|---|---|
| 1 | **Ho gaya 1 Oct 2026: DLP AI aur assistant Gemini 2.5 se Mistral Small 4 par** (fallback Gemma 4 / Gemini 3.1 Flash-Lite; audio Gemini 3.1 Flash-Lite par). KIE.ai hataya; OpenRouter calls par 3 retries backoff ke saath, phir agla model | Gemini 2.5 **16 Oct 2026** ko band; hamare eval me Mistral Small 4 accuracy, speed aur price teeno me aage | **Ship ho gaya** | Per seat AI kharcha −50%; isi se plans upgrade hue |
| 2 | **Per-seat AI budget** (Business user ko 100 text + 10 image per din; Enterprise 200 + 20; audio minutes per month), har company par flat 20,000/din ki jagah | Aaj 10,000 users wali company ko per user per din sirf 2 AI checks milte hain; badi companies ka AI DLP chupchaap band ho jaata hai | Pehle 1,000-user customer se pehle | Fair, andaza lagne layak, "fair use" ke roop me bechne layak |
| 3 | **AI se pehle pre-filter:** 40 characters se chhota text skip, entity/keyword pre-scan me saaf text skip, hash se cache (pehle se hai), latency ijazat de to batch | Zyaadatar messages normal baat-cheet hote hain | Agle sprint me | AI calls ~60% kam (60 → 25/din) |
| 4 | **Rules: 10s polling → ETag + long-poll (60s); urgent changes ke liye server push** | 10 lakh employees × 10s polling ≈ 73k req/sec, us data ke liye jo kabhi-kabhi badalta hai | 10k se pehle | API load 3x kam |
| 5 | **Screenshots: lossy WebP (q≈60, ≤1600 px)** | 417 KB → ~70 KB; phir bhi padhne layak | Agle agent release me | Screenshot storage aur upload bandwidth 6x kam |
| 6 | **Events → ClickHouse** (Postgres me config, users, devices) | Event tables bina rukawat badhti hain; columnar ~8x chhota aur reports ke liye tez | 10k par | Postgres chhota aur tez rehta hai |
| 7 | **Kubernetes (OKE) + infrastructure as code** (Terraform/Helm); har region ke liye ek hi Helm chart | Regions dobara banana aasaan, autoscaling, bina downtime deploys | 1k aur 10k ke beech | Multi-region ki pehli shart |
| 8 | **Data residency regions**: pehle IN, phir EU (GDPR), phir US | Enterprise aur EU buyers ki maang; har region me cells | ~50–100k par ya pehle EU enterprise deal par doosra region | EU/US enterprise khulta hai |
| 9 | **Self-hosted classifier** (Mistral Small 4 open-weights hai, wahi model apne GPUs par) | Scale par ab bhi API cost sabse badi line hai | ~500k par evaluate; tabhi jab ops ke baad API se >25% sasta pade | AI cost ~70% |
| 10 | **Backups aur DR**: Postgres par PITR, ClickHouse ke roz snapshots doosre region ke R2 me, har quarter restore drill | Security product evidence nahi kho sakta | 1k se | RPO ≤ 15 min, RTO ≤ 4 h |
| 11 | **Compliance**: SOC 2 Type II, ISO 27001, DPDP Act aur GDPR DPA, saalana pen test | Enterprise procurement ka gate | ~1k par shuru, ~10k tak certified | $50k+ ke deals khulte hain |
| 12 | **Compute OCI par, edge Cloudflare, objects R2 par rakhein** | Is workload ke liye OCI A1, AWS se ~2–3x sasta; R2 par egress zero | Lagatar | Infra margin > 90% |

---

## 8. Risks

| Risk | Asar | Bachaav |
|---|---|---|
| AI model ka daam ya availability badle | Cost achanak badhe ya DLP AI band ho | OpenRouter par retries + model fallback chain (Mistral → Gemma/Gemini), config se model badal sakte hain, per-seat budgets, open-weights model jo hum khud host kar sakte hain |
| Bada customer DLP ko flood kare (jaise chat-heavy support teams) | Per seat AI cost 3–5x | Per-seat fair-use caps; pre-filter; Enterprise contract me limits likhi hon |
| M365 wali companies me Microsoft Purview "itna kaafi hai" | Deals haath se jaayein | Cross-platform (macOS/Linux), web + apps + DLP ek agent me, jaldi rollout, price par position karein |
| Monitoring par privacy kaanoon (EU works councils, DPDP) | Monitoring add-on ruk sakta hai | Per-device opt-in, blur, retention controls, DPA templates, acceptable use policy (pehle se published) |
| OCI regional capacity | Region scale na ho | Helm/Terraform AWS/GCP par portable; model ke hisaab se AWS par bhi 100k par ~96% infra margin |
| Discount ka dabaav | Margin ghatega | Fixed bands; 45% floor; usse aage CEO approval |

---

## 9. Scale ke hisaab se roadmap

| Padaav | Pricing / business | Engineering |
|---|---|---|
| **Abhi → 1,000 users** | 3 upgraded plans ke saath pricing page publish; self-serve checkout (Razorpay + Paddle); 14 din trial | Faisla 1 ho gaya; faisle 2–3, 5; managed Postgres; backups |
| **1k → 10k** | SOC 2 Type II shuru; sales ke saath pilots; partner program | Kubernetes, ClickHouse, rules long-poll (faisla 4), IaC |
| **10k → 100k** | ISO 27001; EU entity / DPA; pehle enterprise deals | Doosra region (EU ya US), cell architecture, 24×7 on-call |
| **100k → 500k** | Enterprise pricing desk; MSP channel | Teesra region; self-hosted classifier evaluate |
| **500k → 1M** | Global partners | Chautha region; har cell ka cost review |

---

## 10. Decision log (record)

| # | Faisla | Kya chuna | Aur kya socha tha |
|---|---|---|---|
| D1 | Pricing unit | Per user (≤ 3 devices); shared machines ke liye 60% par device license | Per device; usage-based |
| D2 | Plans | Essentials $4 / Business $9 / Enterprise $14 | 2 plans; alag-alag modules (khareedna bahut complex) |
| D3 | India | ₹149 / ₹349 / ₹549 + GST | USD ke barabar (competitive nahi); Seqrite ke barabar (DLP/AI ke liye tik nahi sakta) |
| D4 | Discounts | 6 fixed bands, 45% floor, multi-year −5/−10% | Khula negotiation (price ki izzat ghatti hai) |
| D5 | Billing | Default annual, monthly +20% | Default monthly |
| D6 | Free tier | Nahi; 14 din trial | ≤ 10 users free (monitoring product ke galat istemaal ka khatra) |
| D7 | AI | OpenRouter par Mistral Small 4, retries + fallback chain; per seat fair use (Business 100+10, Enterprise 200+20); 500k par self-host evaluate | Gemini 3.1 Flash-Lite primary (1.7–2.5x mehenga, images par kamzor); Chinese-hosted models (data residency); unlimited AI; per-scan billing |
| D10 | AI bachat ka istemaal | List price same; AI fair use double; audio/video DLP shaamil; Essentials me AI assistant | Business ko $8 karna; bachat sirf margin me rakhna |
| D8 | Infra | OCI compute + Cloudflare edge + R2 + managed Postgres + ClickHouse | Sab kuch AWS par (2–3x compute cost) |
| D9 | Regions | IN → EU → US → chautha; traffic POPs nahi | Apna POP network (on-device enforcement me zaroorat nahi) |

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
- AI models: [OpenRouter Mistral Small 4](https://openrouter.ai/mistralai/mistral-small-2603), [OpenRouter Gemini 3.1 Flash-Lite](https://openrouter.ai/google/gemini-3.1-flash-lite), [OpenRouter Gemma 4 26B](https://openrouter.ai/google/gemma-4-26b-a4b-it); rates OpenRouter models API se, 1 Oct 2026. Gemini 2.5 band hone ki tareekh: [CloudZero](https://www.cloudzero.com/blog/gemini-pricing/) (16 Oct 2026)
- Model ka chunaav: production DLP aur assistant prompts par internal eval, 1 Oct 2026 (Mistral Small 4: text 40/40, images 14/14, assistant tools 8/8)
- Cloudflare R2: [egresscost](https://egresscost.com/cloudflare/), [mecanik](https://mecanik.dev/en/posts/cloudflare-r2-pricing-explained-real-costs-vs-s3-and-backblaze/)
- OCI Ampere A1 aur OKE: [Oracle](https://www.oracle.com/cloud/compute/arm/), [Oracle OKE pricing](https://www.oracle.com/cloud/cloud-native/kubernetes-engine/pricing/), [CloudZero](https://www.cloudzero.com/blog/oracle-cloud-pricing/)
- AWS RDS: [Vantage](https://instances.vantage.sh/aws/rds/db.r7g.2xlarge), [AWS](https://aws.amazon.com/rds/pricing/)

**Andar se naapa gaya data**
- Production host spec, containers ka size, database size: 1 Oct 2026 ko production server par padha.
- Events, screenshots aur AI assistant ka volume: 1 Oct 2026 ko production database par read-only queries se.
- Agent intervals aur DLP AI limits: `services/endpoint-agent/src/background.rs`, `services/dlp-service-rust/src/ai.rs`.

*Jahan vendors price publish nahi karte, wahan competitor numbers anumaan hain aur* est. *likha hai. Kisi customer ko competitor ka price batane se pehle dobara check karein.*
