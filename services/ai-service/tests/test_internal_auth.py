"""internal_auth — the HMAC bearer-token scheme admin-api uses for its
service-to-service calls into ai-service (currently just
/v1/dlp/classify-image). Mirrors dlp-service/app/auth.py's own test
coverage since it's the identical scheme."""

import os

from app import internal_auth

SECRET = "test-secret-123"
ORG_A = "11111111-1111-1111-1111-111111111111"
ORG_B = "22222222-2222-2222-2222-222222222222"


def _with_secret(monkeypatch, secret=SECRET, previous=None):
    monkeypatch.setenv("AI_SERVICE_INTERNAL_SECRET", secret)
    if previous is not None:
        monkeypatch.setenv("AI_SERVICE_INTERNAL_SECRET_PREVIOUS", previous)
    else:
        monkeypatch.delenv("AI_SERVICE_INTERNAL_SECRET_PREVIOUS", raising=False)


def test_valid_token_round_trips(monkeypatch):
    _with_secret(monkeypatch)
    tok = internal_auth.mint_token(ORG_A, 300, SECRET)
    internal_auth.verify_token(f"Bearer {tok}", ORG_A)  # must not raise


def test_missing_header_rejected(monkeypatch):
    _with_secret(monkeypatch)
    try:
        internal_auth.verify_token(None, ORG_A)
        assert False, "expected AuthError"
    except internal_auth.AuthError as e:
        assert "missing" in str(e)


def test_wrong_org_rejected(monkeypatch):
    _with_secret(monkeypatch)
    tok = internal_auth.mint_token(ORG_B, 300, SECRET)
    try:
        internal_auth.verify_token(f"Bearer {tok}", ORG_A)
        assert False, "expected AuthError"
    except internal_auth.AuthError as e:
        assert "org" in str(e)


def test_expired_token_rejected(monkeypatch):
    _with_secret(monkeypatch)
    tok = internal_auth.mint_token(ORG_A, -10, SECRET)
    try:
        internal_auth.verify_token(f"Bearer {tok}", ORG_A)
        assert False, "expected AuthError"
    except internal_auth.AuthError as e:
        assert "expired" in str(e)


def test_tampered_signature_rejected(monkeypatch):
    _with_secret(monkeypatch)
    forged = internal_auth.mint_token(ORG_A, 300, "attacker-guess")
    try:
        internal_auth.verify_token(f"Bearer {forged}", ORG_A)
        assert False, "expected AuthError"
    except internal_auth.AuthError as e:
        assert "signature" in str(e)


def test_previous_secret_accepted_during_rotation(monkeypatch):
    old_secret = "old-secret-being-rotated-out"
    _with_secret(monkeypatch, secret=SECRET, previous=old_secret)
    tok = internal_auth.mint_token(ORG_A, 300, old_secret)
    internal_auth.verify_token(f"Bearer {tok}", ORG_A)  # must not raise


def test_auth_disabled_always_passes(monkeypatch):
    monkeypatch.setenv("AI_INTERNAL_REQUIRE_AUTH", "false")
    internal_auth.verify_token(None, ORG_A)  # must not raise
    monkeypatch.delenv("AI_INTERNAL_REQUIRE_AUTH", raising=False)
