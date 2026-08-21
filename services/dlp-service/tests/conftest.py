"""Shared test fixtures. Env is set here (before any app import) so the
service boots with a known shared secret and auth enabled."""

import os

os.environ.setdefault("DLP_SERVICE_SECRET", "test-secret-123")
os.environ.setdefault("DLP_REQUIRE_AUTH", "true")
# No Tempo collector in a bare pytest run — without this the OTel SDK's
# background export thread spends the whole test run retrying against an
# unreachable host and spamming noisy "Transient error" log lines.
os.environ.setdefault("OTEL_SDK_DISABLED", "true")

import pytest
from fastapi.testclient import TestClient

from app.auth import mint_token
from app.detectors import verhoeff_valid
from app.main import app

ORG_A = "11111111-1111-1111-1111-111111111111"
ORG_B = "22222222-2222-2222-2222-222222222222"


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def token():
    """Factory: token(org, ttl) -> a valid bearer token for that org."""
    def _make(org_id: str = ORG_A, ttl: int = 300) -> str:
        return mint_token(org_id, ttl_seconds=ttl, secret="test-secret-123")
    return _make


def valid_aadhaar(base11: str = "23412341234") -> str:
    """Return a 12-digit Aadhaar that passes the Verhoeff checksum, by picking
    the one check digit (of 10) that validates. Independent of the detector's
    own regex, so it genuinely exercises the checksum path."""
    for d in "0123456789":
        candidate = base11 + d
        if verhoeff_valid(candidate):
            return candidate
    raise AssertionError("no valid Verhoeff check digit found")
