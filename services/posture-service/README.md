# posture-service — device posture scoring + GeoIP

Stateless Go service (stdlib only) with two jobs:

## 1. Device posture scoring
Scores a device's security posture 0–100 from agent-reported signals (disk
encryption, host firewall, OS up-to-date, screen lock, antivirus). A device
starts at 100 and loses the full weight for a control that's **off**, half for
one that's **unknown** (the agent couldn't determine it). Score → **pass / warn
/ fail** via configurable thresholds, so posture becomes a policy condition.

Weights (sum 100): disk encryption 30 · firewall 20 · OS up-to-date 20 · screen
lock 15 · antivirus 15.

## 2. GeoIP resolution
Resolves an IP → country. Private/reserved/CGNAT ranges are detected natively;
public IPv4 addresses resolve via a **mounted free country CSV**
(`POSTURE_GEOIP_CSV`, lines `startIP,endIP,code,name` — a db-ip.com /
ip2location LITE export). Without the CSV, public IPs return "unknown" and only
private/reserved detection works — closing the roadmap's "location missing" gap
as soon as a free CSV is mounted, with no code change.

## API
- `POST /v1/posture` — `{org_id, device_id, signals}` → `{score, status, passed, failed, unknown, reasons}`.
- `GET /v1/geoip?org_id=&ip=` → `{country_code, country, is_private}`.
- `GET /healthz`, `GET /metrics`.

Auth: org-bound HMAC service token (`POSTURE_SERVICE_SECRET`, matches admin-api).

## Integration
The endpoint agent now reports posture signals (best-effort, read-only, per-OS
probes) on every heartbeat. admin-api's `Heartbeat` handler resolves the
device's country via GeoIP, evaluates posture, stores `posture_score` +
`geo_country` on the device, and raises an incident when a device **fails**
posture — so admins see non-compliant machines and where devices connect from.

## Config (env)
| Var | Default | Meaning |
|-----|---------|---------|
| `POSTURE_SERVICE_SECRET` | insecure dev default | shared HMAC secret |
| `POSTURE_REQUIRE_AUTH` | `true` | reject unsigned requests |
| `POSTURE_PASS_THRESHOLD` / `POSTURE_WARN_THRESHOLD` | 80 / 50 | pass/warn bands |
| `POSTURE_GEOIP_CSV` | — | path to a country range CSV |

## Test
```bash
go test ./...   # posture scoring, geoip (fixture CSV), API auth
```
