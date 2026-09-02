"""HTTP-level test for POST /v1/dlp/classify-image — auth + response shape,
with vision.classify_image itself mocked out (that logic has its own
dedicated coverage in test_vision.py)."""

from fastapi.testclient import TestClient

from app import internal_auth, vision
from app.main import app
from app.vision import VisionVerdict

client = TestClient(app)
ORG_ID = "11111111-1111-1111-1111-111111111111"


def _auth_header(monkeypatch, org_id=ORG_ID, secret="test-secret"):
    monkeypatch.setenv("AI_SERVICE_INTERNAL_SECRET", secret)
    token = internal_auth.mint_token(org_id, 300, secret)
    return {"Authorization": f"Bearer {token}"}


def test_missing_auth_header_rejected_by_fastapi(monkeypatch):
    # authorization: str = Header(...) is required, matching the existing
    # /api/v1/chat endpoint's convention — a fully absent header is a 422
    # validation error before this handler's own auth check ever runs.
    monkeypatch.setenv("AI_SERVICE_INTERNAL_SECRET", "test-secret")
    resp = client.post("/v1/dlp/classify-image", json={"org_id": ORG_ID, "image_b64": "aGk=", "mime": "image/png"})
    assert resp.status_code == 422


def test_garbage_auth_header_rejected(monkeypatch):
    monkeypatch.setenv("AI_SERVICE_INTERNAL_SECRET", "test-secret")
    resp = client.post("/v1/dlp/classify-image", headers={"Authorization": "Bearer not.a.real.token"},
                        json={"org_id": ORG_ID, "image_b64": "aGk=", "mime": "image/png"})
    assert resp.status_code == 401


def test_wrong_org_token_rejected(monkeypatch):
    headers = _auth_header(monkeypatch, org_id="22222222-2222-2222-2222-222222222222")
    resp = client.post("/v1/dlp/classify-image", headers=headers,
                        json={"org_id": ORG_ID, "image_b64": "aGk=", "mime": "image/png"})
    assert resp.status_code == 401


def test_valid_request_returns_verdict(monkeypatch):
    headers = _auth_header(monkeypatch)

    async def fake_classify(org_id, image_b64, mime="image/jpeg"):
        assert org_id == ORG_ID
        return VisionVerdict(sensitive=True, doc_type="pan_card", confidence=91, evidence="format match")

    monkeypatch.setattr(vision, "classify_image", fake_classify)

    resp = client.post("/v1/dlp/classify-image", headers=headers,
                        json={"org_id": ORG_ID, "image_b64": "aGk=", "mime": "image/png"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["sensitive"] is True
    assert body["doc_type"] == "pan_card"
    assert body["confidence"] == 91
