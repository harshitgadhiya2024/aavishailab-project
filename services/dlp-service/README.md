# dlp-service — Data Loss Prevention scoring microservice

Stateless content-scanning service. Given a piece of outbound content (an
upload / form-post / MITM-decrypted HTTPS body) plus the org's DLP policy
config, it returns a **0–100 sensitivity score** and a decision **band**:

- score **≥ block threshold** (default 80) → `block`
- score **≥ alert threshold** (default 50) → `alert` (allowed but flagged)
- below that → `allow`

It holds no database and persists nothing — `admin-api` owns event logging and
the agent contract; this service is pure compute you can run N replicas of.

## Why a separate service
- The weighted scoring / detector work is CPU-bound and independent of the DB —
  ideal to scale horizontally behind a load balancer.
- Keeps the scanning logic (and any future ML classifier) isolated from the
  control plane.

## How it plugs in
```
agent ──(raw upload bytes)──▶ admin-api /internal/agent/scan-dlp
                                   │  builds policy envelope + HMAC token
                                   ▼
                          dlp-service /v1/scan  ──▶ {score, band, action, matches…}
                                   │
        admin-api logs ActivityEvent (score+band) ─▶ dashboard (live)
```
If `DLP_SERVICE_URL` is unset or the service is unreachable, admin-api falls
back to its in-process scanner (still enforces DLP, just without the 0–100
score) — fail-open, never blocking uploads on an outage.

## Security
- **Org-bound HMAC service token** (`Authorization: Bearer v1.<payload>.<sig>`),
  minted by admin-api, verified here; a token for org A can't scan for org B.
  Set `DLP_SERVICE_SECRET` to the same strong value on both services.
- Responses only ever contain **masked previews** (`••••••••4242`), never raw
  sensitive values.
- 20 MB size cap, runs as non-root in the container.

## Configuration (env)
| Var | Default | Meaning |
|-----|---------|---------|
| `DLP_SERVICE_SECRET` | insecure dev default | shared HMAC secret (match admin-api) |
| `DLP_REQUIRE_AUTH` | `true` | reject unsigned requests |
| `DLP_BLOCK_THRESHOLD` | `80` | default block band |
| `DLP_ALERT_THRESHOLD` | `50` | default alert band |
| `DLP_MAX_SCAN_SIZE` | `20971520` | max bytes to scan |

Per-org policies can override thresholds and per-detector weights.

## Run locally
```bash
python3.12 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
DLP_SERVICE_SECRET=dev-secret uvicorn app.main:app --port 6200
```

## Test
```bash
PYTHONPATH=. .venv/bin/python -m pytest      # 40 tests: detectors, scoring, API
```
The API tests exercise the full ASGI stack (routing, auth, validation) via
Starlette's TestClient — real HTTP semantics, not function calls.

## Endpoints
- `POST /v1/scan` — scan content (auth required). Body: `{org_id, filename,
  content_type, destination, content_b64 | text, policies[]}`.
- `GET /healthz`, `GET /metrics`.
