# Requirement Audit & Plan — Simple Hinglish Version

Ye file `REQUIREMENT_AUDIT_AND_PLAN.md` ka simple Hinglish summary hai — same
report, lekin easy language me taaki jaldi samajh aa jaye.

**Connector ka latest version: `2.6.0`** (Python wala) — ye already production
me live ho chuka hai, GitHub Actions run se verify kiya hua. Isi run me Rust
wale connector ke packages bhi ban gaye (macOS, Windows, Linux teeno), lekin
wo abhi sirf testing ke liye hain, production me nahi gaye hain.

---

## Part 1 — Aapke 8 sawaalon ka jawab (kya kaam kar raha hai)

| # | Requirement | Status |
|---|---|---|
| 1 | Web Gateway chatgpt.com/claude.ai ko block kare, company ka apna block page dikhaye | ✅ Kaam kar raha hai |
| 2 | Har site ki deep security check, unsafe site block ho | ✅ Kaam kar raha hai |
| 3 | Policy app level pe bhi apply ho, block page/instruction dikhe | ✅ Kaam kar raha hai |
| 4 | Har installed app ka log ho, company use block kar sake | ✅ Kaam kar raha hai |
| 5 | Download scan ho, reason dikhe; badi file ke liye sandbox | ⚠️ Scanning to ho rahi hai, lekin **sandbox abhi adhura hai** (behavior-analysis nahi hoti) |
| 6 | Company laptop = 24/7 screenshot, Personal laptop = Disconnect ka option | ✅ Kaam kar raha hai |
| 7 | DLP sirf **log** kare, block na kare | ✅ Kaam kar raha hai |
| 8 | Saare activity logs ek hi Activity tab me dikhein | ✅ Kaam kar raha hai |

**Iske alawa jo dekha:**
- Database sahi hai — naye features (installed apps list, screenshot ke sath open apps) ke liye zaroori tables bhi ban gayi hain, aur naye orgs ke liye screenshot capture by-default ON hai.
- Threat-intel me hazaaron domains ka data hai jisse dangerous sites pakde jaate hain.
- Sidebar bilkul waisa hi hai jaisa aapne bataya tha — extra tabs (Global Policies, SSL Inspection, Shadow IT, CASB) hata diye gaye hain.
- Sare tests pass ho rahe hain (Go, Python — 146/146).

**Ek asli adhuri cheez:** Malware scan me "sandbox" (yaani file ko chala ke dekhna ki wo kya karti hai) abhi bas ek flag set karta hai, actual behavior check nahi karta — iske liye ek alag heavy server (CAPE/Cuckoo) chahiye, jo abhi setup nahi hai. Ye ek infrastructure decision hai, code likhne ki baat nahi.

---

## Part 2 — Is session me jo bugs mile (testing karte waqt, sirf code padhne se nahi)

### 2.1 Image ka Content-Type machine ke hisaab se badal jaata tha — **Fixed**
Jab bhi koi icon store hota tha, uska "type" (jaise ye PNG hai ya ICO hai) alag-alag machine pe alag tarike se decide ho raha tha — kyunki code us machine ki system settings pe depend kar raha tha. Isse ek machine pe icon sahi dikhta, dusri pe kharab. Fix kiya: ab ek fixed list se decide hota hai, machine se koi farak nahi padta.

### 2.2 "Allowed" (yaani normal, allowed traffic) wale logs 3 jagah abhi bhi dikh rahe the — **Fixed**
Requirement clear thi: allowed traffic kahi bhi dikhna nahi chahiye, store bhi nahi hona chahiye. Pichli baar zyada jagah se hata diya gaya tha, lekin 3 jagah reh gayi thi (employee portal ka stats, reports ka daily graph). Wahan se bhi hata diya — ab "allowed" count hamesha sahi (0, kyunki store hi nahi hota) dikhega, jhoota number nahi.

### 2.3 Release wala automation kabhi bhi purana version publish kar sakta tha — **Fixed**
GitHub ka release-wala script agar koi version number bhoole se na de, to wo apne aap purana version (1.1.0) publish kar deta — jabki asal me naya version (2.5.0/2.6.0) live tha. Isse naye employees ko purana, kharab installer milta. Ab isko fix kar diya hai — version ek hi jagah se decide hota hai, aur galti se purana publish hona ab possible nahi.

---

## Part 3 — Client Connector: Python ya Rust? (bada decision)

**Final decision: Rust** — poora connector ek hi Rust binary me.

