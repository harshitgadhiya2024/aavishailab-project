//! Interactive, browser-driven enrollment — a port of Python's
//! `browser_enroll`/`_enroll_callback_handler`.
//!
//! The agent opens the employee portal in the system browser and listens on
//! a loopback port for a callback the portal page POSTs once the person has
//! signed in. This is what "Connect" does for a brand-new device that has
//! no pre-provisioned token — the alternative, unattended path
//! (`enroll::ensure_enrolled`) is for a token dropped onto the machine by
//! IT ahead of time, with nobody watching a window.

use crate::config::Config;
use crate::enroll::{enroll_with_token, EnrollError};
use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use hyper::body::Incoming;
use hyper::server::conn::http1 as server_http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use rand::RngCore;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tokio::net::TcpListener;
use tokio::sync::Notify;

/// The traditional fixed port, tried first so a returning user's bookmarked
/// `http://127.0.0.1:6119/` still leads somewhere; 0 (any free port) is the
/// fallback so a busy port — including one held by a sibling install of this
/// same agent — never turns into a permanently broken enrollment.
const PREFERRED_PORT: u16 = 6119;

/// How often the browser tab is re-opened for someone who closed it without
/// finishing sign-in. The listener itself stays up the whole time regardless.
const BROWSER_REOPEN: std::time::Duration = std::time::Duration::from_secs(30 * 60);

pub enum EnrollOutcome {
    Enrolled(Config),
    /// Terminal — see EnrollError::AlreadyEnrolled. The caller shows this
    /// message and stops, rather than retrying.
    Blocked(String),
    Cancelled,
}

/// Drives one interactive enrollment attempt to completion (or cancellation).
///
/// `cancel` is checked between browser-reopen intervals — set it to stop
/// waiting (the person closed the connect flow) without tearing down
/// anything the caller doesn't own.
pub async fn browser_enroll(portal_url: &str, admin_url: &str, cancel: Arc<AtomicBool>) -> EnrollOutcome {
    let listener = match bind_loopback().await {
        Some(l) => l,
        None => {
            tracing::error!("enrollment listener could not bind any loopback port");
            return EnrollOutcome::Cancelled;
        }
    };
    let port = match listener.local_addr() {
        Ok(addr) => addr.port(),
        Err(_) => return EnrollOutcome::Cancelled,
    };

    let state = random_state();
    let portal_origin = origin_of(portal_url);
    let callback = format!("http://127.0.0.1:{port}/enroll");
    let enroll_url = format!(
        "{}/enroll?state={}&callback={}",
        portal_url.trim_end_matches('/'),
        state,
        urlencode(&callback)
    );

    tracing::info!(port, "enrollment listener bound to 127.0.0.1");
    tracing::info!("if no browser opens, visit: {enroll_url}");

    let done = Arc::new(Notify::new());
    let outcome: Arc<Mutex<Option<EnrollOutcome>>> = Arc::new(Mutex::new(None));
    let admin_url_owned = admin_url.to_string();
    let portal_url_owned = portal_url.to_string();

    let shared = Shared {
        state: state.clone(),
        portal_origin,
        enroll_url: enroll_url.clone(),
        admin_url_default: admin_url_owned,
        portal_url: portal_url_owned,
        done: done.clone(),
        outcome: outcome.clone(),
    };

    // The listener runs on its own task so this function can independently
    // wait on either "a callback arrived" or "time to nudge the browser
    // again" — the same two-way wait the Python original's `done.wait
    // (timeout=...)` expresses with a threading.Event.
    let serve_task = tokio::spawn(serve_forever(listener, shared));

    open_in_browser(&enroll_url);

    // Two independent clocks, not one: `cancel` has to be noticed almost
    // immediately (a person clicked Cancel and is watching the window for
    // it to react), while re-opening the browser tab is deliberately rare.
    // A single `sleep(BROWSER_REOPEN)` branch — checking `cancel` only when
    // it fired — was the bug an actual Cancel click found: nothing woke the
    // loop early, so cancelling did nothing for up to 30 minutes.
    const CANCEL_POLL: std::time::Duration = std::time::Duration::from_millis(200);
    let mut next_reopen = tokio::time::Instant::now() + BROWSER_REOPEN;

    loop {
        tokio::select! {
            _ = done.notified() => break,
            _ = tokio::time::sleep(CANCEL_POLL) => {
                if cancel.load(Ordering::SeqCst) {
                    serve_task.abort();
                    return EnrollOutcome::Cancelled;
                }
                if tokio::time::Instant::now() >= next_reopen {
                    tracing::info!("re-opening the enrollment page — nobody has signed in yet");
                    open_in_browser(&enroll_url);
                    next_reopen = tokio::time::Instant::now() + BROWSER_REOPEN;
                }
            }
        }
    }

    serve_task.abort();
    let result = outcome.lock().unwrap().take().unwrap_or(EnrollOutcome::Cancelled);
    result
}

