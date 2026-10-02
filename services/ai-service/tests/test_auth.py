"""Every route that reaches the LLM requires a valid admin-api access token —
the service is on the internet, and before this any Authorization header at
all was accepted, turning it into a free proxy on the OpenRouter key."""

import base64
import hashlib
import hmac
import json
import time
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import app.main as main
from app.core.auth import verify_access_token

SECRET = "test-jwt-secret-that-is-long-enough-to-pass"
ORG = "7f9c2a8e-0000-4000-8000-000000000001"


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def make_token(secret=SECRET, alg="HS256", **overrides):
    claims = {"user_id": "u1", "org_id": ORG, "role": "admin", "iss": "aavishield", "exp": time.time() + 600}
    claims.update(overrides)
    head = _b64(json.dumps({"alg": alg, "typ": "JWT"}).encode())
    body = _b64(json.dumps(claims).encode())
    sig = _b64(hmac.new(secret.encode(), f"{head}.{body}".encode(), hashlib.sha256).digest())
    return f"{head}.{body}.{sig}"


class FakeRouter:
    calls = 0

    async def chat(self, msgs, **kw):
        FakeRouter.calls += 1
        return SimpleNamespace(content="ok", model="m", provider="p", finish_reason="stop",
                               prompt_tokens=1, completion_tokens=1)


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("JWT_ACCESS_SECRET", SECRET)
    monkeypatch.setattr(main, "get_router", lambda: FakeRouter())
    FakeRouter.calls = 0
    return TestClient(main.app)


BODY = {"messages": [{"role": "user", "content": "hi"}], "agent_mode": False}


@pytest.mark.parametrize("auth", [
    None,
    "Bearer anything",
    "Bearer " + make_token(secret="some-other-secret"),
    "Bearer " + make_token(exp=time.time() - 1),
    "Bearer " + make_token(alg="none"),
    "Bearer " + make_token(iss="aavishield-portal", role="employee"),
    "Bearer " + make_token(iss="aavishield-mfa"),
    make_token(),
])
def test_bad_tokens_never_reach_the_llm(client, auth):
    headers = {"Authorization": auth} if auth else {}
    for path, extra in (("/api/v1/completions", {}), ("/api/v1/chat", {"x-org-id": ORG})):
        r = client.post(path, json=BODY, headers={**headers, **extra})
        assert r.status_code == 401, (path, r.text)
    assert FakeRouter.calls == 0


def test_valid_token_is_served(client):
    auth = {"Authorization": "Bearer " + make_token()}
    assert client.post("/api/v1/completions", json=BODY, headers=auth).status_code == 200
    assert client.post("/api/v1/chat", json=BODY, headers={**auth, "x-org-id": ORG}).status_code == 200
    assert FakeRouter.calls == 2


def test_token_cannot_speak_for_another_org(client):
    auth = {"Authorization": "Bearer " + make_token(), "x-org-id": "another-org"}
    assert client.post("/api/v1/chat", json=BODY, headers=auth).status_code == 403
    assert client.post("/api/v1/chat/stream", json=BODY, headers=auth).status_code == 403
    assert FakeRouter.calls == 0


def test_superadmin_may_act_on_any_org(client):
    auth = {"Authorization": "Bearer " + make_token(role="superadmin", org_id=None), "x-org-id": ORG}
    assert client.post("/api/v1/chat", json=BODY, headers=auth).status_code == 200


def test_cors_no_longer_allows_any_origin(client):
    r = client.options("/api/v1/completions", headers={
        "Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
    assert r.headers.get("access-control-allow-origin") != "*"
    assert r.headers.get("access-control-allow-origin") != "https://evil.example"


def test_admin_api_token_shape_verifies():
    claims = verify_access_token(make_token(), SECRET)
    assert claims["org_id"] == ORG
