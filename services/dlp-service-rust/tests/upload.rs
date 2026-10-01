//! POST /v1/scan-upload end to end through the real router: inspection,
//! extraction, detectors, the AI tier (against a fake OpenAI-compatible
//! server, so no paid call is ever made) and `on_unscannable`.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::routing::post;
use dlp_service::ai::{Ai, AiConfig};
use dlp_service::config::Config;
use dlp_service::{auth::mint_token, build_router, AppState};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use std::io::{Cursor, Write};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tower::ServiceExt;

const ORG: &str = "11111111-1111-1111-1111-111111111111";
const SECRET: &str = "test-secret-123";
const CHROME: &str = "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

/// A stand-in for OpenRouter: says "salary" text is salary data, every
/// image is a PAN card, everything else is fine.
async fn fake_llm(calls: Arc<AtomicUsize>) -> String {
    let app = axum::Router::new().route(
        "/chat/completions",
        post(move |body: axum::Json<Value>| async move {
            calls.fetch_add(1, Ordering::SeqCst);
            let msgs = body.0["messages"].to_string();
            let content = if msgs.contains("image_url") {
                r#"{"sensitive": true, "doc_type": "pan_card", "confidence": 90, "evidence": "PAN card layout"}"#
            } else if msgs.to_lowercase().contains("salary") {
                r#"{"sensitive": true, "categories": ["salary_data"], "confidence": 95, "evidence": "pay table"}"#
            } else {
                r#"{"sensitive": false, "categories": ["none"], "confidence": 5, "evidence": ""}"#
            };
            axum::Json(json!({"choices": [{"message": {"content": content}}]}))
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    format!("http://{addr}")
}

fn ai_config(base_url: String) -> AiConfig {
    AiConfig {
        base_url,
        api_key: "k".into(),
        text_models: vec!["t".into()],
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
        max_retries: 1,
        redis_url: None,
    }
}

/// The router, and how many LLM calls it has made.
async fn app_counting(with_ai: bool) -> (axum::Router, Arc<AtomicUsize>) {
    let calls = Arc::new(AtomicUsize::new(0));
    let mut state = AppState::new(Config::for_test(SECRET));
    if with_ai {
        state.ai = Some(Arc::new(Ai::new(ai_config(fake_llm(calls.clone()).await))));
    }
    (build_router(Arc::new(state)), calls)
}

async fn app(with_ai: bool) -> axum::Router {
    app_counting(with_ai).await.0
}

fn default_policy() -> Value {
    json!({
        "name": "Automatic DLP (default)", "action": "block", "priority": 1000,
        "detectors": ["credit_card", "pan_india", "aadhaar", "aws_key", "github_token", "generic_api_key",
                      "source_code", "ai_text", "ai_visual", "ai_audio"],
        "block_threshold": 80, "alert_threshold": 50,
    })
}

struct Req<'a> {
    host: &'a str,
    path: &'a str,
    content_type: &'a str,
    body: Vec<u8>,
    policy: Value,
}

async fn send(app: axum::Router, r: Req<'_>, token: Option<String>) -> (StatusCode, Value) {
    let request = json!({
        "org_id": ORG, "host": r.host, "path": r.path, "method": "POST", "content_type": r.content_type,
        "filename": r.path.rsplit('/').next().unwrap_or(""), "user_agent": CHROME, "policies": [r.policy],
    });
    let mut body = Vec::new();
    write!(body, "--B\r\nContent-Disposition: form-data; name=\"request\"\r\nContent-Type: application/json\r\n\r\n{request}\r\n").unwrap();
    write!(body, "--B\r\nContent-Disposition: form-data; name=\"body\"; filename=\"body\"\r\nContent-Type: application/octet-stream\r\n\r\n").unwrap();
    body.extend_from_slice(&r.body);
    body.extend_from_slice(b"\r\n--B--\r\n");
    let mut req = Request::post("/v1/scan-upload").header("content-type", "multipart/form-data; boundary=B");
    if let Some(t) = token {
        req = req.header("authorization", format!("Bearer {t}"));
    }
    let resp = app.oneshot(req.body(Body::from(body)).unwrap()).await.unwrap();
    let status = resp.status();
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

fn token() -> Option<String> {
    Some(mint_token(ORG, 300, SECRET))
}

fn zip_of(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut w = zip::ZipWriter::new(Cursor::new(Vec::new()));
    for (name, data) in entries {
        w.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
        w.write_all(data).unwrap();
    }
    w.finish().unwrap().into_inner()
}

fn docx(text: &str) -> Vec<u8> {
    let doc = format!(r#"<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:body></w:document>"#);
    zip_of(&[("word/document.xml", doc.as_bytes())])
}

fn multipart_file(name: &str, data: &[u8]) -> Vec<u8> {
    [
        b"--X\r\nContent-Disposition: form-data; name=\"csrf\"\r\n\r\nabc\r\n".to_vec(),
        format!("--X\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\nContent-Type: application/octet-stream\r\n\r\n").into_bytes(),
        data.to_vec(),
        b"\r\n--X--\r\n".to_vec(),
    ]
    .concat()
}

#[tokio::test]
async fn background_traffic_is_neither_scanned_nor_sent_to_the_llm() {
    let (app, calls) = app_counting(true).await;
    let (status, v) = send(
        app,
        Req { host: "play.google.com", path: "/log", content_type: "application/x-www-form-urlencoded", body: b"a=4111111111111111&salary=1".to_vec(), policy: default_policy() },
        token(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(v["verdict"], Value::Null);
    assert_eq!(v["inspection"]["relevant"], false);
    assert_eq!(v["inspection"]["skip_reason"], "background_traffic");
    assert_eq!(calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn card_inside_an_uploaded_docx_is_found() {
    let (status, v) = send(
        app(false).await,
        Req { host: "www.dropbox.com", path: "/upload", content_type: "multipart/form-data; boundary=X",
              body: multipart_file("cards.docx", &docx("corporate card 4111 1111 1111 1111")), policy: default_policy() },
        token(),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{v}");
    assert_eq!(v["inspection"]["kind"], "file");
    assert_eq!(v["inspection"]["filename"], "cards.docx");
    assert_eq!(v["verdict"]["matched"], true, "{v}");
    assert!(v["verdict"]["detectors"].as_array().unwrap().contains(&json!("credit_card")));
    // Masked, never the raw number.
    assert!(!v.to_string().contains("4111 1111 1111 1111"));
}

#[tokio::test]
async fn ai_flags_a_salary_message_no_pattern_would() {
    let body = json!({"content": "Salary revisions for Q3: Asha 1,20,000; Ravi 95,000", "clientmessageid": "1"}).to_string();
    let (_, v) = send(
        app(true).await,
        Req { host: "teams.microsoft.com", path: "/api/chatsvc/in/v1/users/ME/conversations/19:x/messages",
              content_type: "application/json", body: body.into_bytes(), policy: default_policy() },
        token(),
    )
    .await;
    assert_eq!(v["inspection"]["operation"], "Message sent");
    assert_eq!(v["verdict"]["matched"], true, "{v}");
    assert_eq!(v["verdict"]["detectors"], json!(["ai_text"]));
    assert!(v["verdict"]["previews"][0].as_str().unwrap().contains("salary_data"));
}

#[tokio::test]
async fn ai_tier_is_skipped_when_no_policy_enables_it() {
    let (app, calls) = app_counting(true).await;
    let mut policy = default_policy();
    policy["detectors"] = json!(["credit_card"]);
    let body = json!({"content": "salary sheet attached"}).to_string();
    let (_, v) = send(
        app,
        Req { host: "teams.microsoft.com", path: "/api/chatsvc/x/messages", content_type: "application/json", body: body.into_bytes(), policy },
        token(),
    )
    .await;
    assert_eq!(v["verdict"]["matched"], false);
    assert_eq!(calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn uploaded_photo_goes_to_the_vision_classifier() {
    let mut png = Vec::new();
    image::DynamicImage::new_rgb8(400, 250).write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png).unwrap();
    let (_, v) = send(
        app(true).await,
        Req { host: "files.oaiusercontent.com", path: "/file-abc", content_type: "image/png", body: png, policy: default_policy() },
        token(),
    )
    .await;
    assert_eq!(v["verdict"]["matched"], true, "{v}");
    assert_eq!(v["verdict"]["detectors"], json!(["ai_visual"]));
}

#[tokio::test]
async fn unscannable_parts_count_only_when_a_policy_says_so() {
    let mut w = zip::ZipWriter::new(Cursor::new(Vec::new()));
    w.start_file("k.txt", zip::write::SimpleFileOptions::default().with_aes_encryption(zip::AesMode::Aes256, "pw")).unwrap();
    w.write_all(b"secret").unwrap();
    let z = w.finish().unwrap().into_inner();

    let (_, v) = send(
        app(false).await,
        Req { host: "wetransfer.com", path: "/upload", content_type: "multipart/form-data; boundary=X", body: multipart_file("vault.zip", &z), policy: default_policy() },
        token(),
    )
    .await;
    assert_eq!(v["verdict"]["matched"], false, "no on_unscannable rule → nothing to report: {v}");

    let mut policy = default_policy();
    policy["on_unscannable"] = json!({"encrypted_archive": "block"});
    let (_, v) = send(
        app(false).await,
        Req { host: "wetransfer.com", path: "/upload", content_type: "multipart/form-data; boundary=X", body: multipart_file("vault.zip", &z), policy },
        token(),
    )
    .await;
    assert_eq!(v["verdict"]["matched"], true, "{v}");
    assert_eq!(v["verdict"]["action"], "block");
    assert_eq!(v["verdict"]["detectors"], json!(["unscannable:encrypted_archive"]));
}

#[tokio::test]
async fn a_request_without_a_valid_token_is_rejected_before_the_body_is_read() {
    let r = || Req { host: "x.com", path: "/upload", content_type: "text/csv", body: b"a".to_vec(), policy: default_policy() };
    let (status, _) = send(app(false).await, r(), None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, _) = send(app(false).await, r(), Some(mint_token(ORG, 300, "wrong-secret"))).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}
