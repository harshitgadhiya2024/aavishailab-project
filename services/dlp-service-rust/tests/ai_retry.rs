//! The AI client's resilience against a fake OpenRouter: transient errors are
//! retried, a dead model falls through to the next in the chain, and every
//! request carries the privacy and no-reasoning settings.

use axum::routing::post;
use dlp_service::ai::{Ai, AiConfig};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const SALARY: &str = r#"{"sensitive": true, "categories": ["salary_data"], "confidence": 95, "evidence": "pay table"}"#;

/// Behaviour per model id: "dead" always 400, "flaky" answers 429 twice
/// (with Retry-After: 0) then succeeds, anything else succeeds.
async fn fake_openrouter(seen: Arc<Mutex<Vec<Value>>>) -> String {
    let app = axum::Router::new().route(
        "/chat/completions",
        post(move |body: axum::Json<Value>| {
            let seen = seen.clone();
            async move {
                let model = body.0["model"].as_str().unwrap_or_default().to_string();
                let flaky_calls = {
                    let mut s = seen.lock().unwrap();
                    s.push(body.0.clone());
                    s.iter().filter(|b| b["model"] == "flaky").count()
                };
                let ok = || (axum::http::StatusCode::OK, [("retry-after", "0")], axum::Json(json!({"choices": [{"message": {"content": SALARY}}]})));
                match model.as_str() {
                    "dead" => (axum::http::StatusCode::BAD_REQUEST, [("retry-after", "0")], axum::Json(json!({"error": "not a valid model"}))),
                    "flaky" if flaky_calls <= 2 => (axum::http::StatusCode::TOO_MANY_REQUESTS, [("retry-after", "0")], axum::Json(json!({"error": "rate limited"}))),
                    _ => ok(),
                }
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    format!("http://{addr}")
}

fn config(base_url: String, text_models: &[&str]) -> AiConfig {
    AiConfig {
        base_url,
        api_key: "k".into(),
        text_models: text_models.iter().map(|m| m.to_string()).collect(),
        vision_models: vec!["v".into()],
        audio_models: vec!["a".into()],
        text_daily_cap: 1000,
        vision_daily_cap: 1000,
        audio_daily_cap: 1000,
        text_cache_ttl: 60,
        vision_cache_ttl: 60,
        audio_cache_ttl: 60,
        max_text_chars: 24_000,
        audio_max_bytes: 1 << 20,
        timeout: Duration::from_secs(5),
        max_retries: 3,
        redis_url: None,
    }
}

#[tokio::test]
async fn rate_limits_are_retried_on_the_same_model() {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let ai = Ai::new(config(fake_openrouter(seen.clone()).await, &["flaky", "backup"]));
    let v = ai.classify_text("org", "salary sheet").await;
    assert!(v.sensitive, "the third attempt on the primary succeeds");
    let models: Vec<String> = seen.lock().unwrap().iter().map(|b| b["model"].as_str().unwrap().to_string()).collect();
    assert_eq!(models, vec!["flaky", "flaky", "flaky"], "no fallback needed when a retry succeeds");
}

#[tokio::test]
async fn a_dead_model_falls_through_to_the_next() {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let ai = Ai::new(config(fake_openrouter(seen.clone()).await, &["dead", "backup"]));
    let v = ai.classify_text("org", "salary sheet").await;
    assert!(v.sensitive, "the fallback model answers");
    let bodies = seen.lock().unwrap().clone();
    let models: Vec<&str> = bodies.iter().map(|b| b["model"].as_str().unwrap()).collect();
    assert_eq!(models, vec!["dead", "backup"], "a permanent 400 is not retried");
    // OpenRouter gets the remaining chain for its own upstream failover.
    assert_eq!(bodies[0]["models"], json!(["dead", "backup"]));
    assert_eq!(bodies[1]["models"], json!(["backup"]));
    for b in &bodies {
        assert_eq!(b["reasoning"]["enabled"], json!(false));
        assert_eq!(b["provider"]["data_collection"], json!("deny"));
        assert_eq!(b["temperature"], json!(0.0));
    }
}

#[tokio::test]
async fn every_model_failing_degrades_to_not_sensitive() {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let ai = Ai::new(config(fake_openrouter(seen.clone()).await, &["dead"]));
    let v = ai.classify_text("org", "salary sheet").await;
    assert!(!v.sensitive, "an AI outage never blocks or errors DLP");
}
