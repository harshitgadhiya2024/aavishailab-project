#!/usr/bin/env bash
#
# Runs every microservice's test suite + the admin-api Go tests, and prints a
# consolidated pass/fail summary. Use this to verify the whole platform after a
# change.  Usage:  ./scripts/run-all-tests.sh
#
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GO="${GO_BIN:-go}"
command -v "$GO" >/dev/null 2>&1 || GO="/opt/homebrew/bin/go"

pass=0; fail=0
declare -a results

run() {  # run <label> <dir> <command...>
  local label="$1" dir="$2"; shift 2
  printf "\n\033[1m▶ %s\033[0m (%s)\n" "$label" "$dir"
  if ( cd "$ROOT/$dir" && "$@" ); then
    results+=("PASS  $label"); pass=$((pass+1))
  else
    results+=("FAIL  $label"); fail=$((fail+1))
  fi
}

# ─── Go services (stdlib, no external deps) ─────────────────────────────────────
run "admin-api (Go)"          "services/admin-api"          "$GO" test ./...
run "threatintel-service (Go)" "services/threatintel-service" "$GO" test ./...
run "posture-service (Go)"    "services/posture-service"    "$GO" test ./...
run "shadowit-service (Go)"   "services/shadowit-service"   "$GO" test ./...

# ─── Python services (use each service's own .venv if present) ──────────────────
pytest_svc() {  # pytest_svc <label> <dir>
  local label="$1" dir="$2"
  local py="$ROOT/$dir/.venv/bin/python"
  [ -x "$py" ] || py="python3"
  run "$label" "$dir" env PYTHONPATH=. "$py" -m pytest -q
}
pytest_svc "dlp-service (py)"     "services/dlp-service"
pytest_svc "malware-service (py)" "services/malware-service"
pytest_svc "casb-service (py)"    "services/casb-service"

# ─── Summary ────────────────────────────────────────────────────────────────────
printf "\n\033[1m═══ Summary ═══\033[0m\n"
for r in "${results[@]}"; do
  if [[ "$r" == PASS* ]]; then printf "  \033[32m%s\033[0m\n" "$r"; else printf "  \033[31m%s\033[0m\n" "$r"; fi
done
printf "\n%d passed, %d failed\n" "$pass" "$fail"
exit $(( fail > 0 ? 1 : 0 ))
