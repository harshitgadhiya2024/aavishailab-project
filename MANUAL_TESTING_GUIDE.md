# Manual Testing Guide — Company Owner & Employee

How to verify every feature by hand, in two roles: **Company Owner** (dashboard)
and **Employee** (enrolled device). Follow top to bottom.

---

## 0. Start everything

```bash
cd /Users/harshitgadhiya/Pictures/delsecure
cp .env.example .env            # (already has dev secrets filled in)
docker compose up -d            # brings up admin-api + all 6 microservices + DB/Redis/ClamAV
docker compose ps               # every service should be "healthy"/"running"
```

Quick health check of the new services:
```bash
for p in 6200 6210 6220 6230 6240 6250; do
  echo -n "port $p: "; curl -s http://localhost:$p/healthz || echo "(down)"; echo
done
```

**Verify the code/tests without Docker** (fast): `./scripts/run-all-tests.sh` → *7 passed, 0 failed*.

Dashboards:
- Company Owner: http://localhost:1002
- Employee Portal: http://localhost:1003
- Superadmin: http://localhost:1001

---

## PART A — As the Company Owner (dashboard, http://localhost:1002)

### A1. Log in & create an employee
1. Register / log in, create a **team** and an **employee**, set the employee a
   portal password (Employees → ⋯ → Set portal password).

### A2. DLP (Feature 1)
1. **Policies → New → Data Loss Prevention.** Pick detectors (Credit Card, AWS
   Key…), drag the **Block/Alert sliders** (default 80/50), Save & enable.
2. **DLP page → "Test a sample":**
   - Paste `card 4242 4242 4242 4242` → expect **score 55, ALERT**.
   - Paste `secret AKIAIOSFODNN7EXAMPLE` → expect **score 85, BLOCK**.
   - Paste `hello team` → **allow**.
   - Confirm the preview is masked (`••••••••4242`) — the raw value must never show.

### A3. Malware (Feature 2) — see it after the employee test (A/B below), or:
- Malware incidents land in **Activity** (category `malware_detection`) with
  `score`, `band`, `verdict`, `sha256`.

### A4. Threat Intel (Feature 3)
```bash
# (owner token via the dashboard, or test the service directly)
curl -s "http://localhost:6220/healthz"   # shows indicator counts once feeds sync
```
- In the dashboard, a URL/threat check uses `/api/v1/swg/threat-lookup`. A domain
  on URLhaus → **block** with the feed source; a clean domain → **allow**.

### A5. Device Posture + GeoIP (Feature 4)
- After an employee device checks in (Part B), open **Devices** → the device shows
  a **posture score** and **country**. Toggle FileVault/Firewall off on the device
  → within ~60s it drops to warn/fail and an incident appears.

### A6. Shadow IT (Feature 5)
1. After the employee browses some SaaS sites (Part B), open **Shadow IT.**
2. Apps appear with **risk scores** and **user/request counts**.
3. Click **Block** on a risky app (e.g. WeTransfer) → a rule is created and the
   agent blocks it within ~10s. **Sanction** allows; **Reset** clears.

### A7. CASB (Feature 6) — **CASB page**
1. **Inline app-control tester:** category `file_transfer`, activity `upload`,
   sanctioned off → **BLOCK**; `cloud_storage` / `download` / sanctioned →
   **ALLOW**.
2. **Out-of-band scanner:** the sample inventory is prefilled — click **Scan
   shares** → `Salary 2026.xlsx (public)` and `NDA (external)` come back **HIGH**
   with remediation advice.

---

## PART B — As the Employee (enrolled device)

### B1. Install the connector
- **Quick (script):** Employee Portal → **Download** for your OS → run the
  installer → it registers the agent service + sets the system proxy + trusts
  the org CA.
- **Native (recommended):** install the signed **Delphic Secure Client
  Connector** (`.pkg`/`.exe` built via `services/endpoint-connector/`), which
  adds the **menu-bar/tray icon** (green shield = protected). See its README.

### B2. Web browsing rules
- Visit a site the owner blocked (or a category-blocked site) → you get the
  **branded block page**. Visit allowed sites → normal. (Owner sees each in
  **Activity**.)

### B3. Download protection / Malware (Feature 2)
- Download the **EICAR test file** (harmless industry-standard AV test) over
  HTTP, e.g. `curl http://<any-http-host>/eicar.com` through the proxy → the
  agent serves the **malware block page**; the owner sees **score 100 / block**.
- Download a normal PDF → passes. A macro `.docm` or an `.exe` renamed
  `invoice.pdf` → **alert** (allowed but flagged) at score ~50–55.

### B4. Upload protection / DLP (Feature 1)
- With **SSL Inspection** enabled for the org (Settings → SSL Inspection), try
  uploading text containing a credit card or AWS key to any site → a **block**
  score serves the block page; an **alert** score passes but appears in **DLP →
  Incidents** with its score/band.

### B5. Posture + Location (Feature 4)
- Just leave the agent running — each heartbeat reports posture + IP. The owner
  sees your device's **posture score** and **country** on the Devices page.
- Turn the host firewall or disk encryption **off** → your device's posture drops
  and the owner gets a posture incident.

### B6. Shadow IT (Feature 5)
- Browse a few SaaS apps (dropbox.com, chatgpt.com, wetransfer.com) → they show
  up on the owner's **Shadow IT** page with risk scores. If the owner **Blocks**
  one, you'll get the block page next time within ~10s.

### B7. The connector experience (Feature 7)
- Click the **menu-bar/tray shield**: it shows **Protected**, your device ID,
  last sync, and links to the portal / logs, plus **Pause / Resume**. Pause →
  icon turns grey and protection stops; Resume → back to green.

---

## Direct service checks (no dashboard needed)
Each service self-verifies with real HTTP calls in its test suite:
```bash
cd services/dlp-service     && PYTHONPATH=. .venv/bin/python -m pytest   # 40
cd services/malware-service && PYTHONPATH=. .venv/bin/python -m pytest   # 29
cd services/casb-service    && PYTHONPATH=. .venv/bin/python -m pytest   # 23
cd services/threatintel-service && go test ./...
cd services/posture-service     && go test ./...
cd services/shadowit-service    && go test ./...
```

## Expected-result cheat sheet
| Input | Feature | Expected |
|-------|---------|----------|
| `4242 4242 4242 4242` | DLP | score 55 → **alert** |
| `AKIAIOSFODNN7EXAMPLE` | DLP | score 85 → **block** |
| EICAR test file download | Malware | score 100 → **block** |
| `.exe` renamed `invoice.pdf` | Malware | ~55 → **alert** |
| URLhaus-listed domain | Threat intel | **block** |
| Firewall/encryption off | Posture | score drops → warn/**fail** incident |
| Browse dropbox/chatgpt | Shadow IT | discovered w/ risk score |
| Upload to file-transfer (unsanctioned) | CASB inline | **block** |
| `Salary.xlsx` shared public | CASB OOB | **HIGH** finding |
| Any wrong-org / expired token | All services | **401** |
