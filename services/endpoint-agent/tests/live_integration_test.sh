#!/bin/bash
# Live end-to-end integration test against a REAL running admin-api +
# dlp-service + the rest of the docker-compose stack — not mocks. This is
# a documented, repeatable version of the manual QA pass that validated
# this agent before it was considered anything more than "compiles and
# unit-tests pass": real enrollment, real domain/DLP policy evaluation,
# and — the part that actually matters — cryptographic proof that MITM
# TLS interception is genuinely terminating and re-encrypting traffic,
# not just relaying it.
#
# Requires: the full docker-compose stack up (`make up` from repo root),
# a release build of this agent (`cargo build --release`), and sudo (to
# write the CA-trust marker at /etc/aavishield/ca-trusted — see
# config.rs's mitm_ca_trusted doc comment for why that's root-owned).
#
# Cleans up all seeded rows (org id 99999999-...) and the agent process
# on exit, success or failure.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
AGENT_BIN="$REPO_ROOT/services/endpoint-agent/target/release/aavishield-agent"
TEST_ORG="99999999-9999-9999-9999-999999999999"
TEST_HOME=$(mktemp -d)
AGENT_LOG=$(mktemp)
ADMIN_URL="http://127.0.0.1:7100"

pass() { echo "  OK   $1"; }
fail() { echo "  FAIL $1"; exit 1; }

cleanup() {
  [ -n "${AGENT_PID:-}" ] && kill -9 "$AGENT_PID" 2>/dev/null || true
  psql_exec "
    DELETE FROM activity_events WHERE org_id = '$TEST_ORG';
    DELETE FROM policies WHERE org_id = '$TEST_ORG';
    DELETE FROM domain_rules WHERE org_id = '$TEST_ORG';
    DELETE FROM agent_tokens WHERE org_id = '$TEST_ORG';
    DELETE FROM devices WHERE org_id = '$TEST_ORG';
    DELETE FROM org_ca_certs WHERE org_id = '$TEST_ORG';
    DELETE FROM enrollment_tokens WHERE org_id = '$TEST_ORG';
    DELETE FROM organizations WHERE id = '$TEST_ORG';
  " >/dev/null 2>&1 || true
  sudo rm -f /etc/aavishield/ca-trusted 2>/dev/null || true
  rm -rf "$TEST_HOME" "$AGENT_LOG"
}
trap cleanup EXIT

psql_exec() {
  local pgp pgu pgd
  pgp=$(docker exec aavishield-postgres printenv POSTGRES_PASSWORD)
  pgu=$(docker exec aavishield-postgres printenv POSTGRES_USER)
  pgd=$(docker exec aavishield-postgres printenv POSTGRES_DB)
  docker exec -e PGPASSWORD="$pgp" aavishield-postgres psql -p 6432 -U "$pgu" -d "$pgd" -t -c "$1"
}

[ -x "$AGENT_BIN" ] || { echo "build the release binary first: (cd services/endpoint-agent && cargo build --release)"; exit 1; }

echo "=== seeding test org, enrollment token, domain block rule, DLP policy ==="
psql_exec "
  INSERT INTO organizations (id, name, slug, created_at, updated_at)
  VALUES ('$TEST_ORG', 'Integration Test Org', 'integration-test-org-$$', now(), now());
  INSERT INTO enrollment_tokens (id, org_id, token, created_at, expires_at)
  VALUES (gen_random_uuid(), '$TEST_ORG', 'integration-test-token-$$', now(), now() + interval '1 hour');
  UPDATE organizations SET settings = jsonb_set(coalesce(settings,'{}'::jsonb), '{mitm_enabled}', 'true') WHERE id = '$TEST_ORG';
  INSERT INTO domain_rules (id, org_id, domain, action, reason, category, enabled, created_at, updated_at)
  VALUES (gen_random_uuid(), '$TEST_ORG', 'httpbin.org', 'block', 'integration test block', 'testing', true, now(), now());
  INSERT INTO policies (id, org_id, name, type, action, enabled, rules, targets, priority, created_at, updated_at)
  VALUES (gen_random_uuid(), '$TEST_ORG', 'Integration Test DLP', 'dlp', 'block', true, '{\"detectors\": [\"aws_key\"]}'::jsonb, '{\"scope\":\"all\"}'::jsonb, 100, now(), now());
" >/dev/null

sudo mkdir -p /etc/aavishield && sudo touch /etc/aavishield/ca-trusted

