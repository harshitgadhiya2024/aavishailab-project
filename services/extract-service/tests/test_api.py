"""End-to-end HTTP-level tests against the actual FastAPI app: auth, the
streamed NDJSON contract, and the summary line every scan ends with."""

from __future__ import annotations

import json

from fastapi.testclient import TestClient

import corpus
from app.auth import mint_token
from app.config import settings
from app.main import app

client = TestClient(app)

ORG_ID = "11111111-1111-1111-1111-111111111111"


def _auth_header(org_id: str = ORG_ID) -> dict:
    token = mint_token(org_id, ttl_seconds=300, secret=settings.service_secret)
    return {"Authorization": f"Bearer {token}"}


def _ndjson_lines(resp) -> list[dict]:
    return [json.loads(line) for line in resp.text.strip().split("\n") if line.strip()]


def test_healthz():
    resp = client.get("/healthz")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_missing_auth_rejected():
    resp = client.post("/v1/extract?org_id=" + ORG_ID + "&filename=note.txt&content_type=text/plain",
                        content=b"hello")
    assert resp.status_code == 401


def test_wrong_org_token_rejected():
    headers = _auth_header(org_id="22222222-2222-2222-2222-222222222222")
    resp = client.post(f"/v1/extract?org_id={ORG_ID}&filename=note.txt&content_type=text/plain",
                        content=b"hello", headers=headers)
    assert resp.status_code == 401


def test_extract_text_end_to_end_over_http():
    headers = _auth_header()
    resp = client.post(
        f"/v1/extract?org_id={ORG_ID}&filename=note.txt&content_type=text/plain",
        content=corpus.CANARY_TEXT.encode(),
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/x-ndjson")

    lines = _ndjson_lines(resp)
    assert lines, "expected at least a summary line"
    assert lines[-1]["kind"] == "summary"
    assert lines[-1]["complete"] is True

    segments = [l for l in lines if l["kind"] == "segment"]
    assert any(corpus.CARD in s["text"] for s in segments)


def test_extract_zip_streams_multiple_parts():
    headers = _auth_header()
    docx = corpus.make_docx(f"card {corpus.CARD}")
    zip_bytes = corpus.make_zip({"a/report.docx": docx, "a/notes.txt": corpus.CANARY_TEXT.encode()})
    resp = client.post(
        f"/v1/extract?org_id={ORG_ID}&filename=bundle.zip&content_type=application/zip",
        content=zip_bytes, headers=headers,
    )
    assert resp.status_code == 200
    lines = _ndjson_lines(resp)
    segments = [l for l in lines if l["kind"] == "segment"]
    assert len(segments) >= 2
    assert any("report.docx" in s["part"] for s in segments)
    assert any("notes.txt" in s["part"] for s in segments)


def test_metrics_endpoint_is_plain_text():
    resp = client.get("/metrics")
    assert resp.status_code == 200
    assert "extract_scans_total" in resp.text
