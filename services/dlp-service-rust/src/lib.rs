//! AaviShield DLP microservice — Rust/axum port of the FastAPI service.
//!
//! Stateless: it holds no database and persists nothing. It receives
//! content + the org's DLP policy config, returns a weighted sensitivity
//! score and a decision band (block / alert / allow). admin-api owns event
//! logging and the agent contract; this service is pure compute you can
//! scale horizontally.
//!
//! See detectors.rs for what actually changed vs. the Python original and
//! why (zero-copy scanning, linear-time regex, no per-request compile).
//!
//! Split into lib.rs + a thin main.rs specifically so the integration
//! tests in tests/api.rs can build the real router (via `build_router`)
//! against an in-memory `Config`, the same way the Python suite's
//! `TestClient(app)` exercises the full ASGI stack.

pub mod auth;
pub mod config;
pub mod detectors;
pub mod scoring;
pub mod schemas;

use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use config::Config;
use schemas::{ErrorResponse, MatchOut, ScanRequest, ScanResponse};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

pub const VERSION: &str = "1.0.0";

#[derive(Default)]
pub struct Metrics {
    pub scans_total: AtomicU64,
    pub blocked_total: AtomicU64,
    pub alerted_total: AtomicU64,
    pub auth_failures_total: AtomicU64,
}

pub struct AppState {
    pub config: Config,
    pub metrics: Metrics,
}

pub type SharedState = Arc<AppState>;

pub fn build_router(state: SharedState) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route("/metrics", get(metrics))
        .route("/v1/scan", post(scan))
        .with_state(state)
        // axum applies a 2MB request body cap by default; Starlette/FastAPI
        // has no such framework-level default, and app/config.py's
        // DLP_MAX_SCAN_SIZE (20MB default) is meant to be the one and only
        // size ceiling — enforced explicitly in decode_content below, after
        // base64 decoding, exactly where the Python original checks it.
        // Disabling this keeps that single-source-of-truth behavior instead
        // of silently adding a second, smaller, undocumented limit.
        .layer(DefaultBodyLimit::disable())
}

async fn healthz() -> Json<serde_json::Value> {
    Json(serde_json::json!({"status": "ok", "service": "dlp-service", "version": VERSION}))
}

async fn metrics(State(state): State<SharedState>) -> impl IntoResponse {
    let m = &state.metrics;
    let body = format!(
        "dlp_scans_total {}\ndlp_blocked_total {}\ndlp_alerted_total {}\ndlp_auth_failures_total {}\n",
        m.scans_total.load(Ordering::Relaxed),
        m.blocked_total.load(Ordering::Relaxed),
        m.alerted_total.load(Ordering::Relaxed),
        m.auth_failures_total.load(Ordering::Relaxed),
    );
    ([("content-type", "text/plain")], body)
}

pub enum ScanError {
    Unauthorized(String),
    BadRequest(String),
    TooLarge,
}

impl IntoResponse for ScanError {
    fn into_response(self) -> Response {
        let (status, msg) = match self {
            ScanError::Unauthorized(m) => (StatusCode::UNAUTHORIZED, m),
            ScanError::BadRequest(m) => (StatusCode::BAD_REQUEST, m),
            ScanError::TooLarge => (StatusCode::PAYLOAD_TOO_LARGE, "Content too large to scan".to_string()),
        };
        (status, Json(ErrorResponse { error: msg })).into_response()
    }
}

/// Mirrors _decode_content in app/main.py: exactly one of text/content_b64
/// is used, each with its own size ceiling check, and base64 output is
/// decoded as UTF-8 lossily (sensitive identifiers are ASCII, so a lossy
/// decode is fine and avoids choking on binary uploads — an image with an
/// embedded key still scans).
fn decode_content(req: &ScanRequest, cfg: &Config) -> Result<String, ScanError> {
    if let Some(text) = &req.text {
        if text.len() > cfg.max_scan_size {
            return Err(ScanError::TooLarge);
        }
        return Ok(text.clone());
    }

    let Some(b64) = &req.content_b64 else { return Ok(String::new()) };
    if b64.is_empty() {
        return Ok(String::new());
    }
    let raw = BASE64_STANDARD
        .decode(b64)
        .map_err(|_| ScanError::BadRequest("content_b64 is not valid base64".to_string()))?;
    if raw.len() > cfg.max_scan_size {
        return Err(ScanError::TooLarge);
    }
    Ok(String::from_utf8_lossy(&raw).into_owned())
}

fn policy_from_in(p: schemas::PolicyIn) -> scoring::Policy {
    scoring::Policy {
        name: p.name,
        action: p.action,
        detectors: p.detectors,
        keywords: p.keywords,
        custom_patterns: p
            .custom_patterns
            .into_iter()
            .map(|cp| detectors::CustomPattern { name: cp.name, regex: cp.regex })
            .collect(),
        bypass_file_types: p.bypass_file_types,
        detector_weights: p.detector_weights,
        block_threshold: p.block_threshold,
        alert_threshold: p.alert_threshold,
        priority: p.priority,
    }
}

async fn scan(State(state): State<SharedState>, headers: HeaderMap, body: Bytes) -> Response {
    // Parse JSON manually (rather than via an axum Json<ScanRequest>
    // extractor) so a malformed body and an auth failure can't race for
    // which error the client sees, and so we control the exact 400 shape.
    let req: ScanRequest = match serde_json::from_slice(&body) {
        Ok(r) => r,
        Err(e) => return ScanError::BadRequest(format!("invalid request body: {e}")).into_response(),
    };

    let auth_header = headers.get("authorization").and_then(|v| v.to_str().ok());
    if let Err(e) = auth::verify_token(auth_header, &req.org_id, &state.config.service_secret, state.config.require_auth) {
        state.metrics.auth_failures_total.fetch_add(1, Ordering::Relaxed);
        return ScanError::Unauthorized(e.message().to_string()).into_response();
    }

    let text = match decode_content(&req, &state.config) {
        Ok(t) => t,
        Err(e) => return e.into_response(),
    };
    let policies: Vec<scoring::Policy> = req.policies.into_iter().map(policy_from_in).collect();

    let result = scoring::scan(&policies, &text, &req.filename, &req.content_type, &state.config);

    state.metrics.scans_total.fetch_add(1, Ordering::Relaxed);
    match result.action.as_str() {
        "block" => {
            state.metrics.blocked_total.fetch_add(1, Ordering::Relaxed);
        }
        "alert" => {
            state.metrics.alerted_total.fetch_add(1, Ordering::Relaxed);
        }
        _ => {}
    }

    let reason = if result.matched {
        result
            .matches
            .first()
            .map(|m| format!("Sensitive company data detected: {}", m.label))
            .unwrap_or_default()
    } else {
        String::new()
    };

    let mut detector_set: Vec<String> = result.matches.iter().map(|m| m.detector.clone()).collect();
    detector_set.sort();
    detector_set.dedup();

    let mut thresholds = HashMap::new();
    thresholds.insert("block".to_string(), result.block_threshold);
    thresholds.insert("alert".to_string(), result.alert_threshold);

    let resp = ScanResponse {
        scanned: true,
        matched: result.matched,
        score: result.score,
        band: result.band,
        action: result.action,
        policy_name: result.policy_name,
        reason,
        detectors: detector_set,
        matches: result
            .matches
            .into_iter()
            .map(|m| MatchOut { detector: m.detector, label: m.label, masked_preview: m.preview, weight: m.weight })
            .collect(),
        thresholds,
    };

    (StatusCode::OK, Json(resp)).into_response()
}
