"""app.auth.verify_token — direct unit tests, no HTTP layer. Covers the
secret-rotation behavior added alongside policy-bundle signing: a token
signed with the *previous* secret must still verify while a rotation is in
progress, since admin-api and this service are restarted independently."""

import pytest
from app.auth import AuthError, mint_token, verify_token
from app.config import settings

ORG = "33333333-3333-3333-3333-333333333333"


def bearer(token: str) -> str:
    return f"Bearer {token}"


@pytest.fixture
def rotation(monkeypatch):
    """Sets a distinct previous secret for the duration of one test."""
    monkeypatch.setattr(settings, "service_secret_previous", "the-previous-secret")
    yield "the-previous-secret"


def test_verify_accepts_token_signed_with_current_secret():
    token = mint_token(ORG, secret=settings.service_secret)
    verify_token(bearer(token), ORG)  # must not raise


def test_verify_accepts_token_signed_with_previous_secret(rotation):
    token = mint_token(ORG, secret=rotation)
    verify_token(bearer(token), ORG)  # must not raise — this is the whole point


def test_verify_rejects_token_signed_with_neither_secret(rotation):
    token = mint_token(ORG, secret="some-other-secret-entirely")
    with pytest.raises(AuthError):
        verify_token(bearer(token), ORG)


def test_verify_ignores_unset_previous_secret():
    # Default state: service_secret_previous is "" — must be skipped, not
    # treated as a valid empty-string secret that any signature could match
    # against. (mint_token(..., secret="") isn't a useful probe here — its
    # `secret or settings.service_secret` fallback silently signs with the
    # real current secret for a falsy input, so this constructs the token
    # by hand instead.)
    assert settings.service_secret_previous == ""
    import hashlib
    import hmac
    import json

    from app.auth import _b64url_encode

    payload = json.dumps({"iss": "admin-api", "org_id": ORG, "exp": 9999999999}, separators=(",", ":")).encode()
    sig = hmac.new(b"", payload, hashlib.sha256).digest()
    token = f"v1.{_b64url_encode(payload)}.{_b64url_encode(sig)}"

    with pytest.raises(AuthError):
        verify_token(bearer(token), ORG)


def test_verify_rejects_org_mismatch():
    token = mint_token(ORG, secret=settings.service_secret)
    with pytest.raises(AuthError):
        verify_token(bearer(token), "a-different-org")


def test_verify_rejects_expired_token():
    token = mint_token(ORG, ttl_seconds=-60, secret=settings.service_secret)
    with pytest.raises(AuthError):
        verify_token(bearer(token), ORG)


def test_verify_rejects_missing_header():
    with pytest.raises(AuthError):
        verify_token(None, ORG)


def test_verify_rejects_malformed_token():
    with pytest.raises(AuthError):
        verify_token(bearer("not.a.valid.token.shape"), ORG)
