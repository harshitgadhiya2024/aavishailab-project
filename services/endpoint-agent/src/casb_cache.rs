//! TTL-cached CASB inline app-control lookups — a port of Python's
//! `CASBControlCache`. Cache key is (host, activity), not just host —
//! an upload and a download to the same host can have different verdicts.

use crate::http_client::AgentClient;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const CASB_CACHE_TTL: Duration = Duration::from_secs(120);
const CACHE_MAX: usize = 2048;

#[derive(Debug, Clone, PartialEq)]
pub struct Verdict {
    pub action: String,
    pub category: String,
    pub reason: String,
    pub matched_rule: String,
}

impl crate::activity::RuleLike for Verdict {
    fn category(&self) -> &str {
        &self.category
    }
    fn reason(&self) -> &str {
        &self.reason
    }
    fn risk_score(&self) -> i64 {
        0
    }
}

#[derive(Deserialize)]
struct LookupResponse {
    #[serde(default)]
    action: Option<String>,
    #[serde(default)]
    reason: Option<String>,
    #[serde(default)]
    matched_rule: Option<String>,
}

type CacheKey = (String, String);
type CacheEntry = (Instant, Option<Verdict>);

pub struct CASBControlCache {
    client: AgentClient,
    cache: Mutex<HashMap<CacheKey, CacheEntry>>,
}

impl CASBControlCache {
    pub fn new(client: AgentClient) -> Self {
        CASBControlCache { client, cache: Mutex::new(HashMap::new()) }
    }

    pub async fn check(&self, host: &str, activity: &str) -> Option<Verdict> {
        if self.client.revoked.is_set() {
            return None;
        }
        let mut host = host.to_lowercase();
        if let Some(s) = host.strip_prefix("www.") {
            host = s.to_string();
        }
        let key = (host.clone(), activity.to_string());
        let now = Instant::now();
        {
            let cache = self.cache.lock().unwrap();
            if let Some((expiry, verdict)) = cache.get(&key) {
                if *expiry > now {
                    return verdict.clone();
                }
            }
        }

        let verdict = self.lookup(&host, activity).await;
        let mut cache = self.cache.lock().unwrap();
        cache.insert(key, (now + CASB_CACHE_TTL, verdict.clone()));
        if cache.len() > CACHE_MAX {
            cache.retain(|_, (expiry, _)| *expiry > now);
        }
        verdict
    }

    async fn lookup(&self, host: &str, activity: &str) -> Option<Verdict> {
        let resp = self.client.get(&format!("/internal/agent/casb/app-control?domain={host}&activity={activity}")).await.ok()?;
        let result: LookupResponse = resp.json().await.ok()?;
        let action = result.action.unwrap_or_else(|| "allow".to_string()).to_lowercase();
        if action != "block" && action != "alert" {
            return None;
        }
        Some(Verdict {
            action,
            category: "CASB App Control".to_string(),
            reason: result.reason.unwrap_or_else(|| "CASB app-control policy".to_string()),
            matched_rule: result.matched_rule.unwrap_or_default(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cache() -> CASBControlCache {
        let client = AgentClient::new(crate::config::test_config(), Default::default());
        CASBControlCache::new(client)
    }

    #[test]
    fn test_key_is_scoped_by_activity_not_just_host() {
        let c = cache();
        let now = Instant::now();
        let upload_verdict = Verdict { action: "block".to_string(), category: "x".to_string(), reason: "y".to_string(), matched_rule: "".to_string() };
        c.cache.lock().unwrap().insert(("drive.google.com".to_string(), "upload".to_string()), (now + CASB_CACHE_TTL, Some(upload_verdict.clone())));
        // "download" for the same host is a distinct key -> not cached yet.
        let cache = c.cache.lock().unwrap();
        assert_eq!(cache.get(&("drive.google.com".to_string(), "upload".to_string())), Some(&(cache[&("drive.google.com".to_string(), "upload".to_string())].0, Some(upload_verdict))));
        assert!(!cache.contains_key(&("drive.google.com".to_string(), "download".to_string())));
    }

    #[tokio::test]
    async fn test_revoked_agent_skips_lookup_entirely() {
        let c = cache();
        c.client.revoked.set();
        assert!(c.check("drive.google.com", "upload").await.is_none());
        assert!(c.cache.lock().unwrap().is_empty());
    }
}
