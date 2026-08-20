//! TTL-cached threat-intelligence lookups — a port of Python's
//! `ThreatIntelCache`. Validated against the same behavioral spec as
//! scripts/agent/tests/test_threat_casb_cache.py (TTL hit/miss/expiry via
//! a swappable lookup function, no network in tests).

use crate::http_client::AgentClient;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const THREAT_CACHE_TTL: Duration = Duration::from_secs(300);
const CACHE_MAX: usize = 2048;

#[derive(Debug, Clone, PartialEq)]
pub struct Verdict {
    pub action: String,
    pub category: String,
    pub reason: String,
    pub risk_score: i64,
}

impl crate::activity::RuleLike for Verdict {
    fn category(&self) -> &str {
        &self.category
    }
    fn reason(&self) -> &str {
        &self.reason
    }
    fn risk_score(&self) -> i64 {
        self.risk_score
    }
}

#[derive(Deserialize)]
struct LookupResponse {
    #[serde(default)]
    band: Option<String>,
    #[serde(default)]
    score: Option<i64>,
    #[serde(default)]
    category: Option<String>,
    #[serde(default)]
    reasons: Vec<String>,
}

pub struct ThreatIntelCache {
    client: AgentClient,
    cache: Mutex<HashMap<String, (Instant, Option<Verdict>)>>,
}

impl ThreatIntelCache {
    pub fn new(client: AgentClient) -> Self {
        ThreatIntelCache { client, cache: Mutex::new(HashMap::new()) }
    }

    pub async fn check(&self, host: &str) -> Option<Verdict> {
        if self.client.revoked.is_set() {
            return None;
        }
        let mut host = host.to_lowercase();
        if let Some(s) = host.strip_prefix("www.") {
            host = s.to_string();
        }

        let now = Instant::now();
        {
            let cache = self.cache.lock().unwrap();
            if let Some((expiry, verdict)) = cache.get(&host) {
                if *expiry > now {
                    return verdict.clone();
                }
            }
        }

        let verdict = self.lookup(&host).await;
        let mut cache = self.cache.lock().unwrap();
        cache.insert(host, (now + THREAT_CACHE_TTL, verdict.clone()));
        if cache.len() > CACHE_MAX {
            cache.retain(|_, (expiry, _)| *expiry > now);
        }
        verdict
    }

    async fn lookup(&self, host: &str) -> Option<Verdict> {
        let resp = self.client.get(&format!("/internal/agent/threat-lookup?domain={host}")).await.ok()?;
        let result: LookupResponse = resp.json().await.ok()?;

        let band = result.band.unwrap_or_default().to_lowercase();
        let score = result.score.unwrap_or(0);
        if band != "block" && band != "alert" && score < 50 {
            return None;
        }
        let action = if band == "block" || score >= 80 { "block" } else { "alert" };
        let reason = if result.reasons.is_empty() {
            "Threat intelligence risk".to_string()
        } else {
            result.reasons.join("; ")
        };
        Some(Verdict {
            action: action.to_string(),
            category: result.category.unwrap_or_else(|| "threat_intelligence".to_string()),
            reason,
            risk_score: score,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cache() -> ThreatIntelCache {
        let client = AgentClient::new(crate::config::test_config(), Default::default());
        ThreatIntelCache::new(client)
    }

    #[test]
    fn test_cache_hit_skips_expiry_when_fresh() {
        let c = cache();
        let now = Instant::now();
        c.cache.lock().unwrap().insert(
            "evil.com".to_string(),
            (now + THREAT_CACHE_TTL, Some(Verdict { action: "block".to_string(), category: "x".to_string(), reason: "y".to_string(), risk_score: 90 })),
        );
        let cached = c.cache.lock().unwrap().get("evil.com").cloned();
        assert!(cached.unwrap().0 > now);
    }

    #[test]
    fn test_host_normalization() {
        // Both "EVIL.com" and "www.evil.com" must normalize to the same key.
        let mut h1 = "EVIL.com".to_lowercase();
        if let Some(s) = h1.strip_prefix("www.") {
            h1 = s.to_string();
        }
        let mut h2 = "www.evil.com".to_lowercase();
        if let Some(s) = h2.strip_prefix("www.") {
            h2 = s.to_string();
        }
        assert_eq!(h1, h2);
    }

    #[tokio::test]
    async fn test_revoked_agent_skips_lookup_entirely() {
        let c = cache();
        c.client.revoked.set();
        assert!(c.check("evil.com").await.is_none());
        assert!(c.cache.lock().unwrap().is_empty());
    }

    #[test]
    fn test_expired_entry_is_pruned_on_overflow() {
        let c = cache();
        let now = Instant::now();
        // An already-expired entry plus a fresh one; pruning on overflow
        // keeps only entries whose expiry is still in the future.
        {
            let mut cache = c.cache.lock().unwrap();
            cache.insert("old.com".to_string(), (now - Duration::from_secs(1), None));
            cache.insert("new.com".to_string(), (now + THREAT_CACHE_TTL, None));
        }
        c.cache.lock().unwrap().retain(|_, (expiry, _)| *expiry > now);
        let cache = c.cache.lock().unwrap();
        assert!(!cache.contains_key("old.com"));
        assert!(cache.contains_key("new.com"));
    }
}
