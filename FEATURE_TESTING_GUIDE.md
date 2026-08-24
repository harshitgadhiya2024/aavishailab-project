# Aavishield — Company Setup + Feature Testing Guide

Ye guide 2 hisso me he:
- **Part A** — Company account setup (register se lekar agent install tak)
- **Part B** — Har feature (SWG, DLP, Malware Scanning, Activity/Screenshot Monitoring, Shadow IT, CASB + App Control) ko kaise company-level pe setup karna he aur manually kaise test karna he

Agar aapko sirf onboarding wala pura detailed flow chahiye (employee invite, team, etc.) to `CUSTOMER_ONBOARDING_GUIDE.md` bhi dekh lena — ye guide feature setup + testing pe focused he.

**Testing ke liye zaroori cheez**: kam se kam ek employee ka device (Mac/Windows/Linux) real me agent install karke enrolled hona chahiye. Bina enrolled device ke SWG/DLP/Malware/Shadow-IT/CASB me se kuch bhi test nahi ho sakta — ye sab agent ke through traffic dekh ke kaam karte hain, dashboard se sirf policy banti he.

---

## Part A — Company Account Setup (quick version)

1. **Register**: Company Dashboard → Register page → company name, aapka naam, email, password.
2. **Email verify**: 6-digit code aayega, wo daalo. Verify hote hi Organization (14-day trial, 50 seats) + aapka Admin account dono create ho jaate he aur aap seedha dashboard me login ho jaate ho.
3. **Company Profile complete karo**: Dashboard → Profile — company name, industry, size, tax details (GSTIN/PAN/CIN), security contact, address. Profile-completeness % dikhta he.
4. **Team bana lo** (optional but recommended): Dashboard → Teams — policies aur access baad me team-wise scope kar sakte ho.
5. **Employee add karo**: Dashboard → Employees → Add Employee. Password automatically generate hoke employee ko email ho jaata he — kuch manually set nahi karna.
6. **Employee apna agent install kare**: Employee Portal (`aavishield-employee.aavishailab.com`) me login → Download Agent → apna OS choose kare → recommended installer download+run kare. Browser khud khulega aur device apne aap enroll ho jaayega (koi token copy-paste nahi karna).
7. **Confirm karo device enroll hua**: Company Dashboard → Devices (ya Reports → "Device & Agent Coverage") — employee ka device list me dikhna chahiye, status "online"/last-seen recent.

Jab tak step 6-7 complete na ho, Part B ka koi bhi test nahi chalega.

---

## Part B — Feature Setup + Manual Testing

### 1. SWG (Secure Web Gateway) — Web Filtering

**Setup:**
1. Dashboard → **Web Gateway** — yaha domain-level allow/block rules bana sakte ho (ek specific website).
2. Dashboard → **Policy Categories** — chahe to poori category block karo (jaise "File Sharing", "Adult Content", "AI Tools") instead of ek-ek domain likhne ke.
3. Dashboard → **SSL Inspection** — isko ON karo. Bina isske sirf plain HTTP traffic dikhta he, aur aajkal 95%+ traffic HTTPS pe hota he — SWG properly kaam nahi karega bina isske.
4. Dashboard → **Policies** → New Policy → Type = website/network blocking → Condition me Domain ya Category select karo → Scope decide karo (whole org / specific team / specific employee).

**Manual Test:**
1. Ek aisa domain/category block karo jo aapke test device pe genuinely visit ho sakta ho (e.g. block "facebook.com" ya "File Sharing" category).
2. Enrolled device ke browser se wo site kholne ki try karo.
3. **Expected**: block page dikhna chahiye, site khulni nahi chahiye.
4. Dashboard → Web Gateway page pe khud "ad-hoc URL check" tool bhi he — waha domain daal ke turant confirm kar sakte ho ki "abhi ye block hoga ya nahi" bina real browsing kiye.
5. Verify karne ke liye: Dashboard → Reports → **"Security Incidents"** report — blocked event employee/domain/policy ke saath dikhna chahiye.

---

### 2. DLP (Data Loss Prevention)