echo "=== starting agent (enrolls on startup, then serves the proxy) ==="
HOME="$TEST_HOME" AAVISHIELD_ENROLL_TOKEN="integration-test-token-$$" AAVISHIELD_ADMIN_URL="$ADMIN_URL" RUST_LOG=info \
  "$AGENT_BIN" >"$AGENT_LOG" 2>&1 &
AGENT_PID=$!

for _ in $(seq 1 20); do
  [ -f "$TEST_HOME/.aavishield/config.json" ] && break
  sleep 0.5
done
[ -f "$TEST_HOME/.aavishield/config.json" ] || fail "enrollment never wrote a config file"
pass "enrolled (config written)"

for _ in $(seq 1 20); do
  curl -s -o /dev/null http://127.0.0.1:6118 2>/dev/null; [ $? -ne 7 ] && break
  sleep 0.5
done

DEVICE_ID=$(python3 -c "import json; print(json.load(open('$TEST_HOME/.aavishield/config.json'))['device_id'])")
AGENT_KEY=$(python3 -c "import json; print(json.load(open('$TEST_HOME/.aavishield/config.json'))['agent_key'])")

echo "=== plain HTTP allow ==="
code=$(curl -s -x http://127.0.0.1:6118 -o /dev/null -w "%{http_code}" http://example.com/)
[ "$code" = "200" ] && pass "plain HTTP to example.com -> 200" || fail "expected 200, got $code"

echo "=== waiting for policy refresh (up to 15s) ==="
sleep 12

echo "=== plain HTTP block ==="
code=$(curl -s -x http://127.0.0.1:6118 -o /dev/null -w "%{http_code}" http://httpbin.org/get)
[ "$code" = "403" ] && pass "plain HTTP to blocked httpbin.org -> 403" || fail "expected 403, got $code"

echo "=== fetching org CA for MITM verification ==="
curl -s -H "Authorization: Bearer $DEVICE_ID:$AGENT_KEY" "$ADMIN_URL/internal/agent/ca-cert" -o "$TEST_HOME/ca.pem"
[ -s "$TEST_HOME/ca.pem" ] || fail "could not fetch org CA cert"
pass "fetched org CA cert"

echo "=== MITM: default trust must FAIL (proves real interception, not a blind tunnel) ==="
if curl -s -x http://127.0.0.1:6118 https://example.com/ -o /dev/null 2>/dev/null; then
  fail "HTTPS to example.com succeeded WITHOUT trusting our CA — MITM is not actually terminating TLS"
fi
pass "default-trust HTTPS correctly rejects our leaf cert"

echo "=== MITM: with our CA trusted, request must succeed with real content ==="
code=$(curl -s -x http://127.0.0.1:6118 --cacert "$TEST_HOME/ca.pem" https://example.com/ -o "$TEST_HOME/resp.html" -w "%{http_code}")
[ "$code" = "200" ] && pass "MITM'd HTTPS to example.com -> 200, verified against our own CA" || fail "expected 200, got $code"
grep -qi "example" "$TEST_HOME/resp.html" || fail "response body doesn't look like example.com's real page"
pass "response body is genuine upstream content"

echo "=== disabling the domain block (it would otherwise shadow the DLP check below — domain/threat rules are evaluated before DLP, same as the Python original's _effective_rule ordering) ==="
psql_exec "UPDATE domain_rules SET enabled = false WHERE org_id = '$TEST_ORG' AND domain = 'httpbin.org';" >/dev/null
sleep 12

echo "=== DLP: AWS key over MITM'd HTTPS must block ==="
code=$(curl -s -x http://127.0.0.1:6118 --cacert "$TEST_HOME/ca.pem" -X POST https://httpbin.org/post \
  -d "key=AKIAIOSFODNN7EXAMPLE" -o "$TEST_HOME/dlp.html" -w "%{http_code}")
[ "$code" = "403" ] && pass "AWS key upload -> 403 (DLP block)" || fail "expected 403, got $code"
grep -qi "AWS Access Key" "$TEST_HOME/dlp.html" || fail "block page doesn't name the detector"
pass "block page correctly names the detector"

echo "=== activity events reached admin-api ==="
count=$(psql_exec "SELECT count(*) FROM activity_events WHERE org_id = '$TEST_ORG';" | tr -d ' ')
[ "$count" -ge 2 ] && pass "$count activity events recorded" || fail "expected >=2 activity events, got $count"

echo ""
echo "=== ALL LIVE INTEGRATION CHECKS PASSED ==="