struct Shared {
    state: String,
    portal_origin: String,
    enroll_url: String,
    admin_url_default: String,
    portal_url: String,
    done: Arc<Notify>,
    outcome: Arc<Mutex<Option<EnrollOutcome>>>,
}

async fn serve_forever(listener: TcpListener, shared: Shared) {
    let shared = Arc::new(shared);
    loop {
        let (stream, _) = match listener.accept().await {
            Ok(pair) => pair,
            Err(_) => continue,
        };
        let shared = shared.clone();
        tokio::spawn(async move {
            let io = TokioIo::new(stream);
            let service = service_fn(move |req| handle(req, shared.clone()));
            let _ = server_http1::Builder::new().serve_connection(io, service).await;
        });
    }
}

async fn handle(req: Request<Incoming>, shared: Arc<Shared>) -> Result<Response<BoxBody>, hyper::Error> {
    let portal_origin = shared.portal_origin.clone();
    let cors = |builder: hyper::http::response::Builder, origin: Option<&str>| -> hyper::http::response::Builder {
        match origin {
            Some(o) if o == portal_origin => builder
                .header("Access-Control-Allow-Origin", o)
                // Chrome's Private Network Access preflight: a page on a
                // public origin may only reach loopback if this says so.
                // Without it the portal's POST never leaves the browser.
                .header("Access-Control-Allow-Private-Network", "true")
                .header("Access-Control-Allow-Headers", "Content-Type")
                .header("Access-Control-Allow-Methods", "POST, OPTIONS"),
            _ => builder,
        }
    };
    let origin_header = req.headers().get(hyper::header::ORIGIN).and_then(|v| v.to_str().ok()).map(|s| s.to_string());

    match (req.method().clone(), req.uri().path()) {
        (Method::OPTIONS, _) => {
            let resp = cors(Response::builder().status(StatusCode::NO_CONTENT), origin_header.as_deref())
                .body(empty_body())
                .unwrap();
            Ok(resp)
        }
        // A second way back for someone who closed the original tab: this
        // listener stays up until enrollment completes, so visiting the
        // loopback URL directly always leads somewhere useful.
        (Method::GET, _) => {
            let resp = Response::builder()
                .status(StatusCode::FOUND)
                .header("Location", &shared.enroll_url)
                .body(empty_body())
                .unwrap();
            Ok(resp)
        }
        (Method::POST, _) => {
            let body = req.into_body().collect().await?.to_bytes();
            let json: serde_json::Value = serde_json::from_slice(&body).unwrap_or(serde_json::Value::Null);

            let got_state = json.get("state").and_then(|v| v.as_str()).unwrap_or("");
            if !constant_time_eq(got_state.as_bytes(), shared.state.as_bytes()) {
                tracing::warn!("rejected an enrollment callback with a bad state");
                let resp = cors(Response::builder().status(StatusCode::FORBIDDEN), origin_header.as_deref())
                    .header("Content-Type", "application/json")
                    .body(full_body(br#"{"error":"state mismatch"}"#.to_vec()))
                    .unwrap();
                return Ok(resp);
            }

            let token = json.get("token").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
            let admin_url = json.get("admin_url").and_then(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| shared.admin_url_default.clone());

            if token.is_empty() {
                let resp = cors(Response::builder().status(StatusCode::BAD_REQUEST), origin_header.as_deref())
                    .header("Content-Type", "application/json")
                    .body(full_body(br#"{"error":"no token"}"#.to_vec()))
                    .unwrap();
                return Ok(resp);
            }

            match enroll_with_token(&token, &admin_url, &shared.portal_url).await {
                Ok(config) => {
                    *shared.outcome.lock().unwrap() = Some(EnrollOutcome::Enrolled(config));
                    shared.done.notify_one();
                    let resp = cors(Response::builder().status(StatusCode::OK), origin_header.as_deref())
                        .header("Content-Type", "application/json")
                        .body(full_body(br#"{"ok":true}"#.to_vec()))
                        .unwrap();
                    Ok(resp)
                }
                Err(EnrollError::AlreadyEnrolled(msg)) => {
                    // Terminal: recorded so the caller can show the server's
                    // wording, and signalled immediately since waiting
                    // longer changes nothing — see the Python original's
                    // identical reasoning on EnrollmentBlocked.
                    tracing::error!(%msg, "enrollment refused");
                    let body = serde_json::json!({"error": msg, "code": "device_already_enrolled"});
                    *shared.outcome.lock().unwrap() = Some(EnrollOutcome::Blocked(msg));
                    shared.done.notify_one();
                    let resp = cors(Response::builder().status(StatusCode::FORBIDDEN), origin_header.as_deref())
                        .header("Content-Type", "application/json")
                        .body(full_body(serde_json::to_vec(&body).unwrap()))
                        .unwrap();
                    Ok(resp)
                }
                Err(EnrollError::Http(msg)) => {
                    tracing::error!(%msg, "first-run enrollment failed");
                    let body = serde_json::json!({"error": msg});
                    let resp = cors(Response::builder().status(StatusCode::BAD_GATEWAY), origin_header.as_deref())
                        .header("Content-Type", "application/json")
                        .body(full_body(serde_json::to_vec(&body).unwrap()))
                        .unwrap();
                    Ok(resp)
                }
            }
        }
        _ => Ok(Response::builder().status(StatusCode::NOT_FOUND).body(empty_body()).unwrap()),
    }
}

type BoxBody = http_body_util::combinators::BoxBody<Bytes, hyper::Error>;

fn empty_body() -> BoxBody {
    Full::new(Bytes::new()).map_err(|never| match never {}).boxed()
}

fn full_body(data: Vec<u8>) -> BoxBody {
    Full::new(Bytes::from(data)).map_err(|never| match never {}).boxed()
}

async fn bind_loopback() -> Option<TcpListener> {
    for port in [PREFERRED_PORT, 0] {
        match TcpListener::bind(("127.0.0.1", port)).await {
            Ok(l) => return Some(l),
            Err(e) => tracing::info!(port, error = %e, "enrollment listener could not bind — trying another port"),
        }
    }
    None
}

fn random_state() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

/// scheme://host[:port] of a URL, for matching the CORS Origin header
/// against — never the path, which the portal's own page doesn't send as
/// part of Origin anyway.
fn origin_of(url: &str) -> String {
    if let Some(scheme_end) = url.find("://") {
        let rest = &url[scheme_end + 3..];
        let host_end = rest.find('/').unwrap_or(rest.len());
        format!("{}{}", &url[..scheme_end + 3], &rest[..host_end])
    } else {
        url.to_string()
    }
}

fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Constant-time comparison — `state` is a defense against an unrelated
/// local process guessing the callback and enrolling itself; comparing it
/// with `==` would leak timing information about how many leading bytes
/// matched.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// `pub(crate)`, not private: `uninstall.rs`'s Windows/Linux path reuses
/// this too — removal there is the OS package manager's job, so all the
/// agent does is open the portal's download page, the same action this
/// function already exists for on the enrollment side.
pub(crate) fn open_in_browser(url: &str) {
    let result = if cfg!(target_os = "macos") {
        std::process::Command::new("/usr/bin/open").arg(url).status()
    } else if cfg!(target_os = "windows") {
        std::process::Command::new("cmd").args(["/C", "start", "", url]).status()
    } else {
        std::process::Command::new("xdg-open").arg(url).status()
    };
    if let Err(e) = result {
        tracing::warn!(error = %e, "could not open a browser for enrollment");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_constant_time_eq_matches_equal_strings() {
        assert!(constant_time_eq(b"abc123", b"abc123"));
    }

    #[test]
    fn test_constant_time_eq_rejects_different_strings() {
        assert!(!constant_time_eq(b"abc123", b"abc124"));
        assert!(!constant_time_eq(b"short", b"muchlonger"));
        assert!(!constant_time_eq(b"", b"nonempty"));
    }

    #[test]
    fn test_origin_of_strips_path_and_query() {
        assert_eq!(origin_of("https://portal.example.com/enroll?x=1"), "https://portal.example.com");
        assert_eq!(origin_of("http://127.0.0.1:6119/enroll"), "http://127.0.0.1:6119");
    }

    #[test]
    fn test_urlencode_leaves_safe_chars_and_escapes_the_rest() {
        assert_eq!(urlencode("http://127.0.0.1:6119/enroll"), "http%3A%2F%2F127.0.0.1%3A6119%2Fenroll");
    }

    #[test]
    fn test_random_state_is_not_trivially_predictable() {
        let a = random_state();
        let b = random_state();
        assert_ne!(a, b);
        assert_eq!(a.len(), 64); // 32 bytes, hex-encoded
    }
}
