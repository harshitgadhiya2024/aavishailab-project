//! Token-file enrollment — a port of the token-file half of Python's
//! `ensure_enrolled`/`enroll`. See config.rs's module doc for the scope
//! note on why the interactive browser-callback flow isn't ported.

use crate::config::Config;
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
struct EnrollRequest<'a> {
    token: &'a str,
    hostname: &'a str,
    os_type: &'a str,
    agent_version: &'a str,
}

#[derive(Deserialize)]
struct EnrollResponse {
    device_id: String,
    agent_key: String,
    org_id: String,
    #[serde(default)]
    employee_id: Option<String>,
}

/// Returns an existing config if already enrolled, otherwise looks for an
/// enrollment token (env var or drop-file) and enrolls with it.
///
/// This is the *unattended* path — a token pre-provisioned by IT (a drop
/// file, an env var baked into a fleet image) and no person watching a
/// window. The interactive path a person drives from the desktop UI is
/// `enroll_with_token` below, called instead of this once the callback
/// server (see `enroll_interactive.rs`) has a token from the portal.
pub async fn ensure_enrolled() -> Option<Config> {
    if let Some(cfg) = crate::config::load().await {
        return Some(cfg);
    }

    let (token, admin_url, portal_url) = crate::config::find_enroll_token().await?;
    let admin_url = admin_url.unwrap_or_else(|| crate::config::DEFAULT_ADMIN_URL.to_string());
    let portal_url = portal_url.unwrap_or_else(|| crate::config::DEFAULT_PORTAL_URL.to_string());

    match enroll_with_token(&token, &admin_url, &portal_url).await {
        Ok(config) => {
            crate::config::discard_enroll_drops().await;
            Some(config)
        }
        Err(e) => {
            tracing::error!(error = %e, "enrollment failed");
            None
        }
    }
}

/// What `enroll_with_token` can fail with, distinguished because the caller
/// treats them differently: `AlreadyEnrolled` is terminal (only an
/// administrator can clear it — see the Python original's
/// `EnrollmentBlocked`), everything else is worth retrying or showing as a
/// transient error.
#[derive(Debug)]
pub enum EnrollError {
    /// The server refused because this machine already has a device row.
    /// Carries the server's own message, shown verbatim in the UI.
    AlreadyEnrolled(String),
    Http(String),
}

impl std::fmt::Display for EnrollError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EnrollError::AlreadyEnrolled(msg) => write!(f, "{msg}"),
            EnrollError::Http(msg) => write!(f, "{msg}"),
        }
    }
}

/// The actual enroll API call, given a token from wherever it came from
/// (drop-file, env var, or a browser-driven callback). Saves the resulting
/// config to disk on success — enrollment only ever needs to happen once.
pub async fn enroll_with_token(token: &str, admin_url: &str, portal_url: &str) -> Result<Config, EnrollError> {
    let admin_url = admin_url.trim_end_matches('/').to_string();
    let portal_url = portal_url.trim_end_matches('/').to_string();
    let hostname = hostname_string();
    let body = EnrollRequest { token, hostname: &hostname, os_type: os_type_str(), agent_version: crate::config::AGENT_VERSION };

    let http = reqwest::Client::builder()
        .no_proxy()
        .user_agent("AavishieldAgent/1.0")
        .build()
        .map_err(|e| EnrollError::Http(e.to_string()))?;

    let resp = http
        .post(format!("{admin_url}/internal/agent/enroll"))
        .json(&body)
        .send()
        .await
        .map_err(|e| EnrollError::Http(format!("Could not reach the server: {e}")))?;

    let status = resp.status();
    if status.as_u16() == 403 {
        // The device-already-registered case: the server's own contract
        // (see admin-api's Enroll handler) is 403 + {"code":
        // "device_already_enrolled", "error": "..."}. Anything else at 403
        // (a bad/expired token) is a plain enrollment failure, not this
        // specific, terminal-until-an-admin-clears-it case.
        let detail: serde_json::Value = resp.json().await.unwrap_or_default();
        let code = detail.get("code").and_then(|v| v.as_str()).unwrap_or("");
        if code == "device_already_enrolled" {
            let msg = detail.get("error").and_then(|v| v.as_str())
                .unwrap_or("This device is already registered.")
                .to_string();
            return Err(EnrollError::AlreadyEnrolled(msg));
        }
        let msg = detail.get("error").and_then(|v| v.as_str())
            .unwrap_or("Invalid or expired enrollment token")
            .to_string();
        return Err(EnrollError::Http(msg));
    }
    if !status.is_success() {
        return Err(EnrollError::Http(format!("Enrollment failed ({status})")));
    }

    let data: EnrollResponse = resp.json().await.map_err(|e| EnrollError::Http(e.to_string()))?;
    let config = Config {
        device_id: data.device_id,
        agent_key: data.agent_key,
        org_id: data.org_id,
        employee_id: data.employee_id,
        admin_url,
        portal_url,
        hostname,
    };

    crate::config::save(&config).await.map_err(|e| EnrollError::Http(e.to_string()))?;
    tracing::info!("enrolled successfully");
    Ok(config)
}

fn hostname_string() -> String {
    hostname_impl().unwrap_or_else(|| "unknown-host".to_string())
}

#[cfg(unix)]
fn hostname_impl() -> Option<String> {
    let output = std::process::Command::new("hostname").output().ok()?;
    let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

#[cfg(windows)]
fn hostname_impl() -> Option<String> {
    std::env::var("COMPUTERNAME").ok()
}

fn os_type_str() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else {
        "linux"
    }
}
