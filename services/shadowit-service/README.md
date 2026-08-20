# shadowit-service — Shadow IT discovery (cloud-app classification)

Stateless Go service (stdlib only) that classifies a domain as a known
cloud/SaaS application with a **category** and a **0–100 risk score**. It's the
reusable classifier; admin-api does the rollup over the activity you already
log and applies sanction decisions.

## Catalog
A curated built-in catalog (~50 common apps: Dropbox, WeTransfer, ChatGPT,
Google Drive, GitHub, Slack, Pastebin, …). Risk reflects data-exfiltration /
compliance exposure of the app category — personal file-transfer and AI tools
score highest, collaboration suites lower. Mount `SHADOWIT_CATALOG_FILE` (JSON:
`{"domain":{"app","category","risk_score"}}`) to extend coverage toward a
Zscaler-sized app database with no code change; an omitted `risk_score` is
derived from the category.

## API
- `POST /v1/classify` — `{org_id, domains[]}` → `{results:[{domain, matched, app, category, risk_score}]}`. Parent-domain matching (api.dropbox.com → Dropbox).
- `GET /healthz` (includes catalog size), `GET /metrics`.

Auth: org-bound HMAC service token (`SHADOWIT_SERVICE_SECRET`, matches admin-api).

## How discovery works (in admin-api)
`GET /api/v1/shadow-it/apps` aggregates `activity_events` by destination domain
(request count, distinct users, first/last seen), classifies each domain via
this service, and marks each app's sanction status from the org's domain rules
→ an actionable app inventory. `POST /api/v1/shadow-it/apps/sanction`
(`{domain, action: sanction|unsanction|unreviewed}`) writes/removes a
`source=shadow_it` domain rule, so the decision flows to every device through
the same enforcement path as any other block/allow rule. The **Shadow IT**
dashboard page renders it with one-click sanction / block / reset.

## Test
```bash
go test ./...   # catalog classification (+ override), API auth
```
