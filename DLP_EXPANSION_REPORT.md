# DLP Overhaul — LLM Classification, Real File Extraction, No Size Limit

**Branch:** `dlp-llm-overhaul`
**Date:** 2 September 2026
**Plan:** `/home/ubuntu/.claude/plans/swift-painting-kettle.md`

Ye report batati hai ki 4 tasks pe **actually kya implement + test hua**, kya verify hua, aur kya honestly pending/deferred hai — bina overstate kiye.

---

## Background — kyun ye kaam dobara hua

Deep DLP inspection ka poora feature pehle commit `4bbdc01` me bana tha (extract-service + OCR + vision-AI, 270+ tests) aur agle din `46e5719` me revert ho gaya. Is round me wo kaam **restore karke adapt** kiya gaya (revert-of-revert, zero conflict kyunki revert hi HEAD tha), phir user ke 4 naye asks layer kiye:

1. Purana Python `dlp-service` delete
2. Detection ke liye **LLM classifier** (OpenRouter), regex sirf wahan jahan wo genuinely behtar hai
3. Har file-type ka content actually scan ho (PDF/OCR/Office/archives/images/audio-video), LLM se scan + scoring, bade files ke liye sandbox
4. **20 MB size limit poora hataana**

---

## Task 1 — Python `dlp-service` hata diya

- `git rm -r services/dlp-service` (10 files). Rust `dlp-service-rust` hi production me chal raha tha; koi code isse import nahi karta tha.
- `.github/workflows/ci.yml`: `python-test` matrix se `dlp-service` nikaala, `extract-service` add kiya.
- `docker-compose.yml`: `dlp-service` build context pehle se `./services/dlp-service-rust` tha — sirf "swap back to Python" wala stale comment update kiya.

---

## Task 2 — Detection ab hybrid hai: checksum tier + LLM tier

### Routing (content-class ke hisaab se)

| Content | Detection | Kyun |
|---|---|---|
| Structured IDs (credit card, Aadhaar, PAN, AWS/GitHub/API keys) | **Regex + checksum** (`dlp-service-rust`), hamesha, instant, free | Luhn/Verhoeff/entropy gates → almost zero false positive; LLM "ye 16-digit Luhn-valid hai kya" me kamzor hai |
| Document/prose text (DOCX/XLSX/PPTX/PDF/CSV/JSON/email body se nikla text) | **LLM text classifier** (`ai-service` → OpenRouter) → `{sensitive, categories[], confidence, evidence}`; detector `ai_text` | Salary sheet, contract, customer PII list, board-deck financials — inka koi pattern nahi |
| Images / screenshots / photographed docs | **Vision LLM** (OpenRouter) + Tesseract OCR text → tiers upar; detector `ai_visual` | Restored `vision.py`, kie.ai → OpenRouter |
| Scanned PDF | OCR → tier-1 + `ai_text`; page image → `ai_visual` | extract-service pehle se karta hai |
| ZIP/TAR/GZ/7z, OOXML, `.eml`, multipart | Recursive extraction; har inner part apne type se re-route | `engine.dispatch` recursion |
| Audio / video | Transcribe (`/v1/dlp/transcribe`, Gemini audio via OpenRouter) → tier-1 + `ai_text`; transcript na mile → `unscannable` record; > `DLP_AUDIO_MAX_BYTES` (24 MiB) → `media_too_large` unscannable | OpenRouter pe dedicated STT nahi hai; Gemini flash inline audio leta hai |

### Scoring — ek hi jagah

LLM ka verdict alag decision path nahi banata. `ai-service` ek `confidence` (0–100) deta hai jo `dlp-service-rust` me policy ke us detector ka weight scale karta hai (`external_matches` mechanism, `4bbdc01` se). Matlab block/alert/allow banding wahi single weighted 0–100 aggregate se aati hai — regex hit + LLM hit ek saath combine hote hain, jaise do regex detectors.

Naye detector names: `ai_text` (default weight 70), `ai_visual` (75, pehle se), `ai_audio` (60). Built-in "Automatic DLP" policy me teeno **on by default** — matlab zero setup pe semantic detection milta hai (bas `AI_SERVICE_URL` set ho).

### Cost / latency control (`vision.py` se generalize kiya)

