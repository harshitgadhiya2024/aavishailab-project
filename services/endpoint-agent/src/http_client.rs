//! Shared HTTPS client to admin-api — a port of `_agent_request` +
//! `mark_revoked_if_auth_error`. Direct connection only (no system proxy):
//! since the agent points the OS at itself, its own outbound calls would
//! otherwise loop back into 127.0.0.1:LOCAL_PORT and never reach the
//! server (mirrors `_DIRECT_OPENER`'s empty `ProxyHandler`).

use crate::config::Config;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};

/// Set once admin-api rejects our credentials (401/403). Once set, every
/// cache/gate short-circuits to fail-open (allow) — the agent degrades to
/// an unmanaged blind tunnel rather than either blocking all traffic or
/// pretending it still has a valid policy.
///
/// `by_server` records *who* stopped it: the server rejecting the device's
/// key (an administrator revoked it) versus the employee's own Disconnect.
/// Only the first shows "removed by your IT administrator" with a working
/// Reconnect; `clear` undoes both once a reconnect brings a fresh key.
#[derive(Clone, Default)]
pub struct AgentRevoked(Arc<RevokedFlags>);

#[derive(Default)]
struct RevokedFlags {
    revoked: AtomicBool,
    by_server: AtomicBool,
}

impl AgentRevoked {
    pub fn is_set(&self) -> bool {
        self.0.revoked.load(Ordering::Relaxed)
    }
    pub fn set(&self) {
        self.0.revoked.store(true, Ordering::Relaxed);
    }
    /// The server rejected this device's credentials.
    pub fn set_by_server(&self) {
        self.0.by_server.store(true, Ordering::Relaxed);
        self.0.revoked.store(true, Ordering::Relaxed);
    }
    pub fn by_server(&self) -> bool {
        self.0.by_server.load(Ordering::Relaxed)
    }
    /// Enforcement resumes: a reconnect installed a fresh key.
    pub fn clear(&self) {
        self.0.by_server.store(false, Ordering::Relaxed);
        self.0.revoked.store(false, Ordering::Relaxed);
    }
}

#[derive(Clone)]
pub struct AgentClient {
    http: reqwest::Client,
    /// Shared by every clone, so a reconnect that swaps in a new device key
    /// reaches all running loops at once without restarting the process.
    config: Arc<RwLock<Config>>,
    pub revoked: AgentRevoked,
}

impl AgentClient {
    pub fn new(config: Config, revoked: AgentRevoked) -> Self {
        let http = reqwest::Client::builder()
            .no_proxy()
            .user_agent("AavishieldAgent/1.0")
            .build()
            .expect("failed to build HTTP client");
        AgentClient { http, config: Arc::new(RwLock::new(config)), revoked }
    }

    fn url(&self, path: &str) -> String {
        let cfg = self.config.read().unwrap();
        format!("{}{}", cfg.admin_url.trim_end_matches('/'), path)
    }

    fn auth_header(&self) -> String {
        let cfg = self.config.read().unwrap();
        format!("Bearer {}:{}", cfg.device_id, cfg.agent_key)
    }

    /// Marks the agent revoked if the response was 401/403. Returns the
    /// response either way so callers can still branch on other statuses.
    fn check_revoked(&self, resp: &reqwest::Response) {
        if matches!(resp.status().as_u16(), 401 | 403) && !self.revoked.by_server() {
            tracing::error!(status = resp.status().as_u16(), "agent credentials rejected by admin API — switching to unmanaged blind-tunnel mode");
            self.revoked.set_by_server();
        }
    }

    /// Installs the credentials from a fresh enrollment (Reconnect after an
    /// administrator revoked this device) and resumes enforcement.
    pub fn replace_credentials(&self, config: Config) {
        *self.config.write().unwrap() = config;
        self.revoked.clear();
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

    pub async fn put_bytes(&self, path: &str, body: Vec<u8>) -> reqwest::Result<reqwest::Response> {
        let resp = self
            .http
            .put(self.url(path))
            .header("Authorization", self.auth_header())
            .header("Content-Type", "application/octet-stream")
            .body(body)
            .send()
            .await?;
        self.check_revoked(&resp);
        Ok(resp)
    }

    pub fn config(&self) -> Config {
        self.config.read().unwrap().clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_server_rejection_is_told_apart_from_a_disconnect() {
        let r = AgentRevoked::default();
        r.set(); // the employee's own Disconnect
        assert!(r.is_set() && !r.by_server());
        r.set_by_server();
        assert!(r.is_set() && r.by_server());
        r.clear();
        assert!(!r.is_set() && !r.by_server());
    }

    #[test]
    fn test_replace_credentials_reaches_every_clone_and_resumes() {
        let client = AgentClient::new(crate::config::test_config(), AgentRevoked::default());
        let other = client.clone();
        client.revoked.set_by_server();
        let mut fresh = crate::config::test_config();
        fresh.agent_key = "fresh-key".to_string();
        client.replace_credentials(fresh);
        assert_eq!(other.config().agent_key, "fresh-key");
        assert!(other.auth_header().ends_with(":fresh-key"));
        assert!(!other.revoked.is_set());
    }
}
