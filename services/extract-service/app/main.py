"""AaviShield extract-service — deep content extraction (documents,
archives, images + OCR) feeding the DLP detector pipeline. Stateless:
streams NDJSON segments back to the caller as it walks the content, and
holds/persists nothing itself. See app/extract/engine.py for the dispatcher
and README.md for the API contract.
"""

from __future__ import annotations

import json
import logging
import time
from collections import defaultdict

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse

from .auth import AuthError, verify_token
from .config import settings
from .extract.base import ExtractContext, Unscannable
from .extract.engine import extract_stream
from .spool import SeekableSpool

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("extract-service")

app = FastAPI(title="aavishield-extract-service")

VERSION = "1.0.0"

_metrics = {
    "extract_scans_total": 0,
    "extract_auth_failures_total": 0,
}
_unscannable_by_reason: dict[str, int] = defaultdict(int)


@app.get("/healthz")
async def healthz():
    return {"status": "ok", "service": "extract-service", "version": VERSION}


@app.get("/metrics")
async def metrics():
    lines = [f"{k} {v}" for k, v in _metrics.items()]
    for reason, count in _unscannable_by_reason.items():
        lines.append(f'extract_unscannable_total{{reason="{reason}"}} {count}')
    return Response("\n".join(lines) + "\n", media_type="text/plain")


def _truthy(v: str | None, default: bool) -> bool:
    if v is None:
        return default
    return v.strip().lower() not in ("0", "false", "no", "off")


@app.post("/v1/extract")
async def extract(request: Request):
    org_id = request.query_params.get("org_id", "")
    filename = request.query_params.get("filename", "")
    content_type = request.query_params.get("content_type", "")
    ocr_requested = _truthy(request.query_params.get("ocr"), settings.ocr_enabled_default)
    images_requested = _truthy(request.query_params.get("images"), True)
    try:
        deadline_ms = int(request.query_params.get("deadline_ms") or settings.default_deadline_ms)
    except ValueError:
        deadline_ms = settings.default_deadline_ms

    try:
        verify_token(request.headers.get("authorization"), org_id)
    except AuthError as exc:
        _metrics["extract_auth_failures_total"] += 1
        return JSONResponse({"error": str(exc)}, status_code=401)

    # Spool the inbound body to a temp file (memory only up to
    # spool_memory_bytes) — mirrors admin-api's own spoolBody and the
    # agent's SPOOL_MEMORY convention, so a huge upload never has to live
    # fully in this process's RAM just to be received.
    spool = SeekableSpool(max_size=settings.spool_memory_bytes)
    size = 0
    async for chunk in request.stream():
        spool.write(chunk)
        size += len(chunk)
    spool.seek(0)

    ctx = ExtractContext(
        max_depth=settings.max_depth,
        max_entries=settings.max_entries,
        max_expansion_ratio=settings.max_expansion_ratio,
        max_total_bytes=max(settings.max_total_bytes, size * settings.max_expansion_ratio),
        part_deadline_ms=settings.part_deadline_ms,
        deadline_at=time.monotonic() + deadline_ms / 1000,
        ocr_enabled=ocr_requested,
        images_enabled=images_requested,
        ocr_langs=settings.ocr_langs,
        max_images_returned=settings.max_images_returned,
        min_image_dimension=settings.min_image_dimension,
        ocr_max_pages=settings.ocr_max_pages,
        ocr_max_images=settings.ocr_max_images,
        ocr_dpi=settings.ocr_dpi,
        ocr_text_threshold=settings.ocr_text_threshold,
        ocr_per_image_timeout_s=settings.ocr_per_image_timeout_s,
        input_bytes=size,
    )
    _metrics["extract_scans_total"] += 1

    def gen():
        # A plain (sync) generator — Starlette runs it via
        # iterate_in_threadpool, which is exactly right here: extraction is
        # CPU/IO-bound synchronous work (zipfile, tesseract subprocess,
        # pypdfium2), and running it in the event loop thread would stall
        # every other in-flight request on this worker.
        seq = 0
        start = time.monotonic()
        try:
            for item in extract_stream(spool, filename, content_type, ctx):
                seq += 1
                if isinstance(item, Unscannable):
                    _unscannable_by_reason[item.reason] += 1
                yield (json.dumps(item.to_dict(seq)) + "\n").encode("utf-8")
        except Exception as exc:  # noqa: BLE001 - never let a bug mid-stream
                                   # drop the connection without a summary
                                   # line the caller can act on.
            log.exception("extraction aborted for %s", filename)
            yield (json.dumps({"kind": "unscannable", "seq": seq + 1, "part": filename,
                                "reason": "corrupt", "detail": str(exc)}) + "\n").encode("utf-8")
        finally:
            spool.close()

        summary = {
            "kind": "summary", "parts": seq, "bytes_in": size, "complete": True,
            "elapsed_ms": int((time.monotonic() - start) * 1000),
            "ocr_pages": ctx.ocr_pages, "ocr_images": ctx.ocr_images, "images": ctx.images_emitted,
        }
        yield (json.dumps(summary) + "\n").encode("utf-8")

    return StreamingResponse(gen(), media_type="application/x-ndjson")
