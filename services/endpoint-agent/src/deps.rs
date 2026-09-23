//! Shared dependencies handed to every connection handler — the Rust
//! equivalent of the constructor args `ProxyConnection.__init__` takes in
//! the Python original (cache, reporter, threats, casb, mitm).

use crate::activity::ActivityReporter;
use crate::block_page::BrandingCache;
use crate::casb_cache::CASBControlCache;
use crate::enforcement::EnforcementGate;
use crate::http_client::AgentClient;
use crate::mitm::MitmEngine;
use crate::policy_cache::PolicyCache;
use crate::screenshot_config::ScreenshotConfig;
use crate::threat_cache::ThreatIntelCache;
use crate::ui_state::UiState;
use std::sync::Arc;

pub struct Deps {
    pub client: AgentClient,
    pub policy: Arc<PolicyCache>,
    pub threats: Arc<ThreatIntelCache>,
    pub casb: Arc<CASBControlCache>,
    pub mitm: Arc<MitmEngine>,
    pub reporter: Arc<ActivityReporter>,
    pub gate: Arc<EnforcementGate>,
    /// The company's own name/logo/message for the block page.
    pub branding: Arc<BrandingCache>,
    /// What the desktop window shows. Updated from the heartbeat loop
    /// (mode/org/employee/ownership) and read every frame by the GUI —
    /// never the other way around, so a slow or absent GUI can never
    /// delay enforcement.
    pub ui: UiState,
    /// Whether the org has screenshots on, and the random-interval bounds —
    /// updated by every heartbeat/config response, read by
    /// `screenshot::ScreenshotCapturer`'s loop. Already cheaply `Clone`
    /// (an `Arc<Mutex<..>>` internally, like `UiState`), so it is not
    /// wrapped in another `Arc` here.
    pub screenshots: ScreenshotConfig,
}
