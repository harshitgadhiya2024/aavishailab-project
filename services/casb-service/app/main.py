"""Aavishield CASB service — FastAPI entrypoint.

Two modes:
  • Inline app-control  (POST /v1/app-control): allow/alert/block a SaaS
    activity, layered on the proxy's existing DLP + threat inspection.
  • Out-of-band analysis (POST /v1/oob/analyze): flag risky cloud file shares
    (public links, external shares of sensitive docs) from a tenant inventory.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse

from . import __version__, appcontrol, oob, providers
from .auth import AuthError, verify_token
from .config import settings
from .schemas import (
    AppControlRequest,
    AppControlResponse,
    OOBRequest,
    OOBResponse,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("casb-service")

_METRICS = {"app_control_total": 0, "blocked_total": 0, "oob_scans_total": 0, "auth_failures_total": 0}


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.require_auth and settings.using_default_secret:
        log.warning("CASB_SERVICE_SECRET is the built-in default — set a strong shared secret in production.")
    yield


app = FastAPI(title="Aavishield CASB Service", version=__version__, lifespan=lifespan)


def _auth(authorization: str | None, org_id: str) -> None:
    try:
        verify_token(authorization, org_id)
    except AuthError as exc:
        _METRICS["auth_failures_total"] += 1
        raise HTTPException(status_code=401, detail=str(exc))


@app.get("/healthz")
async def healthz() -> dict:
    return {"status": "ok", "service": "casb-service", "version": __version__}


@app.get("/metrics")
async def metrics() -> JSONResponse:
    return JSONResponse(content="\n".join(f"casb_{k} {v}" for k, v in _METRICS.items()), media_type="text/plain")


@app.post("/v1/app-control", response_model=AppControlResponse)
async def app_control(req: AppControlRequest, authorization: str | None = Header(default=None)) -> AppControlResponse:
    _auth(authorization, req.org_id)
    org_rules = [
        appcontrol.Rule(
            name=r.name, category=r.category, app=r.app, activity=r.activity,
            sanctioned=r.sanctioned, min_risk=r.min_risk, action=r.action,
        )
        for r in req.rules
    ]
    decision = appcontrol.evaluate(
        appcontrol.Request(
            app=req.app, category=req.category, activity=req.activity,
            sanctioned=req.sanctioned, risk_score=req.risk_score,
        ),
        org_rules,
    )
    _METRICS["app_control_total"] += 1
    if decision.action == "block":
        _METRICS["blocked_total"] += 1
    return AppControlResponse(action=decision.action, reason=decision.reason, matched_rule=decision.matched_rule)


@app.post("/v1/oob/analyze", response_model=OOBResponse)
async def oob_analyze(req: OOBRequest, authorization: str | None = Header(default=None)) -> OOBResponse:
    _auth(authorization, req.org_id)
    try:
        inventory = providers.fetch_inventory(req.provider, {"files": [f.model_dump() for f in req.files]})
    except providers.ProviderError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    report = oob.analyze(inventory)
    _METRICS["oob_scans_total"] += 1
    return OOBResponse(
        provider=req.provider,
        scanned=report.scanned,
        counts=report.counts,
        findings=[f.as_dict() for f in report.findings],
    )


@app.exception_handler(Exception)
async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
    log.exception("Unhandled error: %s", exc)
    return JSONResponse(status_code=500, content={"error": "internal error"})
