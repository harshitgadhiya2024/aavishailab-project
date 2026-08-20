# Device poll simulator

Reproduces the real shipped-agent poll cadence (see
`scripts/agent/aavishield-agent.py`) against admin-api's
`/internal/agent/*` endpoints, so throughput/latency claims in the Rust
migration plan are measured, not projected.

## Usage

```bash
export PATH=$PATH:/usr/local/go/bin

# 1. Seed N synthetic devices + agent tokens under a throwaway org.
go run ./cmd/seed -n 1000 -dsn "postgres://aavishield:<pw>@127.0.0.1:7432/aavishield?sslmode=disable" -out tokens-1000.json

# 2. Run the poll simulation for a fixed duration.
go run ./cmd/run -tokens tokens-1000.json -duration 90s -label "baseline-1k"
```

`cmd/run` spins up one goroutine per device, each looping at the real
intervals — `GetRules` every 10s, activity flush every 5s, heartbeat every
60s — and reports p50/p95/p99 per endpoint plus a status-code breakdown.

## Baseline results (2026-08-20, pre-Phase-1, 1000 devices, 4 vCPU / 23GB host)

```
endpoint            count    p50(ms)    p95(ms)    p99(ms)    max(ms)
GetRules             8574     938.96    1811.67    2148.45    2942.51
Heartbeat            1000     639.58    1611.45    2093.14    2324.76
ReportActivity      17295     610.34    1046.27    1209.22    2339.10
```

`GetRules` — uncached, unindexed, recomputes the full org ruleset from
4–6 queries on every call — is already at **~1s p50 / ~1.8s p95 with only
1,000 simulated devices**, confirming the Phase 1 finding
(`agents.go:463-503`) without projection. Re-run the same command after
each Phase 1 change (Redis cache + ETag on `GetRules`, debounced
`authAgent` writes) and compare against `results/baseline-1k-pre-phase1.txt`.

Seeded rows are tagged under org slug `loadtest-org` / hostnames
`loadtest-host-*` — safe to leave (DB was empty before this) or delete with:

```sql
DELETE FROM agent_tokens WHERE org_id = (SELECT id FROM organizations WHERE slug = 'loadtest-org');
DELETE FROM devices WHERE org_id = (SELECT id FROM organizations WHERE slug = 'loadtest-org');
DELETE FROM employees WHERE org_id = (SELECT id FROM organizations WHERE slug = 'loadtest-org');
DELETE FROM organizations WHERE slug = 'loadtest-org';
```