**Setup:**
1. SSL Inspection ON hona chahiye (SWG wala step 3 — DLP bhi HTTPS traffic pe hi kaam karta he).
2. Dashboard → **DLP** page — konse detectors chahiye wo select karo (Credit Card, AWS Key, GitHub Token, PAN, Aadhaar, custom keyword/regex patterns).
3. Dashboard → **Policies** → New Policy → Type = DLP → detectors/conditions attach karo → scope set karo.

**Test karne se pehle — safe dry-run:**
DLP page pe hi ek **"test a sample"** tool hota he — koi bhi text paste karo, wo kitna score karega dikh jaayega, **bina kisi real enforcement/logging ke**. Policy live karne se pehle isse tune kar lo.

**Real Manual Test (live traffic pe):**
Neeche diye gaye **fake/test values** use karo — ye sab industry-standard "safe test data" he, real card/key nahi:

| Detector | Test value (safe, fake) |
|---|---|
| Credit Card | `4111 1111 1111 1111` |
| AWS Access Key | `AKIAIOSFODNN7EXAMPLE` (AWS ka apna official example key) |
| GitHub Token | `ghp_` + koi bhi random 36+ alphanumeric characters |
| PAN (India) | `ABCDE1234F` (format-valid, real nahi) |

1. Enrolled device se, kisi bhi website ke text-box/form me upar wali koi ek value paste karke submit karo (ya ek `.txt` file me daal ke upload try karo kisi site pe).
2. **Expected**: policy ke hisab se block ho jaana chahiye ya alert log hona chahiye.
3. Verify: Dashboard → Reports → **"Data Loss Prevention"** report — incident (detector, destination, action, score) dikhna chahiye.

---

### 3. Malware Scanning

Ye feature ke liye **koi alag setup page nahi he** — ye baseline protection ka hissa he, jo agent install hote hi automatically ON rehta he (yahan tak ki jab employee "personal/paused" mode me ho tab bhi machine-protection wala hissa — malware scanning — active rehta he, sirf monitoring/DLP-jaisi cheezein pause hoti he).

**Setup:**
- Bas SSL Inspection ON hona chahiye taaki HTTPS downloads bhi visible ho aur scan ho sakein.

