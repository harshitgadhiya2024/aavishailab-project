//! Real HTTP tests through the full axum stack (routing, auth, JSON
//! serialization) — a faithful port of tests/test_api.py, using
//! tower::ServiceExt::oneshot the way Python's test used Starlette's
//! TestClient.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use dlp_service::config::Config;
use dlp_service::{auth::mint_token, build_router, AppState, Metrics};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use std::sync::Arc;
use tower::ServiceExt;

const ORG_A: &str = "11111111-1111-1111-1111-111111111111";
const ORG_B: &str = "22222222-2222-2222-2222-222222222222";
const CARD: &str = "4242424242424242";
const AWS: &str = "AKIAIOSFODNN7EXAMPLE";
const SECRET: &str = "test-secret-123";

fn b64(s: &str) -> String {
    BASE64_STANDARD.encode(s.as_bytes())
}

fn app() -> axum::Router {
    let state = Arc::new(AppState { config: Config::for_test(SECRET), metrics: Metrics::default() });
    build_router(state)
}

fn default_policy() -> Value {
    json!({
        "name": "Default DLP",
        "action": "block",
        "detectors": ["credit_card", "aws_key", "generic_api_key", "aadhaar"],
        "keywords": ["confidential"],
    })
}

fn scan_body(text: Option<&str>, content_b64: Option<&str>, org: &str, policies: Option<Value>) -> Value {
    let mut body = json!({
        "org_id": org,
        "policies": policies.unwrap_or_else(|| json!([default_policy()])),
    });
    if let Some(t) = text {
        body["text"] = json!(t);
    }
    if let Some(c) = content_b64 {
        body["content_b64"] = json!(c);
    }
    body
}

fn token(org: &str) -> String {
    mint_token(org, 300, SECRET)
}

async fn post_scan(body: Value, auth_header: Option<&str>) -> (StatusCode, Value) {
    let mut req = Request::builder().method("POST").uri("/v1/scan").header("content-type", "application/json");
    if let Some(h) = auth_header {
        req = req.header("authorization", h);
    }
    let req = req.body(Body::from(serde_json::to_vec(&body).unwrap())).unwrap();
    let resp = app().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let json: Value = if bytes.is_empty() { json!(null) } else { serde_json::from_slice(&bytes).unwrap() };
    (status, json)
}

#[tokio::test]
async fn test_healthz() {
    let resp = app().oneshot(Request::builder().uri("/healthz").body(Body::empty()).unwrap()).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["status"], "ok");
}

#[tokio::test]
async fn test_scan_credit_card_alerts() {
    let body = scan_body(None, Some(&b64(&format!("card {CARD}"))), ORG_A, None);
    let auth = format!("Bearer {}", token(ORG_A));
    let (status, json) = post_scan(body, Some(&auth)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["matched"], true);
    assert_eq!(json["band"], "alert");
    assert_eq!(json["action"], "alert");
    assert_eq!(json["score"], 55);
    assert_eq!(json["thresholds"], json!({"block": 80, "alert": 50}));
    // Response must never leak the raw card number.
    let raw = serde_json::to_string(&json).unwrap();
    assert!(!raw.contains(CARD));
    assert!(json["matches"][0]["masked_preview"].as_str().unwrap().ends_with("4242"));
}

#[tokio::test]
async fn test_scan_aws_key_blocks() {
    let body = scan_body(None, Some(&b64(&format!("secret {AWS}"))), ORG_A, None);
    let auth = format!("Bearer {}", token(ORG_A));
    let (status, json) = post_scan(body, Some(&auth)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["action"], "block");
}

#[tokio::test]
async fn test_scan_clean_allows() {
    let body = scan_body(None, Some(&b64("hello team, lunch at noon?")), ORG_A, None);
    let auth = format!("Bearer {}", token(ORG_A));
    let (status, json) = post_scan(body, Some(&auth)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["matched"], false);
    assert_eq!(json["action"], "allow");
}

#[tokio::test]
async fn test_inline_text_path() {
    // The dashboard "test a sample" path uses `text` instead of content_b64.
    let body = scan_body(Some(&format!("here is {CARD}")), None, ORG_A, None);
    let auth = format!("Bearer {}", token(ORG_A));
    let (status, json) = post_scan(body, Some(&auth)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["band"], "alert");
}

