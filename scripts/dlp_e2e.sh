#!/usr/bin/env bash
# Minimal end-to-end check for the DLP overhaul. Hits the three services that
# changed, using HMAC tokens minted the same way admin-api does. Deliberately
# makes AT MOST ONE real OpenRouter call (the classify-text case) — the rest
# cost nothing.
#
#   DLP=http://127.0.0.1:7200 EXTRACT=http://127.0.0.1:7400 AI=http://127.0.0.1:7002 \
#     ./scripts/dlp_e2e.sh
set -u

DLP="${DLP:-http://127.0.0.1:7200}"
EXTRACT="${EXTRACT:-http://127.0.0.1:7400}"
AI="${AI:-http://127.0.0.1:7002}"
ORG="00000000-0000-0000-0000-0000000000e2"

# Secrets: read from .env (compose passes these through verbatim).
env_val() { grep -E "^$1=" .env | head -1 | cut -d= -f2-; }
DLP_SECRET="$(env_val DLP_SERVICE_SECRET)";     DLP_SECRET="${DLP_SECRET:-change-this-dlp-shared-secret-in-production}"
EXTRACT_SECRET="$(env_val EXTRACT_SERVICE_SECRET)"; EXTRACT_SECRET="${EXTRACT_SECRET:-change-this-extract-shared-secret-in-production}"
AI_SECRET="$(env_val AI_SERVICE_INTERNAL_SECRET)";  AI_SECRET="${AI_SECRET:-change-this-ai-internal-shared-secret-in-production}"

mint() { # mint <secret>  -> v1.<payload>.<sig>   (payload bound to $ORG, 5-min exp)
  python3 - "$1" "$ORG" <<'PY'
import base64, hashlib, hmac, json, sys, time
secret, org = sys.argv[1], sys.argv[2]
p = json.dumps({"iss":"admin-api","org_id":org,"exp":int(time.time())+300}, separators=(",",":")).encode()
b = lambda x: base64.urlsafe_b64encode(x).rstrip(b"=").decode()
sig = hmac.new(secret.encode(), p, hashlib.sha256).digest()
print(f"v1.{b(p)}.{b(sig)}")
PY
}

pass=0; fail=0
ok()   { echo "  PASS: $1"; pass=$((pass+1)); }
bad()  { echo "  FAIL: $1"; echo "        $2"; fail=$((fail+1)); }

echo "== 1. dlp-service /v1/scan — regex tier, Luhn-valid card in plain text (no LLM) =="
POL='[{"name":"t","action":"block","detectors":["credit_card","ai_text"],"priority":1}]'
BODY=$(python3 -c 'import base64;print(base64.b64encode(b"corp card 4242424242424242 do not share").decode())')
R=$(curl -s -m 20 -H "Authorization: Bearer $(mint "$DLP_SECRET")" -H 'Content-Type: application/json' \
  -d "{\"org_id\":\"$ORG\",\"filename\":\"note.txt\",\"content_type\":\"text/plain\",\"content_b64\":\"$BODY\",\"policies\":$POL}" \
  "$DLP/v1/scan")
echo "$R" | grep -q '"detectors":\["credit_card"\]' && echo "$R" | grep -q '"matched":true' \
  && ok "card detected, matched=true ($(echo "$R" | python3 -c 'import sys,json;d=json.load(sys.stdin);print("band="+d["band"],"score="+str(d["score"]))'))" \
  || bad "expected credit_card match" "$R"

echo "== 2. dlp-service /v1/scan — external ai_text match folds into score (no LLM) =="
POL2='[{"name":"t","action":"block","detectors":["ai_text"],"priority":1}]'
R=$(curl -s -m 20 -H "Authorization: Bearer $(mint "$DLP_SECRET")" -H 'Content-Type: application/json' \
  -d "{\"org_id\":\"$ORG\",\"filename\":\"x.docx\",\"content_type\":\"text/plain\",\"text\":\"quarterly compensation review\",\"policies\":$POL2,\"external_matches\":[{\"detector\":\"ai_text\",\"confidence\":100,\"preview\":\"salary_data\"}]}" \
  "$DLP/v1/scan")