**Kyun Rust:**
1. Ye product ka sabse security-critical hissa hai — ye TLS certificates handle karta hai, company ka private key rakhta hai, aur har employee ke laptop pe elevated permission ke sath chalta hai. Yahan agar memory-safety ka koi bug ho to poori company ke saare laptops pe hacking ka khatra ban sakta hai. Rust me ye bug-class hi possible nahi hoti (Python me possible hai).
2. Company already DLP aur Malware scanning services Rust me chala rahi hai — connector ko bhi Rust me le jaane se sab security-critical parts ek hi language me aa jaate hain.
3. Scale ka matlab yahan "server ki speed" nahi, balki "har employee ke laptop pe kitna CPU/battery use hota hai" hai — Python wala connector thread-heavy hai, jisse laptop garam/slow ho sakta hai. Rust bohot kam resource use karta hai.
4. Go bhi ek option tha, lekin usme Rust jaisi memory-safety guarantee nahi milti — aur ye exact wahi jagah hai jahan wo guarantee sabse zyada matter karti hai.

**Installer, UI, background service** — sab kuch same tarike se banega, bas andar ka binary Python se Rust ho jayega. Windows .msi, macOS .pkg, Linux .deb — sab same tools se banenge.

**UI native banaya hai (webview nahi)** — kyunki webview use karne se teen alag-alag rendering engines (Windows, Mac, Linux ke liye alag-alag) manage karne padte, aur Linux pe zaroori software har machine pe pehle se ho, ye guarantee nahi thi. Native UI (egui) har jagah same tarike se chalta hai, koi extra software install karne ki zaroorat nahi.

**Rust connector abhi kahan tak pahucha:** Saare features complete ho chuke hain — proxy, DLP, malware scan, screenshots, activity monitoring, app control, auto-update, uninstall flow, sab kuch. 119+ tests pass, real machine pe bhi test kiya. Sirf packaging (installer banane ka kaam) baaki tha jo is session me complete ho gaya (neeche dekhein).

---

## Part 4 — Plan (phase by phase) aur ab tak kya hua

### Phase 1 — "Allowed" traffic kahi bhi na dikhe ✅ Complete
Server aur employee portal dono jagah se allowed traffic hata diya, purane allowed records bhi database se saaf kar diye.

### Phase 2 — Rust connector: Monitoring (screenshot, activity) ✅ Complete
Screenshot capture, keyboard/mouse activity counting, posture check (jaise disk encryption on hai ya nahi), open apps ki list — sab Rust me bana diya. Real Linux machine pe test kiya (Xvfb ke through) — asli screenshot li, asli input detect kiya.

**Ek real bug mila:** Jab device pehle se enrolled ho (yaani connect ho chuka ho) aur laptop offline boot ho (internet abhi connect nahi hua), to window hamesha "Not connected" dikhata reh jaata tha — jabki asal me connected hi tha. Fix kiya, aur real test karke confirm kiya ki ab sahi "Protected" dikhta hai.

### Phase 3 — Rust connector: Auto-update, Lock, Uninstall ✅ Complete
- **Auto-update**: connector khud check karega ki naya version aaya hai ya nahi, aur khud update ho jayega.
- **Single-instance lock**: agar galti se 2 baar connector start ho jaye (jaisa real Mac pe hota hai kabhi-kabhi), to dusra copy khud band ho jayega, pehla wala chalta rahega. Do real copies chala ke test kiya — sahi kaam kiya.
- **Uninstall flow**: Ab connector me ek option hai jahan company ka admin apna email-password de ke connector ko remove kar sakta hai. Real server ke against test kiya — galat password reject hua, sahi password se remove ho gaya.

**Isi kaam me 2 aur bade gaps mile jo pehle kabhi kaam hi nahi kar rahe the:**
1. Managed install ke liye jo special "token" hota hai (jisse company khud-ba-khud employee ke laptop ko enroll kar deti hai bina employee ko kuch click kiye) — wo feature code me likha to tha, lekin kabhi actually use hi nahi ho raha tha! Fix kiya.
2. "Uninstall allowed hai ya nahi" — ye jaankari server kabhi bheja hi nahi raha tha (sirf ek comment tha jo kehta tha "ye bhejna chahiye", lekin code nahi tha). Fix kiya.

### Phase 4 — Rust connector ki Packaging (installer banana) ✅ Complete
- **macOS**: real Mac pe `.pkg` installer banaya, uske andar dekha (sab sahi tha), aur binary ko chala ke confirm kiya ki chalta hai.
- **Linux**: real `.deb` installer banaya. Ek fresh/clean Linux machine pe install karke test kiya — **ek real bug mila**: installer me zaroori "dependencies" (yaani connector ko chalane ke liye jo aur software chahiye) ki list nahi thi, isliye clean machine pe install hone ke baad connector chalta hi nahi tha! Fix kiya — ab ek tool automatically sahi list bana deta hai. Dobara test kiya — ab sab sahi chal raha hai.
- **Windows**: script likh di gayi thi lekin humare paas Windows machine nahi thi test karne ke liye. **Aapke bolne pe** ki "Windows ko bhi same tarike se treat karo", maine GitHub ke real Windows computer (cloud pe) pe ise actually chala ke test kiya. **Do real bugs mile:**
  - Ek PowerShell (Windows ki scripting language) ka purana version file ko sahi se padh nahi pa raha tha.
  - Linux wale installer me bhi ek library-version ka mismatch mila (Ubuntu ka purana version).
  Dono fix kiye, dobara test kiya — **ab sab 9 automated checks pass ho rahe hain**, including pehli baar Windows pe successful build.

