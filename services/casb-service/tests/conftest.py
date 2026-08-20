import os

os.environ.setdefault("CASB_SERVICE_SECRET", "test-casb-secret")
os.environ.setdefault("CASB_REQUIRE_AUTH", "true")

import pytest
from fastapi.testclient import TestClient

from app.auth import mint_token
from app.main import app

ORG_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
ORG_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def token():
    def _make(org=ORG_A, ttl=300):
        return mint_token(org, ttl_seconds=ttl, secret="test-casb-secret")
    return _make