#[tokio::test]
async fn test_missing_token_rejected() {
    let body = scan_body(None, Some(&b64(CARD)), ORG_A, None);
    let (status, _) = post_scan(body, None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_wrong_org_token_rejected() {
    // Token minted for ORG_B, but request claims ORG_A.
    let body = scan_body(None, Some(&b64(CARD)), ORG_A, None);
    let auth = format!("Bearer {}", token(ORG_B));
    let (status, _) = post_scan(body, Some(&auth)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_expired_token_rejected() {
    let body = scan_body(None, Some(&b64(CARD)), ORG_A, None);
    let auth = format!("Bearer {}", mint_token(ORG_A, -10, SECRET));
    let (status, _) = post_scan(body, Some(&auth)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_tampered_signature_rejected() {
    let good = mint_token(ORG_A, 300, SECRET);
    let forged = mint_token(ORG_A, 300, "attacker-guess");
    let body = scan_body(None, Some(&b64(CARD)), ORG_A, None);
    let auth = format!("Bearer {forged}");
    let (status, _) = post_scan(body, Some(&auth)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_ne!(good, forged);
}

#[tokio::test]
async fn test_oversize_rejected() {
    // Build a state with a tiny max_scan_size directly, instead of the
    // Python test's `monkeypatch.setattr(settings, ...)` — Config is a
    // plain injected struct here, not a mutable global, so this is the
    // natural way to override it per-test.
    let mut cfg = Config::for_test(SECRET);
    cfg.max_scan_size = 16;
    let state = Arc::new(AppState { config: cfg, metrics: Metrics::default() });
    let app = build_router(state);

    let big = b64(&"x".repeat(100));
    let body = scan_body(None, Some(&big), ORG_A, None);
    let auth = format!("Bearer {}", token(ORG_A));
    let req = Request::builder()
        .method("POST")
        .uri("/v1/scan")
        .header("content-type", "application/json")
        .header("authorization", auth)
        .body(Body::from(serde_json::to_vec(&body).unwrap()))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::PAYLOAD_TOO_LARGE);
}

#[tokio::test]
async fn test_bad_base64_rejected() {
    let body = scan_body(None, Some("!!!not base64!!!"), ORG_A, None);
    let auth = format!("Bearer {}", token(ORG_A));
    let (status, _) = post_scan(body, Some(&auth)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_binary_upload_does_not_crash() {
    let raw: Vec<u8> = (0u16..256).map(|b| b as u8).collect();
    let encoded = BASE64_STANDARD.encode(&raw);
    let body = scan_body(None, Some(&encoded), ORG_A, None);
    let auth = format!("Bearer {}", token(ORG_A));
    let (status, _) = post_scan(body, Some(&auth)).await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn test_metrics_is_plain_text_not_json_encoded() {
    let resp = app().oneshot(Request::builder().uri("/metrics").body(Body::empty()).unwrap()).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let content_type = resp.headers().get("content-type").unwrap().to_str().unwrap().to_string();
    assert!(content_type.starts_with("text/plain"));
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let body = String::from_utf8(bytes.to_vec()).unwrap();
    assert!(!body.trim_start().starts_with('"'));
    assert!(!body.contains("\\n"));
    assert!(body.contains("dlp_scans_total"));
}

// ─── Extra coverage beyond the Python suite ─────────────────────────────────

#[tokio::test]
async fn test_null_lists_treated_as_empty() {
    // A Go `nil` slice marshals as JSON `null` — this must not 422/400, it
    // must behave exactly like an empty list. This is the whole reason
    // schemas.rs has a custom deserializer instead of plain #[serde(default)].
    let body = json!({
        "org_id": ORG_A,
        "content_b64": b64("nothing sensitive here"),
        "policies": [{
            "name": "p",
            "action": "block",
            "detectors": null,
            "keywords": null,
            "custom_patterns": null,
            "bypass_file_types": null,
            "detector_weights": null,
        }],
    });
    let auth = format!("Bearer {}", token(ORG_A));
    let (status, json) = post_scan(body, Some(&auth)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["matched"], false);
}

#[tokio::test]
async fn test_empty_policies_list_allows() {
    let body = scan_body(None, Some(&b64(CARD)), ORG_A, Some(json!([])));
    let auth = format!("Bearer {}", token(ORG_A));
    let (status, json) = post_scan(body, Some(&auth)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["matched"], false);
    assert_eq!(json["action"], "allow");
}
