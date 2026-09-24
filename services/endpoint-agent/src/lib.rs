//! AaviShield endpoint agent — Rust core.
//!
//! Scope (see the module-level docs in each file, and the top-level
//! README, for the full picture): the cross-platform data plane — the
//! MITM/forward proxy, policy/threat/CASB caching, the working-hours
//! enforcement gate, activity reporting, DLP/malware scan integration,
//! heartbeat, device posture, token-file and interactive browser
//! enrollment, software inventory, application control, screenshot
//! capture with input-activity counting, auto-update, the single-
//! instance lock, and the native (egui) desktop window + tray icon.
//! System-proxy configuration is
//! implemented per-OS (Linux fully tested on this build host; macOS/
//! Windows written from the Python original's logic but NOT verified on
//! real hardware — no such hardware is available in this build
//! environment).
//!
//! Still Python-only, and the reason the Python connector remains the
//! shipping binary: the uninstall flow (needs a new GUI screen — an
//! admin email/password prompt — that hasn't been built yet) and
//! packaging for all three platforms. See REQUIREMENT_AUDIT_AND_PLAN.md
//! at the repo root for the phased plan closing that gap.

pub mod activity;
pub mod activity_monitor;
pub mod app_control;
pub mod background;
pub mod block_page;
pub mod casb_cache;
pub mod config;
pub mod deps;
pub mod enforcement;
pub mod gui;
pub mod enroll;
pub mod enroll_interactive;
pub mod heartbeat;
pub mod http_client;
pub mod inventory;
#[cfg(target_os = "macos")]
pub mod mac_window;
pub mod mitm;
pub mod open_apps;
pub mod policy_cache;
pub mod policy_sig;
pub mod posture;
pub mod procutil;
pub mod proxy;
pub mod rfc3339;
pub mod rules;
pub mod scan;
pub mod screenshot;
pub mod screenshot_config;
pub mod single_instance;
pub mod system_proxy;
pub mod threat_cache;
pub mod tray;
pub mod ui_state;
pub mod tls_proxy;
pub mod uninstall;
pub mod update;
