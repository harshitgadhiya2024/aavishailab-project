//! Local copy of the org's domain rules — a faithful port of Python's
//! `PolicyCache`, validated against the same 51-test behavioral spec
//! written for the Python original (scripts/agent/tests/test_policy_cache.py).
//! Until the first successful refresh, `check()` returns None (allow) so a
//! momentarily-unreachable admin API doesn't brick browsing.

use crate::http_client::AgentClient;
use crate::policy_sig::PolicySigVerifier;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct Rule {
    pub domain: String,
    pub action: String,
    #[serde(default)]
    pub reason: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub org_id: Option<String>,
    #[serde(default)]
    pub risk_score: Option<i64>,
}

impl crate::activity::RuleLike for Rule {
    fn category(&self) -> &str {
        &self.category
    }
    fn reason(&self) -> &str {
        &self.reason
    }
    fn risk_score(&self) -> i64 {
        self.risk_score.unwrap_or(0)
    }
}

#[derive(Deserialize)]
struct RulesResponse {
    #[serde(default)]
    rules: Vec<Rule>,
}

pub struct PolicyCache {
    client: AgentClient,
    sig_verifier: PolicySigVerifier,
    by_domain: RwLock<HashMap<String, Vec<Rule>>>,
    loaded: RwLock<bool>,
}

impl PolicyCache {
    pub fn new(client: AgentClient) -> Self {
        let sig_verifier = PolicySigVerifier::new(client.clone());
        PolicyCache { client, sig_verifier, by_domain: RwLock::new(HashMap::new()), loaded: RwLock::new(false) }
    }

    pub async fn refresh(&self) {
        if self.client.revoked.is_set() {
            return;
        }
        self.sig_verifier.ensure_key().await;

        let resp = match self.client.get("/internal/agent/rules").await {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!(error = %e, "rule refresh failed — keeping cached rules");
                return;
            }
        };
        let sig = resp.headers().get("X-Policy-Signature").and_then(|v| v.to_str().ok()).map(str::to_string);
        let key_id = resp.headers().get("X-Policy-Key-Id").and_then(|v| v.to_str().ok()).map(str::to_string);
        let bytes = match resp.bytes().await {
            Ok(b) => b,
            Err(e) => {
                tracing::warn!(error = %e, "rule refresh could not read response body — keeping cached rules");
                return;
            }
        };

        // Reject outright rather than apply an unverified bundle — a
        // network position that can serve a 200 with a plausible-looking
        // JSON body is exactly the threat this signature defends against.
        if !self.sig_verifier.verify(&bytes, sig.as_deref(), key_id.as_deref()) {
            return;
        }

        let body: RulesResponse = match serde_json::from_slice(&bytes) {
            Ok(b) => b,
            Err(e) => {
                tracing::warn!(error = %e, "rule refresh returned unparseable body — keeping cached rules");
                return;
            }
        };

