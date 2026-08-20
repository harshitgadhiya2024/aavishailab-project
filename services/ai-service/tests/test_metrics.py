"""Regression test for the /metrics endpoint added in the Phase 0
observability fix — Prometheus was scraping this service and getting a
404 (no handler existed at all)."""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_still_works():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["service"] == "ai-service"


def test_metrics_endpoint_exists_and_is_plain_text():
    r = client.get("/metrics")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/plain")
    body = r.text
    assert not body.strip().startswith('"')
    assert "\\n" not in body
    assert "ai_service_requests_total" in body


def test_metrics_counts_requests():
    before = client.get("/metrics").text
    before_count = int(
        [l for l in before.splitlines() if l.startswith("ai_service_requests_total")][0].split()[1]
    )
    client.get("/health")
    after = client.get("/metrics").text
    after_count = int(
        [l for l in after.splitlines() if l.startswith("ai_service_requests_total")][0].split()[1]
    )
    # after_count includes the /health call plus the /metrics call itself
    assert after_count > before_count
