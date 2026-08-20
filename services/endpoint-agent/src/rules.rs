//! `effective_rule` — a port of Python's `ProxyConnection._effective_rule`.
//! Policy rules express the company's preference about someone's browsing
//! and stop at the end of the working day; threat intelligence protects
//! the machine and survives into security_only. When everything is
//! paused, neither applies (belt-and-braces alongside the system proxy
//! having been removed entirely in that mode).

use crate::activity::RuleLike;
use crate::deps::Deps;

/// A flattened view over "a domain rule matched" / "a threat-intel
/// verdict matched" / "nothing matched" — both source types carry
/// action/category/reason/risk_score, just via different structs, so this
/// normalizes them once instead of every caller matching on which one it
/// got.
pub struct EffectiveRule {
    pub action: String, // "block" | "alert" | "" (no rule)
    pub reason: String,
    pub category: String,
    pub risk_score: i64,
}

impl EffectiveRule {
    pub fn none() -> Self {
        EffectiveRule { action: String::new(), reason: String::new(), category: String::new(), risk_score: 0 }
    }
    pub fn matched(&self) -> bool {
        !self.action.is_empty()
    }
    /// Borrow as the trait ActivityReporter::record expects.
    pub fn as_rule_like(&self) -> Option<&dyn RuleLike> {
        if self.matched() {
            Some(self)
        } else {
            None
        }
    }
}

impl RuleLike for EffectiveRule {
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

pub async fn effective_rule(deps: &Deps, host: &str) -> EffectiveRule {
    let policy_rule = if deps.gate.enforces_policy() { deps.policy.check(host) } else { None };
    let threat = if deps.gate.checks_threat_intel() { deps.threats.check(host).await } else { None };

    if let Some(r) = &policy_rule {
        if r.action == "block" {
            return EffectiveRule { action: "block".to_string(), reason: r.reason.clone(), category: r.category.clone(), risk_score: r.risk_score.unwrap_or(0) };
        }
    }
    if let Some(t) = &threat {
        if t.action == "block" {
            return EffectiveRule { action: "block".to_string(), reason: t.reason.clone(), category: t.category.clone(), risk_score: t.risk_score };
        }
    }
    if let Some(r) = policy_rule {
        return EffectiveRule { action: r.action.clone(), reason: r.reason.clone(), category: r.category.clone(), risk_score: r.risk_score.unwrap_or(0) };
    }
    if let Some(t) = threat {
        return EffectiveRule { action: t.action.clone(), reason: t.reason.clone(), category: t.category.clone(), risk_score: t.risk_score };
    }
    EffectiveRule::none()
}

/// CASB inline app-control check for an upload — a port of
/// `_casb_upload_verdict`.
pub async fn casb_upload_verdict(deps: &Deps, host: &str) -> Option<crate::casb_cache::Verdict> {
    if !deps.gate.enforces_dlp() {
        return None;
    }
    deps.casb.check(host, "upload").await
}