### Phase 5 — Naya version 2.6.0 Release karna ✅ Complete
Release automation ka bug fix karne ke baad, real me `2.6.0` version release kiya. Production server pe confirm kiya ki teeno (macOS, Windows, Linux) installer sahi se upload ho gaye — logs me dekh ke confirm kiya, sirf assume nahi kiya.

### Phase 6 — Rust ko main/default connector banana (Cutover) ⏳ Baaki
Ye last step hai — jab tak nahi hoga tab tak Python wala connector hi employees ko milta rahega.

Ab tak jo hua: Rust connector macOS pe real hardware pe poori tarah test ho chuka hai (chal ke, enroll karke, window dikha ke). Windows pe bhi ab build successfully ho raha hai real Windows machine pe — lekin sirf "build hona" alag baat hai aur "window sahi dikhna, tray icon sahi dikhna, permission popups sahi kaam karna" alag baat hai — ye doosri wali cheez sirf ek insaan real screen dekh ke hi confirm kar sakta hai, automated testing se nahi. Isliye jab tak koi real Windows machine pe khud install karke, click karke dekh na le, tab tak Rust ko default nahi banaya jayega.

**Sandbox wala kaam** (bade files ka behavior-analysis) scope se bahar rakha hai — usko ek alag heavy infrastructure chahiye (CAPE/Cuckoo cluster), jo ek separate decision hai.

---

## Part 5 — Overall Status (ek nazar me)

| Phase | Status |
|---|---|
| 1 — Allowed traffic hata dena | ✅ Complete |
| 2 — Rust: Screenshot/Activity monitoring | ✅ Complete |
| 3 — Rust: Auto-update/Lock/Uninstall | ✅ Complete |
| 4 — Rust: Installer banana (3 platforms) | ✅ Complete |
| 5 — Naya version 2.6.0 release | ✅ Complete, production me live |
| 6 — Rust ko default connector banana | ⏳ Sirf real-machine pe click-through testing baaki (khaaskar Windows) |

---

## Part 6 — Kaunsa feature kis language me bana hai

### Backend services

| Service | Language | Kya karta hai |
|---|---|---|
| `admin-api` | **Go** | Control panel — dono dashboards aur portal ka backend, database, login, sab reports |
| `dlp-service` | **Rust** | Sensitive data (jaise company ke tokens, documents) detect karta hai |
| `malware-service` | **Rust** | Downloaded files ko virus/malware ke liye check karta hai |
| `extract-service` | **Python** | Documents/images ke andar se text nikalta hai (OCR) |
| `ai-service` | **Python** | AI Assistant tab ka backend |
| `casb-service` | **Python** | Cloud apps ki policy checks |
| `threatintel-service` | **Go** | Dangerous domains ki list maintain karta hai |
| `posture-service` | **Go** | Device ki security-health score karta hai |
| `shadowit-service` | **Go** | Employee kaunse unauthorized apps use kar raha hai, wo detect karta hai |

### Frontend (sab dashboards)
Company Dashboard, Employee Portal, Superadmin, Docs — sab **TypeScript/Next.js** (React) me bane hain.

### Client Connector (sabse important, do languages me hai abhi)
- **Python** — abhi ye hi employees ke laptop pe install hota hai (yehi asli/live version hai).
- **Rust** — sab features Python jaisa hi complete ho chuke hain, teeno platform (Mac/Windows/Linux) pe installer bhi ban chuka hai aur test ho chuka hai. Bas Windows pe real insaan se click-through test hona baaki hai, uske baad ye Python ki jagah le lega.

**Kyun ye split hai:**
- **Go** — jahan database/control-panel ka kaam hai (speed itni matter nahi karti)
- **Rust** — jahan security sabse zyada matter karti hai, ya laptop pe kam resource use karna zaroori hai
- **Python** — jahan uske ready-made tools (jaise OCR) ka fayda milta hai
- **TypeScript** — sab dashboards/websites ke liye

---

*Ye simple Hinglish summary hai. Poori technical detail (exact commit messages, code snippets, test counts) ke liye `REQUIREMENT_AUDIT_AND_PLAN.md` dekhein.*
