//! Whether to capture and how often — a port of Python's `ScreenshotConfig`.
//! Pushed by the server on every heartbeat, the same way `EnforcementGate`
//! and ownership ride it.
//!
//! The "when" is not here: that is `EnforcementGate::captures_screenshots`'s
//! job (working hours / device ownership). This only says whether the
//! company turned screenshots on at all, and the random-interval bounds
//! the capture loop samples from.

use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Snapshot {
    pub enabled: bool,
    pub min_interval_secs: u64,
    pub max_interval_secs: u64,
    pub blur: bool,
}

struct Inner {
    enabled: bool,
    min_interval_secs: u64,
    max_interval_secs: u64,
    blur: bool,
}

impl Default for Inner {
    fn default() -> Self {
        // Off by default — matches the server's own pre-migration default
        // and the Python original: the capturer stays dormant until a
        // heartbeat response says otherwise.
        Inner { enabled: false, min_interval_secs: 60, max_interval_secs: 420, blur: false }
    }
}

#[derive(Clone)]
pub struct ScreenshotConfig(Arc<Mutex<Inner>>);

/// Mirrors the server's own floor in `screenshotConfigFor` — never sample
/// an interval so short the capture loop would dominate the machine.
const MIN_INTERVAL_FLOOR: u64 = 20;

impl ScreenshotConfig {
    pub fn new() -> Self {
        ScreenshotConfig(Arc::new(Mutex::new(Inner::default())))
    }

    /// Applies the `screenshots` object from a heartbeat/config response.
    /// Silently ignored fields keep their previous value rather than
    /// resetting to the default — a heartbeat that omits `blur` should not
    /// un-blur a device mid-session.
    pub fn apply(&self, enabled: bool, min_interval_secs: u64, max_interval_secs: u64, blur: bool) {
        let mut s = self.0.lock().unwrap();
        s.enabled = enabled;
        s.min_interval_secs = min_interval_secs.max(MIN_INTERVAL_FLOOR);
        s.max_interval_secs = max_interval_secs.max(s.min_interval_secs);
        s.blur = blur;
    }

    pub fn snapshot(&self) -> Snapshot {
        let s = self.0.lock().unwrap();
        Snapshot { enabled: s.enabled, min_interval_secs: s.min_interval_secs, max_interval_secs: s.max_interval_secs, blur: s.blur }
    }
}

impl Default for ScreenshotConfig {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_defaults_to_disabled() {
        let cfg = ScreenshotConfig::new();
        assert!(!cfg.snapshot().enabled);
    }

    #[test]
    fn test_apply_enforces_minimum_interval_floor() {
        let cfg = ScreenshotConfig::new();
        cfg.apply(true, 1, 5, false);
        let s = cfg.snapshot();
        assert_eq!(s.min_interval_secs, MIN_INTERVAL_FLOOR);
        // max was below the floored min, so it is pulled up to match —
        // never a max below min, which random-interval sampling requires.
        assert_eq!(s.max_interval_secs, MIN_INTERVAL_FLOOR);
    }

    #[test]
    fn test_apply_round_trips_normal_values() {
        let cfg = ScreenshotConfig::new();
        cfg.apply(true, 60, 420, true);
        let s = cfg.snapshot();
        assert!(s.enabled);
        assert_eq!(s.min_interval_secs, 60);
        assert_eq!(s.max_interval_secs, 420);
        assert!(s.blur);
    }
}