**Manual Test — EICAR test file (industry standard, 100% safe):**
1. Enrolled device ke browser se **EICAR test file** download karo — ye ek standard, universally-recognized "fake virus" test string he jise har antivirus/scanner detect karta he, real malware nahi he. Aap [eicar.org](https://www.eicar.org) se official test file le sakte ho, ya khud ek `.txt` file me ye exact line save karke usko kisi web server pe daal ke download try kar sakte ho:
   ```
   X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*
   ```
2. **Expected**: download block ho jaana chahiye, ek malware-block notice dikhna chahiye.
3. Verify: Dashboard → Reports → **"Threats & Malware"** report — detection event dikhna chahiye.

---

### 4. Activity & Screenshot Monitoring ("TeamLogger" wala feature)

**Setup:**
1. Dashboard → **Screenshots** (ya "Monitoring & Screenshots") page — ye **off by default** he, agent install karne se automatically on nahi hota, khud enable karna padta he.
2. Settings jo control kar sakte ho:
   - **Enabled** — on/off
   - **Capture interval** — screenshot kab lega (default 60-420 sec ke beech random point pe, predictable nahi)
   - **Idle threshold** — kitne % se kam activity pe "idle" maana jaaye
   - **Blur** — sirf presence prove karega, readable screen content capture nahi karega (privacy-friendlier mode)
   - **Retention** — kitne din tak screenshots rakhne he (default 90, 0 = forever)

**Manual Test:**
1. Feature enable karo (Enabled = on).
2. Enrolled device pe employee normal kaam kare (mouse/keyboard use kare) kam se kam capture-interval jitni der (2-5 min safe he).
3. Dashboard → Screenshots page → employee select karo, aaj ki date select karo.
4. **Expected**: day ka activity timeline, session cards, aur thumbnail screenshots dikhne chahiye (click karke zoom bhi ho sakta he). Activity % bhi dikhega (keyboard/mouse/scroll se calculate hota he).

**Note**: Employee ko khud apne screenshots kahi nahi dikhte (employee portal me ye feature hi nahi he) — ye puri tarah admin-only visibility he.

---

### 5. Shadow IT Discovery

Ye feature **koi manual "setup" nahi maangta** — jaise hi employees enrolled devices se browsing karte he, unki traffic se hi ye automatically SaaS apps discover karta rehta he. Koi domain jiska sanction-decision nahi liya gaya, wo yaha dikhta he.

**Manual Test:**
1. Enrolled device se kisi naye SaaS-jaise domain pe jao jo pehle se sanctioned/blocked nahi he (e.g. koi naya tool try karo jo aapne pehle kabhi use nahi kiya).
2. Dashboard → **Shadow IT** page pe jao.
3. **Expected**: wo domain discover hoke list me aana chahiye, kitne users/events use kar rahe he wo count ke saath.
4. Us discovered app pe click karke **Sanction** (approve) ya **Unsanction** (risky mark) karo.
5. **Ye important he**: Sanction/Unsanction karna sirf ek label nahi he — ye turant ek real enforced domain rule bana deta he (wahi enforcement path jo Web Gateway se manually banaya gaya rule use karta he). Unsanction karne ke baad wapas us site pe jaake confirm karo ki ab block ho raha he.
6. Verify: Dashboard → Reports → **"Shadow IT & SaaS"** report.

---

### 6. CASB + Application Control

Ye do alag cheezein he but ek hi page-group me hain:

| | Kya control karta he |
|---|---|
| **Application Control** | Device pe konsa software/process chal sakta he (browsing nahi, actual installed app) |
| **CASB** | Sanctioned SaaS app (Google Drive, Slack, etc.) ke andar kya ho sakta he — upload/download/share |

**Application Control Setup + Test:**
1. Dashboard → **Applications** page → known apps ka catalog dikhega, yaha se apna rule bana sakte ho (allow/block by process name).
2. Ek test app ko block karo.
3. Enrolled device pe wo app launch karne ki koshish karo.
4. **Expected**: launch block ho jaana chahiye, aur wahi page pe ek "events feed" me ye attempt dikhna chahiye.

**CASB Setup + Test:**
1. Dashboard → **CASB** page → rule banao (e.g. "Google Drive me external share block karo"). Yaha jo rule aap banaoge wo built-in defaults se pehle evaluate hota he — matlab aapka rule hamesha priority pe rehta he.
2. Enrolled device se us sanctioned app ke andar wahi action try karo jo block kiya he (e.g. external share).
3. **Expected**: action block/alert hona chahiye policy ke hisab se.
4. Verify: Dashboard → Reports → **"Security Incidents"** ya specific CASB-related events yahi report me milenge.

---

## Sab report ek jagah — Reports page cheat-sheet

Dashboard → **Reports** pe ye sab available he, period select karke:

| Report | Kis feature ka result |
|---|---|
| Executive Summary | Overall security posture, sab features ka summary |
| Security Incidents | SWG + CASB blocks/alerts, employee+destination+policy ke saath |
| Data Loss Prevention | DLP detectors, destination, score |
| Threats & Malware | Malware detections + threat-intel blocks |
| Shadow IT & SaaS | Discovered apps, sanction status, risk |
| Employee Risk | Kis employee ke sabse zyada incidents he |
| Device & Agent Coverage | Kaun se devices enrolled he, kaun protected nahi he |
| Policy Effectiveness | Konsi policy actually fire ho rahi he, konsi kabhi nahi |
| Access Requests | Employee exception requests |

Har report CSV/JSON me export bhi ho sakta he.

---

## Known gaps (honest note)

- Employee ko apna company-code (org slug) kahi bhi dashboard UI me nahi dikhta — activation ke liye ye chahiye hota he, filhaal Support se manually lena padta he.
- Malware scanning ka koi alag "on/off" setting nahi he dashboard me dikhane ke liye — ye implicit/always-on he, jo kabhi kabhi confusing lag sakta he agar aap explicitly usko "configure" karne ki jagah dhundh rahe ho.
- CASB/Application Control ke liye koi "test simulator" nahi he DLP jaisa — real device pe real action karke hi test ho sakta he.
