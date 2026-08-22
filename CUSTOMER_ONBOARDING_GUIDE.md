# Aavishield Setup Guide — Naye Company Owner Ke Liye

Ye guide bilkul us nazariye se likhi he jaise tum ek naye company owner ho aur apni company ke liye Aavishield (SWG + DLP + endpoint security platform) setup kar rahe ho — pehle account banane se lekar har employee ke device pe agent chalne tak. Har step actual product mein jo he wahi he, kahi bhi assume nahi kiya gaya.

Do tareeke se setup ho sakta he: **(A) Live SaaS pe sign up karo** (sabse aasan, recommended) ya **(B) khud apna infra pe self-host karo**. Zyada tar companies ke liye (A) hi sahi rasta he — (B) sirf tab jab tumhe apna khud ka server/data-residency chahiye ho.

---

## Part A — Live SaaS Pe Setup (Recommended)

### Step 1 — Account Banao

`https://aavishield-app.aavishailab.com/register` pe jao. Ye **poora self-serve** he — kisi superadmin ko tumhare liye pehle se kuch banane ki zaroorat nahi.

1. Company name, apna naam, email, password daalo.
2. Submit karte hi ek 6-digit code tumhare email pe aayega. **Abhi tak database mein kuch save nahi hua he** — jab tak email verify na ho, koi org ya account exist nahi karta (ye jaan-bujh kar he, taaki fake/unverified signups database mein na aaye).
3. Code daalo → verify hote hi tumhari **Organization** (trial plan, 14-din trial, 50 seats tak) aur tumhara **Admin account** ek saath ban jaate hain, aur tum seedhe dashboard mein land ho jaate ho — login alag se karne ki zaroorat nahi.

Agar code na aaye, "Resend" button he (45 second cooldown).

### Step 2 — Company Profile Complete Karo

Dashboard ke andar **Profile** (jo actually "Company Profile" he) pe jao aur ye fill karo:
- Company identity: legal name, industry, size, logo
- Registration/tax details: GSTIN, PAN, CIN (India-focused fields)
- Security contact: naam, email, phone (jisse security incidents pe contact ho sake)
- Address

**⚠️ Zaroori note**: Tumhari organization ka ek internal "slug" (company code) hota he jo employees ko portal pe register karte waqt chahiye hoga (Step 5 dekho) — lekin **abhi ye kahi UI mein dikhta nahi he**. Ye ek known gap he. Filhal jab tak product mein add nahi hota, ye company code Aavishield support se (Help → Support ticket bana ke) pucho, ya agar tumhe API access he to `GET /api/v1/organization` response ke `slug` field mein milega.

### Step 3 — Apni Team Invite Karo (Optional, Baad Mein Bhi Kar Sakte Ho)

Agar tumhare saath aur log dashboard access karenge (HR, IT admin, security analyst), **Team & Access** page se invite karo:
- Unka role choose karo (Org Admin / Manager / Analyst / Read Only)
- Password chhod sakte ho — system ek temporary password generate karega jo **sirf ek baar dikhega** (copy karke manually share karna padega — abhi emailed-invite-link nahi he, direct password share karna he).

### Step 4 — Employees Add Karo

**Employees** page pe jaake har employee ka record banao — naam, email, department. Ye ek-ek karke ya CSV import se ho sakta he (bulk ke liye CSV better he).

**Zaroori**: Ye sirf ek record banata he — employee ko abhi portal access nahi milta. Agla step (5) uske liye alag he.

### Step 5 — Employees Ko Employee Portal Pe Activate Karwao

Har employee ko `https://aavishield-employee.aavishailab.com/register` pe bhejo. Unhe daalna hoga:
- **Company Code** (Step 2 ka slug — abhi tumhe unhe manually batana hoga)
- Apna work email (Step 4 mein jo record banaya usi email se match hona chahiye)
- Apna khud ka password (portal-specific, dashboard password se alag)

Agar employee record pehle se nahi he (Step 4 skip kiya), to error milega "No employee record found — ask your IT administrator to add you first." Isliye sequence important he: **pehle admin employee add kare, phir employee khud activate kare.**

### Step 6 — Har Device Pe Agent Install Karwao

Employee login ke baad portal ke **Download** page pe jaake apna OS (macOS/Windows/Linux) choose kare. Wahan milega:
- Installer download link
- Ek one-time **enrollment code** (2 ghante valid)
- Ek ready-to-copy install command (unattended install ke liye bhi, IT/MDM deployment ke liye)

Install hone ke baad agent pehli baar chalte hi ek local setup page kholta he jo automatically device ko enroll kar deta he (employee ko sirf confirm karna hota he, agar wo portal mein already logged in he).

