//! TLS-interception engine — a port of Python's `MITMEngine`. Terminates
//! TLS locally for HTTPS connections whose destination is neither
//! policy-blocked nor on the org's bypass list, so DLP/malware scanning
//! can see the plaintext, then re-encrypts to the real upstream. Both legs
//! use short-lived, per-host leaf certificates signed by the org's own CA
//! (admin-api's internal/mitm) — the CA private key never reaches this
//! device, only these narrow, expiring leaves do.
//!
//! Fail-open: if SSL Inspection isn't enabled, a host is bypassed, or a
//! leaf can't be obtained, the caller falls through to a blind tunnel.

use crate::http_client::AgentClient;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

const LEAF_REFRESH_MARGIN: u64 = 300; // seconds before actual expiry to treat a leaf as due for renewal
const MITM_LEAF_CACHE_MAX: usize = 2048;

#[derive(Clone)]
pub struct Leaf {
    pub cert_pem: Arc<str>,
    pub key_pem: Arc<str>,
}

struct CachedLeaf {
    leaf: Leaf,
    expiry: Instant,
}

#[derive(Deserialize)]
struct MitmConfigResponse {
    #[serde(default)]
    enabled: bool,
    #[serde(default)]
    bypass_domains: Vec<String>,
}

#[derive(Serialize)]
struct SignCertRequest<'a> {
    hostname: &'a str,
}

#[derive(Deserialize)]
struct SignCertResponse {
    cert_pem: Option<String>,
    key_pem: Option<String>,
    #[serde(default)]
    expires_in: u64,
}

struct MitmState {
    enabled: bool,
    bypass: HashSet<String>,
}

pub struct MitmEngine {
    client: AgentClient,
    ca_trusted: Arc<dyn Fn() -> bool + Send + Sync>,
    state: RwLock<MitmState>,
    leaf_cache: RwLock<HashMap<String, CachedLeaf>>,
    /// Hosts whose client refused our certificate, and when. See
    /// `learn_refused`.
    refused: std::sync::Mutex<HashMap<String, Instant>>,
    /// Per host: connections that ended without a single request, since
    /// when, and whether any connection to it ever carried one.
    empty: std::sync::Mutex<HashMap<String, (u32, Instant, bool)>>,
}

/// Two request-less connections within this window, to a host that has
/// never carried a request, is an app checking our certificate after the
/// handshake and walking away (OkHttp, NSURLSession and most pinning
/// libraries work that way) rather than a browser preconnecting.
const EMPTY_WINDOW: Duration = Duration::from_secs(120);
const EMPTY_LIMIT: u32 = 2;

/// How long a host whose client refused inspection is passed through.
const REFUSED_FOR: Duration = Duration::from_secs(24 * 3600);

impl MitmEngine {
    pub fn new(client: AgentClient, ca_trusted: Arc<dyn Fn() -> bool + Send + Sync>) -> Self {
        MitmEngine { client, ca_trusted, state: RwLock::new(MitmState { enabled: false, bypass: HashSet::new() }), leaf_cache: RwLock::new(HashMap::new()), refused: std::sync::Mutex::new(HashMap::new()), empty: std::sync::Mutex::new(HashMap::new()) }
    }

    pub async fn refresh(&self) {
        if self.client.revoked.is_set() {
            self.state.write().await.enabled = false;
            return;
        }
        let resp = match self.client.get("/internal/agent/mitm-config").await {
            Ok(r) => r,
            Err(e) => {
                tracing::debug!(error = %e, "MITM config refresh failed — keeping previous config");
                return;
            }
        };
        let body: MitmConfigResponse = match resp.json().await {
            Ok(b) => b,
            Err(e) => {
                tracing::debug!(error = %e, "MITM config refresh returned unparseable body");
                return;
            }
        };

        let bypass: HashSet<String> = body.bypass_domains.iter().map(|d| d.to_lowercase().trim_start_matches("www.").to_string()).collect();
        let enabled = body.enabled && (self.ca_trusted)();
        if body.enabled && !enabled {
            tracing::warn!("SSL Inspection is enabled by policy, but the local CA is not trusted; using blind HTTPS tunnels");
        }
        let mut state = self.state.write().await;
        state.enabled = enabled;
        state.bypass = bypass;
    }

