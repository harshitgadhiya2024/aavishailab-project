"""Real HTTP tests through the full ASGI stack (routing, validation, auth,
serialization) via Starlette's TestClient."""

import base64

from app.auth import mint_token
from app.config import settings
from tests.conftest import ORG_A, ORG_B

CARD = "4242424242424242"
AWS = "AKIAIOSFODNN7EXAMPLE"

DEFAULT_POLICY = {
    "name": "Default DLP",
    "action": "block",
    "detectors": ["credit_card", "aws_key", "generic_api_key", "aadhaar"],
    "keywords": ["confidential"],
}


def b64(s: str) -> str:
    return base64.b64encode(s.encode()).decode()


def scan_body(text=None, content_b64=None, org=ORG_A, policies=None, **extra):
    body = {"org_id": org, "policies": policies if policies is not None else [DEFAULT_POLICY]}
    if text is not None:
        body["text"] = text
    if content_b64 is not None:
        body["content_b64"] = content_b64
    body.update(extra)
    return body


def test_healthz(client):
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_scan_credit_card_alerts(client, token):
    r = client.post("/v1/scan", json=scan_body(content_b64=b64(f"card {CARD}")),
                    headers={"Authorization": f"Bearer {token(ORG_A)}"})
    assert r.status_code == 200
    body = r.json()
    assert body["matched"] is True
    assert body["band"] == "alert"
    assert body["action"] == "alert"
    assert body["score"] == 55
    assert body["thresholds"] == {"block": 80, "alert": 50}
    # Response must never leak the raw card number.
    assert CARD not in r.text
    assert body["matches"][0]["masked_preview"].endswith("4242")


def test_scan_aws_key_blocks(client, token):
    r = client.post("/v1/scan", json=scan_body(content_b64=b64(f"secret {AWS}")),
                    headers={"Authorization": f"Bearer {token(ORG_A)}"})
    assert r.status_code == 200
    assert r.json()["action"] == "block"


def test_scan_clean_allows(client, token):
    r = client.post("/v1/scan", json=scan_body(content_b64=b64("hello team, lunch at noon?")),
                    headers={"Authorization": f"Bearer {token(ORG_A)}"})
    assert r.status_code == 200
    body = r.json()
    assert body["matched"] is False
    assert body["action"] == "allow"


def test_inline_text_path(client, token):
    # The dashboard "test a sample" path uses `text` instead of content_b64.
    r = client.post("/v1/scan", json=scan_body(text=f"here is {CARD}"),
                    headers={"Authorization": f"Bearer {token(ORG_A)}"})
    assert r.status_code == 200
    assert r.json()["band"] == "alert"


def test_missing_token_rejected(client):
    r = client.post("/v1/scan", json=scan_body(content_b64=b64(CARD)))
    assert r.status_code == 401


def test_wrong_org_token_rejected(client, token):
    # Token minted for ORG_B, but request claims ORG_A.
    r = client.post("/v1/scan", json=scan_body(org=ORG_A, content_b64=b64(CARD)),
                    headers={"Authorization": f"Bearer {token(ORG_B)}"})
    assert r.status_code == 401


def test_expired_token_rejected(client, token):
    r = client.post("/v1/scan", json=scan_body(content_b64=b64(CARD)),
                    headers={"Authorization": f"Bearer {token(ORG_A, ttl=-10)}"})
    assert r.status_code == 401


def test_tampered_signature_rejected(client):
    good = mint_token(ORG_A, secret="test-secret-123")
    forged = mint_token(ORG_A, secret="attacker-guess")
    # Same payload, different secret -> signature mismatch.
    r = client.post("/v1/scan", json=scan_body(content_b64=b64(CARD)),
                    headers={"Authorization": f"Bearer {forged}"})
    assert r.status_code == 401
    assert good != forged


def test_oversize_rejected(client, token, monkeypatch):
    monkeypatch.setattr(settings, "max_scan_size", 16)
    big = b64("x" * 100)
    r = client.post("/v1/scan", json=scan_body(content_b64=big),
                    headers={"Authorization": f"Bearer {token(ORG_A)}"})
    assert r.status_code == 413


def test_bad_base64_rejected(client, token):
    r = client.post("/v1/scan", json=scan_body(content_b64="!!!not base64!!!"),
                    headers={"Authorization": f"Bearer {token(ORG_A)}"})
    assert r.status_code == 400


def test_binary_upload_does_not_crash(client, token):
    raw = base64.b64encode(bytes(range(256))).decode()
    r = client.post("/v1/scan", json=scan_body(content_b64=raw),
                    headers={"Authorization": f"Bearer {token(ORG_A)}"})
    assert r.status_code == 200