**Bulk/IT-managed rollout ke liye**: MSI/DEB/PKG installers unattended install support karte hain (env vars ya ek `enroll.json` drop-file se token pass kar sakte ho) — MDM (Intune/Jamf) se roll out karna chaho to yehi rasta he.

### Step 7 — Security Policies Configure Karo

Ab actual protection setup karne ka time. Dashboard mein ye sections hain:

| Section | Kya karta he |
|---|---|
| **Web Gateway (SWG)** | Domain-level block/allow rules, category-based blocking, threat-intel lookup |
| **Policy Categories** | Website categories manage karo (jo SWG rules use karti hain) |
| **DLP** | Sensitive data (jaise API keys, card numbers) upload/paste hone pe block/alert. "Test a sample" tool se tune kar sakte ho bina live enforce kiye |
| **Application Control** | Kaunsi software chal sakti he/nahi (sirf websites nahi, actual processes bhi) |
| **CASB** | SaaS app usage control (upload/download/share activities pe rules) |
| **Shadow IT** | Employees jo apps use kar rahe hain unka discovery — jo unsanctioned lage use "sanction" karke ek proper rule bana sakte ho |
| **SSL Inspection** | Agar HTTPS traffic pe bhi DLP/content inspection chahiye, to ye zaroor enable karo — bina iske sirf HTTP traffic inspect hoti he |
| **Policies** (general) | In sabko combine karke ek "policy" bana sakte ho, jo poori org, specific teams, ya specific employees pe apply ho |

**Suggestion**: SWG + DLP se shuru karo (sabse zyada common need), phir baaki add karte jao.

### Step 8 — MFA Enable Karo

**Settings → Two-factor** se apna khud ka authenticator app enable karo. Phir **Settings → Organization security** se poori org ke liye MFA **mandatory** bhi kar sakte ho — jo employee ke paas authenticator nahi he unke liye login pe emailed OTP fallback hota he.

### Step 9 — Working Hours Set Karo (Optional)

**Settings → Working hours** se decide karo policies kab enforce hon (jaise sirf office-hours mein, ya 24/7) — timezone bhi yahi set hota he.

### Step 10 — Help Chahiye To

Dashboard mein **Help → Support** se ticket raise kar sakte ho — koi bhi team member kar sakta he, kisi special permission ki zaroorat nahi.

---

## Part B — Self-Host Karna Ho To

Agar apna khud ka server/infra pe chalana chahte ho (data residency, compliance, ya customization ke liye):

1. Repo clone karo, `.env.example` ko `.env` mein copy karo.
2. `docker compose up -d` — sab kuch dev defaults ke saath already chal jaata he (Postgres/Redis/JWT secrets pehle se filled hain, sirf `change-this-...` comment ke sath — production mein zaroor badalna).
3. Local ports (default):

| Service | URL |
|---|---|
| Company Dashboard | `http://localhost:5002` |
| Superadmin | `http://localhost:5001` |
| Employee Portal | `http://localhost:5003` |
| Admin API | `http://localhost:7100` |

4. **Ye ek cheez production mein zaroor set karo**: `POLICY_SIGNING_KEY` — iske bina admin-api production mode mein start hi nahi hoga (security requirement, policy tampering rokne ke liye).
5. Optional cheezein jo tabhi chahiye jab wo specific feature use karna ho: Google/Apple social login credentials, Razorpay keys (billing), KIE.ai API key (AI Assistant), Cloudflare R2 (screenshot storage).

---

## Jaldi Reference — Poori Sequence Ek Nazar Mein

1. `register` → email verify → org + admin account ban gaya
2. Company Profile complete karo
3. (Optional) Team members invite karo
4. Employees add karo (individually/CSV)
5. Employees ko company-code + email se employee-portal pe activate karwao
6. Har employee apna OS ka agent install kare
7. SWG + DLP se policies shuru karo, phir App Control/CASB/Shadow IT add karo
8. MFA enable karo (khud ka + org-wide requirement)
9. Working hours set karo
10. Kabhi bhi help chahiye — Support ticket

---

## Abhi Ke Known Gaps (Honest Note)

Ye guide product ki actual current state ke against likhi gayi he — do cheezein abhi thodi manual hain:

1. **Company code (org slug) UI mein kahi nahi dikhta** — admin ko employees ko manually batana padta he, koi copy-paste button nahi he abhi.
2. **Admin dashboard se koi "generate enrollment link" button nahi he** — backend API already support karta he (24-ghante wala token), lekin UI wire nahi hua abhi. Filhal employee khud portal se apna 2-ghante wala enrollment code generate karta he.

In dono ko fix karna chhota-sa kaam he agar chaho to bata dena.
