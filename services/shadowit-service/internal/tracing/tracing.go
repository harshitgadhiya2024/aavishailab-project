// Package tracing wires this service into the shared Tempo backend
// (infra/tempo) via OpenTelemetry. Before this, the only cross-service
// visibility was Prometheus counters per service — no way to see, for one
// slow or failed request, the whole hop chain (admin-api -> dlp-service ->
// ClamAV, or admin-api -> ai-service -> the LLM provider) in one place.
//
// Every service in this stack that talks to another service should call
// Init at startup and wrap its outbound http.Client's Transport with
// otelhttp.NewTransport, so the trace context (the W3C traceparent header)
// actually propagates end-to-end rather than each service starting its own
// disconnected trace.
package tracing

import (
	"context"
	"log"
	"os"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

// Init configures the global TracerProvider and propagator for serviceName,
// exporting spans to OTEL_EXPORTER_OTLP_ENDPOINT (default: Tempo's OTLP/HTTP
// receiver on the shared Docker network). Returns a shutdown func to call
// on exit — flushes any buffered spans rather than dropping them.
//
// Never fails startup: an unreachable collector means spans queue and
// eventually drop, not that the service refuses to boot. Observability
// infrastructure being down must never take the product down with it.
func Init(serviceName string) func(context.Context) error {
	endpoint := os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
	if endpoint == "" {
		endpoint = "tempo:6318"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	exporter, err := otlptracehttp.New(ctx,
		otlptracehttp.WithEndpoint(endpoint),
		otlptracehttp.WithInsecure(), // plain HTTP inside the Docker network, same trust boundary as every other internal call here
	)
	if err != nil {
		// Exporter construction itself doesn't dial anything — this only
		// fails on bad config (a malformed endpoint), which is a real setup
		// mistake worth a log line, but still not worth crashing the
		// service over. Leaving the global TracerProvider unset here means
		// every span created afterward is OTel's own no-op tracer — cheap,
		// safe, and exactly what "tracing is unavailable" should look like.
		log.Printf("tracing: could not init OTLP exporter (%v) — spans will not be exported", err)
		return func(context.Context) error { return nil }
	}

	res, _ := resource.New(ctx,
		resource.WithAttributes(semconv.ServiceName(serviceName)),
	)

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(res),
		// Every request traced, not sampled — this stack's traffic volume
		// doesn't need head-based sampling yet, and under-sampling would
		// undermine the exact thing this exists for: seeing the one request
		// that actually failed.
		sdktrace.WithSampler(sdktrace.AlwaysSample()),
	)
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))

	return tp.Shutdown
}
