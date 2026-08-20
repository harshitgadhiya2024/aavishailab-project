//! Runtime configuration, sourced from environment variables — a faithful
//! port of app/config.py. Every value has a safe default so the service
//! boots in development without a `.env`, but the auth secret default is
//! intentionally insecure and MUST be overridden in production.
//!
//! Unlike the Python version's module-level singleton, this is a plain
//! `Clone` struct injected via axum `State` — that makes it trivial for
//! tests to construct a `Config` with overridden values (e.g. a tiny
//! `max_scan_size` to exercise the 413 path) without mutating global state,
//! which is exactly what the Python suite needs `monkeypatch` for.

use std::env;

pub const DEFAULT_SECRET: &str = "dev-insecure-dlp-secret-change-me";

#[derive(Clone, Debug)]
pub struct Config {
    pub service_secret: String,
    pub require_auth: bool,
    pub max_scan_size: usize,
    pub default_block_threshold: i64,
    pub default_alert_threshold: i64,
}

impl Config {
    pub fn using_default_secret(&self) -> bool {
        self.service_secret == DEFAULT_SECRET
    }

    pub fn from_env() -> Self {
        Config {
            service_secret: env::var("DLP_SERVICE_SECRET").unwrap_or_else(|_| DEFAULT_SECRET.to_string()),
            require_auth: env::var("DLP_REQUIRE_AUTH")
                .map(|v| v.eq_ignore_ascii_case("true"))
                .unwrap_or(true),
            max_scan_size: env_usize("DLP_MAX_SCAN_SIZE", 20 * 1024 * 1024),
            default_block_threshold: env_i64("DLP_BLOCK_THRESHOLD", 80),
            default_alert_threshold: env_i64("DLP_ALERT_THRESHOLD", 50),
        }
    }

    /// Test/integration-test helper — a plain injected struct rather than
    /// the Python original's mutable module-level singleton, so tests (unit
    /// AND the tests/ integration suite, which can't see #[cfg(test)] items
    /// in this crate) can construct their own Config without touching env
    /// vars or global state. Mirrors app/auth.py's mint_token, which for
    /// the same reason is a plain always-present function, not test-gated.
    pub fn for_test(secret: &str) -> Self {
        Config {
            service_secret: secret.to_string(),
            require_auth: true,
            max_scan_size: 20 * 1024 * 1024,
            default_block_threshold: 80,
            default_alert_threshold: 50,
        }
    }
}

fn env_usize(key: &str, default: usize) -> usize {
    env::var(key).ok().and_then(|v| v.parse().ok()).unwrap_or(default)
}

fn env_i64(key: &str, default: i64) -> i64 {
    env::var(key).ok().and_then(|v| v.parse().ok()).unwrap_or(default)
}
