//! Shared dependencies handed to every connection handler — the Rust
//! equivalent of the constructor args `ProxyConnection.__init__` takes in
//! the Python original (cache, reporter, threats, casb, mitm).

use crate::activity::ActivityReporter;
use crate::casb_cache::CASBControlCache;
use crate::enforcement::EnforcementGate;
use crate::http_client::AgentClient;
use crate::mitm::MitmEngine;
use crate::policy_cache::PolicyCache;
use crate::threat_cache::ThreatIntelCache;
use std::sync::Arc;

pub struct Deps {
    pub client: AgentClient,
    pub policy: Arc<PolicyCache>,
    pub threats: Arc<ThreatIntelCache>,
    pub casb: Arc<CASBControlCache>,
    pub mitm: Arc<MitmEngine>,
    pub reporter: Arc<ActivityReporter>,
    pub gate: Arc<EnforcementGate>,
}
