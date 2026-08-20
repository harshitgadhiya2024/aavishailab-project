//! AaviShield endpoint agent — Rust core.
//!
//! Scope (see the module-level docs in each file, and the top-level
//! README, for the full picture): this covers the cross-platform data
//! plane — the MITM/forward proxy, policy/threat/CASB caching, the
//! working-hours enforcement gate, activity reporting, DLP/malware scan
//! integration, heartbeat, token-file enrollment, and auto-update.
//! System-proxy configuration is implemented per-OS (Linux fully tested
//! on this build host; macOS/Windows written from the Python original's
//! logic but NOT verified on real hardware — no such hardware is
//! available in this build environment). Screenshot capture, keystroke/
//! mouse activity counting, the tray UI, and the interactive
//! browser-callback enrollment flow are explicitly out of scope — see the
//! README for why.

pub mod activity;
pub mod casb_cache;
pub mod config;
pub mod deps;
pub mod enforcement;
pub mod enroll;
pub mod heartbeat;
pub mod http_client;
pub mod mitm;
pub mod policy_cache;
pub mod proxy;
pub mod rfc3339;
pub mod rules;
pub mod scan;
pub mod system_proxy;
pub mod threat_cache;
pub mod tls_proxy;
