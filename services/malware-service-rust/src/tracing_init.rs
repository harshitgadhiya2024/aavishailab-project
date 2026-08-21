//! Wires this service into the shared Tempo backend (infra/tempo) via
//! OpenTelemetry — the Rust counterpart to services/admin-api/internal/tracing
//! (Go) and app/tracing.py (the Python services this replaced). This service
//! makes no outbound calls of its own — it's stateless compute called by
//! admin-api — so only inbound span creation + trace-context extraction is
//! needed, not outbound propagation.

use opentelemetry::global;
use opentelemetry::trace::TracerProvider as _;
use opentelemetry_otlp::WithExportConfig;
use opentelemetry_sdk::propagation::TraceContextPropagator;
use opentelemetry_sdk::runtime;
use opentelemetry_sdk::trace::span_processor_with_async_runtime::BatchSpanProcessor;
use opentelemetry_sdk::trace::SdkTracerProvider;
use opentelemetry_sdk::Resource;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::EnvFilter;

/// Sets up the global tracer + a tracing_subscriber that both prints to
/// stdout (unchanged local-dev behavior) and exports spans to Tempo. Never
/// panics: an unreachable collector or bad config means spans don't export,
/// not that the service refuses to start — observability infra being down
/// must never take the product down with it.
pub fn init(service_name: &str) {
    let base = std::env::var("OTEL_EXPORTER_OTLP_ENDPOINT").unwrap_or_else(|_| "http://tempo:6318".to_string());
    let endpoint = format!("{}/v1/traces", base.trim_end_matches('/'));

    let fmt_layer = tracing_subscriber::fmt::layer();
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

    match opentelemetry_otlp::SpanExporter::builder().with_http().with_endpoint(endpoint.clone()).build() {
        Ok(exporter) => {
            // The plain with_batch_exporter() shorthand spawns its background
            // export task on a bare OS thread with no Tokio reactor attached —
            // any exporter that needs async I/O (this one does, HTTP POSTs to
            // Tempo) then panics on its first flush ("no reactor running").
            // BatchSpanProcessor::builder(..., runtime::Tokio) spawns that task
            // via tokio::spawn instead, inheriting this process's own runtime.
            let batch = BatchSpanProcessor::builder(exporter, runtime::Tokio).build();
            let provider = SdkTracerProvider::builder()
                .with_span_processor(batch)
                .with_resource(Resource::builder().with_service_name(service_name.to_string()).build())
                .build();
            let tracer = provider.tracer(service_name.to_string());
            global::set_tracer_provider(provider);
            global::set_text_map_propagator(TraceContextPropagator::new());

            tracing_subscriber::registry().with(filter).with(fmt_layer).with(tracing_opentelemetry::layer().with_tracer(tracer)).init();

            tracing::info!(%endpoint, "tracing: exporting spans");
        }
        Err(e) => {
            // No OTel layer in this case — plain stdout logging only, same
            // as before this file existed.
            tracing_subscriber::registry().with(filter).with(fmt_layer).init();
            tracing::warn!(error = %e, "tracing: could not init OTLP exporter — continuing without it");
        }
    }
}