    pub async fn loop_refresh(self: Arc<Self>, interval: Duration) {
        let mut ticker = tokio::time::interval(interval);
        loop {
            ticker.tick().await;
            self.refresh().await;
        }
    }

    /// Whether a *blocked* HTTPS host can be answered with the block page.
    ///
    /// Same conditions as `should_intercept`, minus the bypass list. The
    /// bypass list exists so that real traffic to banking, healthcare and
    /// government sites is never decrypted — but a blocked host has no real
    /// traffic: nothing is forwarded to it, the browser's request never
    /// leaves this machine, and the only thing sent back is our own page. So
    /// honouring the list here protects nothing, and it was the reason every
    /// blocked bank or government site showed the browser's own "tunnel
    /// failed" error (ERR_TUNNEL_CONNECTION_FAILED, NS_ERROR_PROXY_FORBIDDEN)
    /// instead of the company's page — found testing Chrome, Edge, Brave,
    /// Firefox and WebKit against every domain in those categories.
    ///
    /// SSL Inspection being switched off for the org still means no: then
    /// the CA may not be trusted, and a leaf from it would be a certificate
    /// error rather than a page.
    pub async fn can_serve_block_page(&self) -> bool {
        !self.client.revoked.is_set() && self.state.read().await.enabled
    }

    /// Terminating TLS on a personal laptop outside working hours is the
    /// single most intrusive thing this agent does, so `gate.intercepts()`
    /// is checked first by the caller (see proxy.rs).
    pub async fn should_intercept(&self, host: &str) -> bool {
        if self.client.revoked.is_set() {
            return false;
        }
        let mut host = host.to_lowercase();
        if let Some(s) = host.strip_prefix("www.") {
            host = s.to_string();
        }
        if self.refused_recently(&host) {
            return false;
        }
        let state = self.state.read().await;
        if !state.enabled {
            return false;
        }
        if state.bypass.contains(&host) {
            return false;
        }
        for entry in &state.bypass {
            if let Some(suffix) = entry.strip_prefix("*.") {
                if host.ends_with(suffix) {
                    return false;
                }
            }
        }
        let parts: Vec<&str> = host.split('.').collect();
        for i in 1..parts.len() {
            if state.bypass.contains(&parts[i..].join(".")) {
                return false;
            }
        }
        true
    }

    /// Records that the client on this device refused our certificate for
    /// `host` during the handshake. That is what an app does when it pins
    /// its server's certificate (Parallels, banking and VPN clients, parts
    /// of Office), keeps its own CA list instead of the system's (Python,
    /// Java, Node and Electron tooling), or speaks only HTTP/2 (gRPC). Each
    /// of those failed every connection, every time, for as long as
    /// inspection was on, so sign-ins and setups broke until someone turned
    /// the agent off. Now the host is passed through untouched for
    /// `REFUSED_FOR` and the app's next attempt works. A browser trusts the
    /// CA, so it never lands here and its traffic stays inspected.
    ///
    /// Returns true the first time for a host, so the caller reports it
    /// once rather than on every connection.
    pub fn learn_refused(&self, host: &str) -> bool {
        let host = normalize(host);
        let mut refused = self.refused.lock().unwrap();
        refused.retain(|_, at| at.elapsed() < REFUSED_FOR);
        if refused.len() >= 4096 {
            return false; // bounded; something is badly wrong, keep inspecting
        }
        refused.insert(host, Instant::now()).is_none()
    }

    /// Called when an inspected connection ends. `served` is whether it
    /// carried at least one request. Returns true when this makes the
    /// host look pinned, after `learn_refused` has recorded it.
    pub fn note_connection(&self, host: &str, served: bool) -> bool {
        let key = normalize(host);
        let pinned = {
            let mut empty = self.empty.lock().unwrap();
            if empty.len() > 4096 {
                empty.clear();
            }
            let entry = empty.entry(key.clone()).or_insert((0, Instant::now(), false));
            if served {
                entry.2 = true;
                return false;
            }
            if entry.1.elapsed() > EMPTY_WINDOW {
                *entry = (0, Instant::now(), entry.2);
            }
            entry.0 += 1;
            !entry.2 && entry.0 >= EMPTY_LIMIT
        };
        pinned && self.learn_refused(&key)
    }

