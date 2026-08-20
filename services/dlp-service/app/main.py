"""Aavishield DLP microservice — FastAPI entrypoint.

Stateless: it holds no database and persists nothing. It receives content +
the org's DLP policy config, returns a weighted sensitivity score and a
decision band (block / alert / allow). admin-api owns event logging and the
agent contract; this service is pure compute you can scale horizontally.
"""

from __future__ import annotations

import base64
import binascii
import logging

from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse, PlainTextResponse

from . import __version__
from . import detectors as d
from . import scoring
from .auth import AuthError, verify_token
from .config import settings
from .schemas import ScanRequest, ScanResponse

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("dlp-service")


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.require_auth and settings.using_default_secret:
        log.warning(
            "DLP_SERVICE_SECRET is the built-in default — set a strong shared "
            "secret in production or the service token can be forged."
        )
    yield


app = FastAPI(title="Aavishield DLP Service", version=__version__, lifespan=lifespan)

# Prometheus-style counters (in-memory; scraped via /metrics).
_METRICS = {"scans_total": 0, "blocked_total": 0, "alerted_total": 0, "auth_failures_total": 0}


@app.get("/healthz")
async def healthz() -> dict:
    return {"status": "ok", "service": "dlp-service", "version": __version__}


@app.get("/metrics")
async def metrics() -> PlainTextResponse:
    lines = [f"dlp_{k} {v}" for k, v in _METRICS.items()]
    return PlainTextResponse("\n".join(lines) + "\n")


def _policy_from_in(p) -> scoring.Policy:
    return scoring.Policy(
        name=p.name,
        action=p.action,
        detectors=p.detectors,
        keywords=p.keywords,
        custom_patterns=[d.CustomPattern(cp.name, cp.regex) for cp in p.custom_patterns],
        bypass_file_types=p.bypass_file_types,
        detector_weights=p.detector_weights,
        block_threshold=p.block_threshold,
        alert_threshold=p.alert_threshold,
        priority=p.priority,
    )


def _decode_content(req: ScanRequest) -> str:
    if req.text is not None:
        content = req.text
        if len(content.encode("utf-8", "ignore")) > settings.max_scan_size:
            raise HTTPException(status_code=413, detail="Content too large to scan")
        return content

    if not req.content_b64:
        return ""
    try:
        raw = base64.b64decode(req.content_b64, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="content_b64 is not valid base64")
    if len(raw) > settings.max_scan_size:
        raise HTTPException(status_code=413, detail="Content too large to scan")
    # Sensitive identifiers are ASCII; decoding lossily is fine and avoids
    # choking on binary uploads (an image with an embedded key still scans).
    return raw.decode("utf-8", errors="replace")


@app.post("/v1/scan", response_model=ScanResponse)
async def scan(req: ScanRequest, authorization: str | None = Header(default=None)) -> ScanResponse:
    try:
        verify_token(authorization, req.org_id)
    except AuthError as exc:
        _METRICS["auth_failures_total"] += 1
        raise HTTPException(status_code=401, detail=str(exc))

    text = _decode_content(req)
    policies = [_policy_from_in(p) for p in req.policies]

    result = scoring.scan(policies, text, req.filename, req.content_type)
    _METRICS["scans_total"] += 1
    if result.action == "block":
        _METRICS["blocked_total"] += 1
    elif result.action == "alert":
        _METRICS["alerted_total"] += 1

    reason = ""
    if result.matched and result.matches:
        reason = f"Sensitive company data detected: {result.matches[0].label}"

    return ScanResponse(
        scanned=True,
        matched=result.matched,
        score=result.score,
        band=result.band,
        action=result.action,
        policy_name=result.policy_name,
        reason=reason,
        detectors=sorted({m.detector for m in result.matches}),
        matches=[m.as_dict() for m in result.matches],
        thresholds={"block": result.block_threshold, "alert": result.alert_threshold},
    )


@app.exception_handler(Exception)
async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
    # Fail-open contract: if scanning itself errors, admin-api treats a non-200
    # as "scanner unavailable" and allows the upload rather than blocking on a
    # bug. We still surface the error for observability.
    log.exception("Unhandled error scanning request: %s", exc)
    return JSONResponse(status_code=500, content={"scanned": False, "error": "internal error"})
