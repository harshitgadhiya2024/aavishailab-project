# casb-service — Cloud Access Security Broker

Stateless Python service with the two CASB modes Zscaler describes.

## 1. Inline app-control (`POST /v1/app-control`)
Decides **allow / alert / block** for a SaaS *activity* (upload, download,
share, post, login) on an app, using the app's category / sanction status /
risk (as classified by shadowit-service). This is inline mode — it runs on
traffic the proxy already inspects, layering app-aware control on top of DLP +
threat. Conservative built-in defaults (block uploads to personal file-transfer
& unsanctioned apps, alert on AI-tool uploads/pastes); an org supplies its own
ordered rules that take precedence.

## 2. Out-of-band analysis (`POST /v1/oob/analyze`)
Scans a **cloud file inventory** for risky data-at-rest sharing — public links,
external shares of sensitive documents, org-wide sensitive files — returning
severity-ranked findings + remediation recommendations. This is the
provider-agnostic analyzer; a real connector (`providers.py`) authenticates to
Google Workspace / M365 / Box via OAuth and feeds it a normalized inventory.
Those adapters are stubbed to fail with a clear "needs OAuth credentials"
message (honest about what's configured) — the `manual` provider takes an
inventory directly and is fully working.

## API
- `POST /v1/app-control` — `{org_id, app, category, activity, sanctioned, risk_score, rules[]}` → `{action, reason, matched_rule}`.
- `POST /v1/oob/analyze` — `{org_id, provider, files[]}` → `{scanned, counts, findings[]}`.
- `GET /healthz`, `GET /metrics`.

Auth: org-bound HMAC service token (`CASB_SERVICE_SECRET`, matches admin-api).

## Integration
admin-api exposes `POST /api/v1/casb/app-control` and `POST /api/v1/casb/oob/analyze`
(org scoped from the JWT). The **CASB** dashboard page drives both: an inline
decision tester and a cloud-share scanner.

## What's production-ready vs reference
- Inline app-control engine + out-of-band **analyzer**: production-ready, tested.
- Out-of-band **connectors** (Google/M365/Box OAuth fetching): a documented
  adapter seam — wire tenant credentials to make them live; the analyzer they
  feed is identical.

## Test
```bash
python3.12 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
PYTHONPATH=. python -m pytest    # 23 tests: app-control, oob analyzer, providers, real-API
```