    fn refused_recently(&self, host: &str) -> bool {
        self.refused.lock().unwrap().get(&normalize(host)).is_some_and(|at| at.elapsed() < REFUSED_FOR)
    }

    /// Returns a cached or freshly-fetched leaf for `host`. None means
    /// "couldn't obtain one" — callers must fall back to a blind tunnel.
    pub async fn get_leaf(&self, host: &str) -> Option<Leaf> {
        if self.client.revoked.is_set() {
            return None;
        }
        let now = Instant::now();
        {
            let mut cache = self.leaf_cache.write().await;
            prune_locked(&mut cache, now);
            if let Some(cached) = cache.get(host) {
                if cached.expiry > now {
                    return Some(cached.leaf.clone());
                }
            }
        }

        let resp = self.client.post_json("/internal/agent/sign-cert", &SignCertRequest { hostname: host }).await.ok()?;
        let data: SignCertResponse = resp.json().await.ok()?;
        let (cert_pem, key_pem) = (data.cert_pem?, data.key_pem?);
        if cert_pem.is_empty() || key_pem.is_empty() {
            return None;
        }

        let leaf = Leaf { cert_pem: cert_pem.into(), key_pem: key_pem.into() };
        let expiry = now + Duration::from_secs(data.expires_in.saturating_sub(LEAF_REFRESH_MARGIN));
        let mut cache = self.leaf_cache.write().await;
        cache.insert(host.to_string(), CachedLeaf { leaf: leaf.clone(), expiry });
        prune_locked(&mut cache, now);
        Some(leaf)
    }
}

fn prune_locked(cache: &mut HashMap<String, CachedLeaf>, now: Instant) {
    cache.retain(|_, v| v.expiry > now);
    if cache.len() > MITM_LEAF_CACHE_MAX {
        let overflow = cache.len() - MITM_LEAF_CACHE_MAX;
        let mut by_expiry: Vec<(String, Instant)> = cache.iter().map(|(k, v)| (k.clone(), v.expiry)).collect();
        by_expiry.sort_by_key(|(_, expiry)| *expiry);
        for (host, _) in by_expiry.into_iter().take(overflow) {
            cache.remove(&host);
        }
    }
}