        let mut index: HashMap<String, Vec<Rule>> = HashMap::new();
        for rule in body.rules {
            let domain = rule.domain.trim().to_lowercase();
            if domain.is_empty() {
                continue;
            }
            index.entry(domain).or_default().push(rule);
        }
        let n: usize = index.values().map(|v| v.len()).sum();
        *self.by_domain.write().unwrap() = index;
        *self.loaded.write().unwrap() = true;
        tracing::info!(rule_count = n, "policy cache loaded");
    }

    /// Returns the matching rule, or None if no rule applies (allow).
    pub fn check(&self, domain: &str) -> Option<Rule> {
        if self.client.revoked.is_set() {
            return None;
        }
        let mut domain = domain.to_lowercase();
        if let Some(stripped) = domain.strip_prefix("www.") {
            domain = stripped.to_string();
        }

        let by_domain = self.by_domain.read().unwrap();
        if let Some(rule) = Self::match_domain(&by_domain, &domain) {
            return Some(rule);
        }

        // Walk parent domains (e.g. cdn.instagram.com -> instagram.com),
        // skipping single-label parents to avoid ever blocking a whole TLD.
        let parts: Vec<&str> = domain.split('.').collect();
        for i in 1..parts.len() {
            let parent = parts[i..].join(".");
            if !parent.contains('.') {
                continue;
            }
            if let Some(rule) = Self::match_domain(&by_domain, &parent) {
                return Some(rule);
            }
        }
        None
    }

    fn match_domain(by_domain: &HashMap<String, Vec<Rule>>, domain: &str) -> Option<Rule> {
        let rules = by_domain.get(domain)?;
        // Org-specific rule takes priority over a global (org_id null) one.
        rules.iter().find(|r| r.org_id.is_some()).or_else(|| rules.iter().find(|r| r.org_id.is_none())).cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_cache(rules_by_domain: HashMap<String, Vec<Rule>>) -> PolicyCache {
        let client = crate::http_client::AgentClient::new(crate::config::test_config(), Default::default());
        let cache = PolicyCache::new(client);
        *cache.by_domain.write().unwrap() = rules_by_domain;
        *cache.loaded.write().unwrap() = true;
        cache
    }

    fn rule(domain: &str, action: &str, org_id: Option<&str>) -> Rule {
        Rule { domain: domain.to_string(), action: action.to_string(), reason: String::new(), category: String::new(), org_id: org_id.map(String::from), risk_score: None }
    }

    #[test]
    fn test_no_rule_allows() {
        let cache = make_cache(HashMap::new());
        assert!(cache.check("example.com").is_none());
    }

    #[test]
    fn test_exact_domain_match() {
        let r = rule("evil.com", "block", None);
        let cache = make_cache(HashMap::from([("evil.com".to_string(), vec![r.clone()])]));
        assert_eq!(cache.check("evil.com"), Some(r));
    }

    #[test]
    fn test_www_prefix_is_stripped() {
        let r = rule("evil.com", "block", None);
        let cache = make_cache(HashMap::from([("evil.com".to_string(), vec![r.clone()])]));
        assert_eq!(cache.check("www.evil.com"), Some(r));
    }

    #[test]
    fn test_case_insensitive() {
        let r = rule("evil.com", "block", None);
        let cache = make_cache(HashMap::from([("evil.com".to_string(), vec![r.clone()])]));
        assert_eq!(cache.check("EVIL.COM"), Some(r));
    }

    #[test]
    fn test_walks_up_to_parent_domain() {
        let r = rule("instagram.com", "block", None);
        let cache = make_cache(HashMap::from([("instagram.com".to_string(), vec![r.clone()])]));
        assert_eq!(cache.check("cdn.instagram.com"), Some(r.clone()));
        assert_eq!(cache.check("a.b.c.instagram.com"), Some(r));
    }

    #[test]
    fn test_never_matches_a_bare_tld() {
        let r = rule("com", "block", None);
        let cache = make_cache(HashMap::from([("com".to_string(), vec![r])]));
        assert!(cache.check("example.com").is_none());
    }

    #[test]
    fn test_org_specific_rule_beats_global_rule_regardless_of_order() {
        let global = rule("example.com", "allow", None);
        let org = rule("example.com", "block", Some("org-1"));
        let cache = make_cache(HashMap::from([("example.com".to_string(), vec![global.clone(), org.clone()])]));
        assert_eq!(cache.check("example.com"), Some(org.clone()));

        let cache2 = make_cache(HashMap::from([("example.com".to_string(), vec![org.clone(), global])]));
        assert_eq!(cache2.check("example.com"), Some(org));
    }

    #[test]
    fn test_child_domain_rule_does_not_leak_to_sibling() {
        let r = rule("evil.example.com", "block", None);
        let cache = make_cache(HashMap::from([("evil.example.com".to_string(), vec![r])]));
        assert!(cache.check("safe.example.com").is_none());
        assert!(cache.check("example.com").is_none());
    }

    #[test]
    fn test_revoked_agent_always_allows() {
        let r = rule("evil.com", "block", None);
        let cache = make_cache(HashMap::from([("evil.com".to_string(), vec![r])]));
        cache.client.revoked.set();
        assert!(cache.check("evil.com").is_none());
    }

    #[test]
    fn test_unloaded_cache_allows_everything() {
        let client = crate::http_client::AgentClient::new(crate::config::test_config(), Default::default());
        let cache = PolicyCache::new(client);
        assert!(cache.check("anything.com").is_none());
    }
}