- **Tier-1 pehle**: agar checksum/regex ne already `block` diya, LLM call hoti hi nahi.
- **sha256(content)+model+prompt-version Redis cache**: same boilerplate contract clause / template screenshot org-wide sirf ek baar classify hota hai. *(e2e me verify: doosri identical call `cached:true`, koi LLM call nahi.)*
- **Per-org daily budget cap** (`DLP_TEXT_DAILY_CAP` etc): cap cross hone pe tier-1-only pe degrade, unbounded bill nahi.
- **Policy-gated**: `ai_text`/`ai_visual`/`ai_audio` detector policy me enable na ho → koi LLM call nahi.
- **Fail-safe**: provider error / unparseable output / Redis down → "not sensitive", kabhi crash/DLP-down nahi.

### OpenRouter integration

`services/ai-service/app/llm/providers.py` me `openrouter` provider add (`https://openrouter.ai/api/v1`, OpenAI-compatible, `OPENROUTER_API_KEY` from `.env`). `LLM_PROVIDER_CHAIN=openrouter,kie_ai` — kie.ai fallback pe. `vision.py` ab OpenAI-style `image_url` path use karta hai (kie.ai ka Claude-native branch legacy).

Defaults (env se swap): text `google/gemini-2.5-flash-lite`, vision `google/gemini-2.5-flash`, audio `google/gemini-2.5-flash`.

---

## Task 3 — File extraction actually kaam karta hai

`extract-service` (Python/FastAPI) restore hua — CSV/JSON/DOCX/XLSX/PPTX/PDF/ZIP/TAR/GZ/7z/RTF/legacy-Office/`.eml`/multipart ko real text segments me kholta hai, recursively (archive-in-archive-in-docx bhi). admin-api NDJSON stream karke har segment aate hi scan karta hai, `block` pe extract-service ko bhi rok deta hai (early exit).

Har segment ab **do tier** se guzarta hai (`scanDLPSegmentWindowed`): pehle checksum/regex, phir — agar block nahi hua aur `ai_text` enabled hai — `aiclient.ClassifyText`.

Audio/video ke liye naya `scanDLPMediaVerdict`: transcribe → transcript ko normal text pipeline + `ai_audio` external match.

### Sandbox — "both" (jo recommend kiya tha)

**1. Isolated parser container** (`docker-compose.yml`, `extract-service`): non-root, `read_only` rootfs, `cap_drop: ALL`, `no-new-privileges`, `pids: 512`, `mem: 2g`, tmpfs scratch `mode 01777` (yehi wo bug tha jo `4bbdc01` me OCR silently tod raha tha — carry-forward), no outbound egress needed. `defusedxml` + zip-slip guards. Untrusted files yahin parse hote hain.

**2. Async deep-scan queue** — **deferred** (neeche "Honest deferrals" me). Inline windowed path already kisi bhi size ko handle karta hai; oversized media `unscannable` se clean handle hota hai. Full async queue (durable job store + worker + retro-incident) ke liye live stack test chahiye jo abhi LLM-credit constraint me nahi kiya.

---

## Task 4 — Size limit poora hataya

| Jagah | Pehle | Ab |
|---|---|---|
| `dlp-service-rust` `DLP_MAX_SCAN_SIZE` | 20 MB → HTTP 413 | Default **unlimited** (`usize::MAX`); `0`/unset = unlimited; non-zero sirf optional defensive cap. *(e2e: 30 MB body scan hua, koi 413 nahi.)* |
| admin-api `scanstream.go` | 4 MB windows, no hard cap | Same — har size ko 4 MB overlapping windows (64 KB carry) me walk karta hai, block-is-terminal. Extracted segments bhi same windowing. |
| `dlp/scanner.go` `MaxScanSize` const | naam "cap" jaisa lagta tha | Windowing ke aage koi user-facing cap nahi (comment already clarifies). |
| Python agent | pehle se no cap (SpooledTemporaryFile + size-scaled deadline) | Unchanged — koi 20 MB agent-limit tha hi nahi (mera pehla report galti se **abandoned Rust `endpoint-agent`** padh ke likha tha). |
| extract-service | — | Size cap nahi; sirf depth(5) / entries(10k) / expansion-ratio(200x) / wall-clock deadline safety bounds. Inme se koi hit ho → `unscannable` record, silent skip nahi. |

Bade files ke liye chunking pehle se hai (admin-api windowing). Chhote files single-shot.

---

## Testing