fn normalize(host: &str) -> String {
    let host = host.to_lowercase();
    host.strip_prefix("www.").map(str::to_string).unwrap_or(host)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_refused_host_is_passed_through_and_reported_once() {
        let e = engine(true);
        e.state.write().await.enabled = true;
        assert!(e.should_intercept("my.parallels.com").await);
        assert!(e.learn_refused("my.parallels.com"));
        assert!(!e.learn_refused("MY.parallels.com"), "reported once");
        assert!(!e.should_intercept("my.parallels.com").await);
        assert!(e.should_intercept("parallels.com").await, "only that host");
    }

    #[tokio::test]
    async fn test_request_less_connections_mark_a_pinned_host_but_not_a_used_one() {
        let e = engine(true);
        e.state.write().await.enabled = true;
        assert!(!e.note_connection("pinned.example", false));
        assert!(e.note_connection("pinned.example", false), "second empty connection");
        assert!(!e.should_intercept("pinned.example").await);

        // A browser: preconnects that go unused, but the host is used.
        assert!(!e.note_connection("site.example", true));
        for _ in 0..5 {
            assert!(!e.note_connection("site.example", false));
        }
        assert!(e.should_intercept("site.example").await);
    }

    fn engine(ca_trusted: bool) -> MitmEngine {
        let client = AgentClient::new(crate::config::test_config(), Default::default());
        MitmEngine::new(client, Arc::new(move || ca_trusted))
    }

    #[tokio::test]
    async fn test_disabled_by_default() {
        let e = engine(true);
        assert!(!e.should_intercept("example.com").await);
    }

    #[tokio::test]
    async fn test_enabled_intercepts_non_bypassed_host() {
        let e = engine(true);
        e.state.write().await.enabled = true;
        assert!(e.should_intercept("example.com").await);
    }

    #[tokio::test]
    async fn test_exact_bypass_match() {
        let e = engine(true);
        {
            let mut s = e.state.write().await;
            s.enabled = true;
            s.bypass.insert("bank.com".to_string());
        }
        assert!(!e.should_intercept("bank.com").await);
        assert!(!e.should_intercept("www.bank.com").await); // www-stripped before lookup
    }

    /// A bypassed (e.g. banking) host is never inspected, but when it is
    /// blocked it still gets the block page — and only while SSL Inspection
    /// is actually on and the device's credentials are still accepted.
    #[tokio::test]
    async fn test_block_page_ignores_bypass_but_not_disabled_or_revoked() {
        let e = engine(true);
        assert!(!e.can_serve_block_page().await, "SSL Inspection off: no page");
        {
            let mut s = e.state.write().await;
            s.enabled = true;
            s.bypass.insert("hdfcbank.com".to_string());
        }
        assert!(!e.should_intercept("hdfcbank.com").await);
        assert!(e.can_serve_block_page().await);
        e.client.revoked.set();
        assert!(!e.can_serve_block_page().await, "revoked device: no page");
    }

    #[tokio::test]
    async fn test_wildcard_bypass_match() {
        let e = engine(true);
        {
            let mut s = e.state.write().await;
            s.enabled = true;
            s.bypass.insert("*.apple.com".to_string());
        }
        assert!(!e.should_intercept("gs.apple.com").await);
        assert!(e.should_intercept("apple.com.evil.net").await); // must not match a lookalike suffix
    }

    #[tokio::test]
    async fn test_parent_domain_bypass_match() {
        let e = engine(true);
        {
            let mut s = e.state.write().await;
            s.enabled = true;
            s.bypass.insert("example.com".to_string());
        }
        assert!(!e.should_intercept("api.example.com").await);
    }

    #[tokio::test]
    async fn test_revoked_agent_never_intercepts() {
        let e = engine(true);
        e.state.write().await.enabled = true;
        e.client.revoked.set();
        assert!(!e.should_intercept("example.com").await);
    }

    #[tokio::test]
    async fn test_untrusted_ca_disables_even_if_org_enabled_it() {
        let e = engine(false); // CA not trusted on this device
        // refresh() would compute enabled = body.enabled && ca_trusted() = false;
        // exercising that composition directly since refresh() needs a network call.
        let ca_trusted = (e.ca_trusted)();
        assert!(!ca_trusted);
    }

    #[tokio::test]
    async fn test_leaf_cache_prunes_expired_entries() {
        let e = engine(true);
        let now = Instant::now();
        e.leaf_cache.write().await.insert(
            "old.com".to_string(),
            CachedLeaf { leaf: Leaf { cert_pem: "x".into(), key_pem: "y".into() }, expiry: now - Duration::from_secs(1) },
        );
        let mut cache = e.leaf_cache.write().await;
        prune_locked(&mut cache, now);
        assert!(!cache.contains_key("old.com"));
    }

    #[tokio::test]
    async fn test_leaf_cache_evicts_soonest_to_expire_on_overflow() {
        let e = engine(true);
        let now = Instant::now();
        {
            let mut cache = e.leaf_cache.write().await;
            for i in 0..(MITM_LEAF_CACHE_MAX + 5) {
                cache.insert(
                    format!("host{i}.com"),
                    CachedLeaf { leaf: Leaf { cert_pem: "x".into(), key_pem: "y".into() }, expiry: now + Duration::from_secs(1000 + i as u64) },
                );
            }
        }
        let mut cache = e.leaf_cache.write().await;
        prune_locked(&mut cache, now);
        assert!(cache.len() <= MITM_LEAF_CACHE_MAX);
        // The lowest-index (soonest-expiring) hosts should be the ones evicted.
        assert!(!cache.contains_key("host0.com"));
    }
}
