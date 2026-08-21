"""Wires this service into the shared Tempo backend (infra/tempo) via
OpenTelemetry — the Python counterpart to services/admin-api/internal/tracing.
Every service that talks to another service instruments both its inbound
(FastAPI) and outbound (httpx) traffic, so the trace context (the W3C
traceparent header) actually propagates end-to-end into one connected
trace instead of each service starting its own.
"""

from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)


def setup_tracing(app, service_name: str) -> None:
    """Instruments `app` (a FastAPI instance) for both inbound request spans
    and outbound httpx spans. Never raises — an unreachable collector or a
    missing OTel package must not stop the service from starting; spans
    just don't get created/exported, which is the correct degraded state,
    not a crash.
    """
    try:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
        from opentelemetry.sdk.resources import SERVICE_NAME, Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor

        # OTEL_EXPORTER_OTLP_ENDPOINT is conventionally a bare scheme://host:port
        # (matches the Go services' OTLP endpoint convention) — /v1/traces is
        # appended here since passing `endpoint` directly to OTLPSpanExporter
        # skips the auto-path-append the env-var-only config path would do.
        base = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://tempo:6318")
        endpoint = base.rstrip("/") + "/v1/traces"

        provider = TracerProvider(resource=Resource.create({SERVICE_NAME: service_name}))
        provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=endpoint)))
        trace.set_tracer_provider(provider)

        FastAPIInstrumentor.instrument_app(app)
        HTTPXClientInstrumentor().instrument()

        logger.info("tracing: exporting spans for %s to %s", service_name, endpoint)
    except Exception as exc:  # noqa: BLE001 - deliberately broad, see docstring
        logger.warning("tracing: could not initialize OpenTelemetry (%s) — continuing without it", exc)
