# threatintel-service — threat intelligence scoring microservice

Stateless Go service (stdlib only, no external deps) that scores the reputation
of a **domain, IP, or file hash** on a 0–100 scale with block/alert/allow bands.
Extends the in-process domain-only riskengine to also cover **IPs and file
hashes**, closing a gap noted in the roadmap.

## Data
Syncs free, no-key public feeds into memory on a timer (default every 6h):
- **URLhaus** (malware distribution URLs → domains)
- **OpenPhish** (phishing → domains)
- **Feodo Tracker** (botnet C2 → IPs)
- **MalwareBazaar** (recent malware sample SHA-256 → hashes)

Each replica syncs the same public feeds, so the service scales horizontally
with no shared datastore. Fetching is behind an interface — tests inject fixed
feed content and never touch the network.

## Scoring
- Feed hit → domain +85 / IP 90 / hash 100 (near-ground-truth, clears block).
- DNS/name heuristics (entropy, digit ratio, subdomain depth) add up to +15.
- Bands: score ≥ block (80) → block, ≥ alert (50) → alert, else allow.
- (WHOIS domain-age enrichment is a documented future signal; kept out of the
  default path so scoring stays deterministic and fast.)

## API
- `POST /v1/score` — `{org_id, indicator, kind}` (kind: domain|ip|hash).
- `GET /v1/lookup?org_id=&domain=|ip=|hash=` — dashboard convenience.
- `GET /healthz` (includes indicator counts), `GET /metrics`.

Auth: org-bound HMAC service token (`THREATINTEL_SERVICE_SECRET`, matches
admin-api), verified per request.

## Integration
admin-api's `GET /api/v1/swg/threat-lookup?domain=|ip=|hash=` proxies here
(via `internal/threatintelclient`), falling back to the in-process riskengine
for domains when the service isn't configured.

## Config (env)
| Var | Default | Meaning |
|-----|---------|---------|
| `THREATINTEL_SERVICE_SECRET` | insecure dev default | shared HMAC secret |
| `THREATINTEL_REQUIRE_AUTH` | `true` | reject unsigned requests |
| `THREATINTEL_ENABLE_FEEDS` | `true` | background feed sync |
| `THREATINTEL_SYNC_HOURS` | `6` | feed refresh interval |
| `THREATINTEL_BLOCK_THRESHOLD` / `THREATINTEL_ALERT_THRESHOLD` | 80 / 50 | bands |

## Test
```bash
go test ./...    # scoring, feeds (fake fetcher), API (auth + endpoints)
```
