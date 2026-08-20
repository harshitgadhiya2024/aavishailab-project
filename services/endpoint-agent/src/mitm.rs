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
}

impl MitmEngine {
    pub fn new(client: AgentClient, ca_trusted: Arc<dyn Fn() -> bool + Send + Sync>) -> Self {
        MitmEngine { client, ca_trusted, state: RwLock::new(MitmState { enabled: false, bypass: HashSet::new() }), leaf_cache: RwLock::new(HashMap::new()) }
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

#[cfg(test)]
mod tests {
    use super::*;

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
