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
pub async fn ensure_enrolled() -> Option<Config> {
    if let Some(cfg) = crate::config::load().await {
        return Some(cfg);
    }

    let (token, admin_url, portal_url) = crate::config::find_enroll_token().await?;
    let admin_url = admin_url.unwrap_or_else(|| crate::config::DEFAULT_ADMIN_URL.to_string());
    let portal_url = portal_url.unwrap_or_else(|| crate::config::DEFAULT_PORTAL_URL.to_string());

    let hostname = hostname_string();
    let body = EnrollRequest { token: &token, hostname: &hostname, os_type: os_type_str(), agent_version: crate::config::AGENT_VERSION };

    let http = reqwest::Client::builder().no_proxy().user_agent("AavishieldAgent/1.0").build().ok()?;
    let resp = http.post(format!("{}/internal/agent/enroll", admin_url.trim_end_matches('/'))).json(&body).send().await.ok()?;
    if !resp.status().is_success() {
        tracing::error!(status = resp.status().as_u16(), "enrollment failed");
        return None;
    }
    let data: EnrollResponse = resp.json().await.ok()?;

    let config = Config { device_id: data.device_id, agent_key: data.agent_key, org_id: data.org_id, employee_id: data.employee_id, admin_url, portal_url, hostname };

    crate::config::save(&config).await.ok()?;
    crate::config::discard_enroll_drops().await;
    tracing::info!("enrolled successfully");
    Some(config)
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