echo "$R" | grep -q '"detector":"ai_text"' && echo "$R" | grep -q '"score":70' \
  && ok "ai_text external match scored 70" || bad "expected ai_text score 70" "$R"

echo "== 3. dlp-service /v1/scan — 30 MB body accepted, card near the end found (size-limit removed) =="
REQ=/tmp/dlp_e2e_big_$$.json
python3 - "$REQ" "$ORG" <<'PY'
import base64, json, sys
raw = (b"lorem ipsum dolor sit amet " * 40) * 30000          # ~32 MB
raw += b"  employee corporate card 4242424242424242 end"
json.dump({"org_id": sys.argv[2], "filename": "big.txt", "content_type": "text/plain",
          "content_b64": base64.b64encode(raw).decode(),
          "policies": [{"name":"t","action":"block","detectors":["credit_card","ai_text"],"priority":1}]},
         open(sys.argv[1], "w"))
print(f"   ({len(raw)//(1024*1024)} MB raw)")
PY
R=$(curl -s -m 90 -H "Authorization: Bearer $(mint "$DLP_SECRET")" -H 'Content-Type: application/json' \
  --data-binary @"$REQ" "$DLP/v1/scan")
rm -f "$REQ"
echo "$R" | grep -q '"matched":true' && ! echo "$R" | grep -qi 'too large' \
  && ok "30+ MB scanned, card found, no 413 ($(echo "$R" | python3 -c 'import sys,json;d=json.load(sys.stdin);print("band="+d.get("band","?"))' 2>/dev/null))" \
  || bad "expected 30+ MB to scan without 413" "$R"

echo "== 4. extract-service /v1/extract — ZIP with an inner secrets file -> segments (no LLM) =="
ZIP=/tmp/dlp_e2e_$$.zip
python3 - "$ZIP" <<'PY'
import sys, zipfile
with zipfile.ZipFile(sys.argv[1], "w") as z:
    z.writestr("hr/salary.csv", "name,ctc\nAsha,2400000\n")
    z.writestr("deploy/secrets.env", "AWS_SECRET_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE\n")
PY
R=$(curl -s -m 30 -H "Authorization: Bearer $(mint "$EXTRACT_SECRET")" \
  --data-binary @"$ZIP" -H 'Content-Type: application/octet-stream' \
  "$EXTRACT/v1/extract?org_id=$ORG&filename=bundle.zip&content_type=application/zip")
rm -f "$ZIP"
echo "$R" | grep -q 'salary.csv' && echo "$R" | grep -q 'secrets.env' \
  && ok "recursive zip extraction ($(echo "$R" | grep -c '"kind": "segment"') segments)" \
  || bad "expected inner files as segments" "$(echo "$R" | head -c 400)"

echo "== 5. ai-service /v1/dlp/classify-text — ONE real OpenRouter call =="
if [ "${SKIP_LLM:-0}" = "1" ]; then
  echo "  SKIP: SKIP_LLM=1"
else
  R=$(curl -s -m 45 -H "Authorization: Bearer $(mint "$AI_SECRET")" -H 'Content-Type: application/json' \
    -d "{\"org_id\":\"$ORG\",\"text\":\"CONFIDENTIAL — Employee compensation FY26\\nName, Base, Bonus, Equity\\nR. Sharma, 42,00,000, 8,00,000, 1200 RSU\\nThis document must not leave the company.\"}" \
    "$AI/v1/dlp/classify-text")
  echo "     -> $R"
  echo "$R" | grep -q '"sensitive": true' \
    && ok "classifier flagged the salary sheet sensitive" \
    || bad "expected sensitive:true (check OpenRouter key/credits)" "$R"
fi

echo
echo "==== $pass passed, $fail failed ===="
[ "$fail" -eq 0 ]