| Component | Tests | Result |
|---|---|---|
| `dlp-service-rust` | 67 (52 unit + 15 API) | ✅ pass (3 naye `ai_text`/`ai_audio` scoring tests) |
| `ai-service` | 75 | ✅ pass (14 naye `test_text_classify.py`, 3 `test_transcribe.py` — sab mocked, no real LLM) |
| `extract-service` | 40 | ✅ pass |
| `admin-api` (handlers, aiclient, dlpclient) | full | ✅ pass + `go vet` clean (`go build ./...` clean) |
| Python agent | 123 | ✅ pass |

### End-to-end (live Docker stack, `scripts/dlp_e2e.sh`)

Deliberately **sirf 1 real OpenRouter call** (credit constraint) — baaki free:

| Case | Result |
|---|---|
| dlp-service: Luhn-valid card in plain text (regex tier, no LLM) | ✅ matched, alert band |
| dlp-service: `ai_text` external match confidence 100 → score 70 | ✅ |
| dlp-service: **30 MB body** — card near end found, **no 413** | ✅ scanned, alert |
| extract-service: ZIP → inner `salary.csv` + `secrets.env` as segments | ✅ recursive, 2 segments |
| ai-service `/v1/dlp/classify-text`: real salary sheet → **1 real OpenRouter call** | ✅ `sensitive:true, categories:[salary_data, employee_pii], confidence:100`, evidence me koi actual value leak nahi |
| ai-service: same text again → `cached:true`, **no LLM call** | ✅ cache works |

4 changed images (`dlp-service`, `extract-service`, `ai-service`, `admin-api`) build hue, stack me deploy hue, sab healthy. ai-service `/health` pe `openrouter` provider `available:true`.

---

## Honest deferrals

| Item | Status | Kyun |
|---|---|---|
| **Async deep-scan queue** (bade files async, retro-incident + quarantine) | ❌ Not built | Inline windowed path har size handle karta hai; oversized media `unscannable` se clean. Durable queue + worker + incident path ko live-stack + LLM e2e chahiye jo credit-constraint me abhi nahi. Design plan file me hai — chhota follow-up. |
| Audio/video transcription real-world verify | ⚠️ Wired, mocked-tested only | Gemini-via-OpenRouter inline `input_audio` accept karta hai ye docs pe based hai; real audio se verify karne me LLM cost lagta. Na chale to A/V `unscannable` (policy-controlled) pe degrade — DLP tootega nahi. |
| Vision (`classify-image`) real-world verify with OpenRouter | ⚠️ Wired, mocked-tested only | Text classify wali hi machinery; ek aur real call save karne ke liye skip. Model `google/gemini-2.5-flash` set hai. |
| `on_unscannable` per-reason full UI | ⚠️ Simplified (single checkbox) | Backend fully supports; UI `4bbdc01` jaisa hi. |
| RAR archives | ❌ | Non-free `unrar` — clean "unsupported_archive" report deta hai. |
| Frontend `tsc --noEmit` re-verify | ⏳ Not re-run this round | Frontend files `4bbdc01` se restore, is round unchanged. |

---

## Latency / cost note (honest)

Jo upload LLM tier tak pahunchega usme OpenRouter round-trip (~1–8 s) add hota hai. Mitigations: tier-1 pehle (structured IDs pe koi LLM call nahi), sha256 cache (repeat content free), per-org daily cap, policy-gating. Lekin **pehli baar dekha gaya sensitive `.docx` aaj se slow** hoga. Yeh accept kiya gaya ("quality boht achi chaiye").

---

## Deploy checklist

`.env` / `.env.example` me naye vars (already added):
```
OPENROUTER_API_KEY=...            # .env me already hai
LLM_PROVIDER_CHAIN=openrouter,kie_ai
DLP_TEXT_MODEL=google/gemini-2.5-flash-lite
DLP_VISION_MODEL=google/gemini-2.5-flash
DLP_AUDIO_MODEL=google/gemini-2.5-flash
DLP_*_DAILY_CAP / DLP_*_CACHE_TTL_SECONDS
DLP_AUDIO_MAX_BYTES=25165824
EXTRACT_SERVICE_URL / EXTRACT_SERVICE_SECRET
AI_SERVICE_URL / AI_SERVICE_INTERNAL_SECRET
```
`docker compose up -d --build` — `extract-service` naya service, koi DB migration nahi (`Policy.Rules` jsonb reuse). Production me `*_SECRET` placeholders ko real random values se replace karo.
