//! Extracts the incoming `traceparent` header (set by admin-api's
//! instrumented outbound client — see internal/dlpclient in admin-api) and
//! parents this request's span on it, so this hop joins the caller's trace
//! instead of starting a disconnected one.

use axum::extract::Request;
use axum::middleware::Next;
use axum::response::Response;
use opentelemetry::global;
use opentelemetry_http::HeaderExtractor;
use tracing::Instrument;
use tracing_opentelemetry::OpenTelemetrySpanExt;

pub async fn trace_context(req: Request, next: Next) -> Response {
    let parent_cx = global::get_text_map_propagator(|propagator| propagator.extract(&HeaderExtractor(req.headers())));

    let method = req.method().clone();
    let path = req.uri().path().to_string();
    let span = tracing::info_span!("http_request", %method, %path);
    // A malformed/missing traceparent header just means this span starts
    // its own trace rather than joining one — not a request failure.
    let _ = span.set_parent(parent_cx);

    next.run(req).instrument(span).await
}
