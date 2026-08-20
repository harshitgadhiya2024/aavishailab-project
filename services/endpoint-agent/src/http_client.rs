//! Shared HTTPS client to admin-api — a port of `_agent_request` +
//! `mark_revoked_if_auth_error`. Direct connection only (no system proxy):
//! since the agent points the OS at itself, its own outbound calls would
//! otherwise loop back into 127.0.0.1:LOCAL_PORT and never reach the
//! server (mirrors `_DIRECT_OPENER`'s empty `ProxyHandler`).

use crate::config::Config;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// Set once admin-api rejects our credentials (401/403). Once set, every
/// cache/gate short-circuits to fail-open (allow) — the agent degrades to
/// an unmanaged blind tunnel rather than either blocking all traffic or
/// pretending it still has a valid policy.
#[derive(Clone, Default)]
pub struct AgentRevoked(Arc<AtomicBool>);

impl AgentRevoked {
    pub fn is_set(&self) -> bool {
        self.0.load(Ordering::Relaxed)
    }
    pub fn set(&self) {
        self.0.store(true, Ordering::Relaxed);
    }
}

#[derive(Clone)]
pub struct AgentClient {
    http: reqwest::Client,
    config: Config,
    pub revoked: AgentRevoked,
}

impl AgentClient {
    pub fn new(config: Config, revoked: AgentRevoked) -> Self {
        let http = reqwest::Client::builder()
            .no_proxy()
            .user_agent("AavishieldAgent/1.0")
            .build()
            .expect("failed to build HTTP client");
        AgentClient { http, config, revoked }
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.config.admin_url.trim_end_matches('/'), path)
    }

    fn auth_header(&self) -> String {
        format!("Bearer {}:{}", self.config.device_id, self.config.agent_key)
    }

    /// Marks the agent revoked if the response was 401/403. Returns the
    /// response either way so callers can still branch on other statuses.
    fn check_revoked(&self, resp: &reqwest::Response) {
        if matches!(resp.status().as_u16(), 401 | 403) && !self.revoked.is_set() {
            tracing::error!(status = resp.status().as_u16(), "agent credentials rejected by admin API — switching to unmanaged blind-tunnel mode");
            self.revoked.set();
        }
    }

    pub async fn get(&self, path: &str) -> reqwest::Result<reqwest::Response> {
        let resp = self.http.get(self.url(path)).header("Authorization", self.auth_header()).send().await?;
        self.check_revoked(&resp);
        Ok(resp)
    }

    pub async fn post_json(&self, path: &str, body: &impl serde::Serialize) -> reqwest::Result<reqwest::Response> {
        let resp = self
            .http
            .post(self.url(path))
            .header("Authorization", self.auth_header())
            .json(body)
            .send()
            .await?;
        self.check_revoked(&resp);
        Ok(resp)
    }

    /// Streams a raw body (DLP/malware scan uploads) rather than buffering
    /// it as JSON — same rationale as the Python original's spooled-body
    /// approach: an upload shouldn't cost the agent's own memory budget.
    pub async fn post_bytes(&self, path: &str, content_type: &str, body: Vec<u8>) -> reqwest::Result<reqwest::Response> {
        let resp = self
            .http
            .post(self.url(path))
            .header("Authorization", self.auth_header())
            .header("Content-Type", content_type)
            .body(body)
            .send()
            .await?;
        self.check_revoked(&resp);
        Ok(resp)
    }

    pub fn config(&self) -> &Config {
        &self.config
    }
}
