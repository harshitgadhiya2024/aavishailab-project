//! The BYOD working-hours gate — a faithful port of Python's
//! `EnforcementGate`, validated against the same behavioral spec as
//! scripts/agent/tests/test_enforcement_gate.py.
//!
//! The schedule is evaluated on the SERVER, never here — this agent runs
//! on hardware whose clock and timezone belong to the person being
//! monitored, so deciding locally would mean "set the clock to Sunday"
//! turns enforcement off. The server sends a verdict plus the instant it
//! expires; this holds that verdict against a **monotonic** `Instant`
//! (`std::time::Instant`, not wall-clock time), so moving the system
//! clock forward doesn't end the working day early either.

use serde::Deserialize;
use std::sync::RwLock;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, PartialEq)]
pub enum Mode {
    Full,
    SecurityOnly,
    Paused,
}

impl Mode {
    fn from_str(s: &str) -> Mode {
        match s {
            "security_only" => Mode::SecurityOnly,
            "paused" => Mode::Paused,
            _ => Mode::Full,
        }
    }
    pub fn as_str(&self) -> &'static str {
        match self {
            Mode::Full => "full",
            Mode::SecurityOnly => "security_only",
            Mode::Paused => "paused",
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct EnforcementPayload {
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub active: Option<bool>,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub until: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
}

struct State {
    mode: Mode,
    reason: String,
    #[allow(dead_code)] // recorded for display/logging parity with the Python original
    expires_at: Option<Instant>,
    until_text: String,
    #[allow(dead_code)]
    source: String,
}

pub struct EnforcementGate {
    state: RwLock<State>,
}

impl Default for EnforcementGate {
    fn default() -> Self {
        EnforcementGate {
            state: RwLock::new(State { mode: Mode::Full, reason: "Enforcing continuously".to_string(), expires_at: None, until_text: String::new(), source: String::new() }),
        }
    }
}

impl EnforcementGate {
    pub fn mode(&self) -> Mode {
        self.state.read().unwrap().mode.clone()
    }
    pub fn reason(&self) -> String {
        self.state.read().unwrap().reason.clone()
    }
    pub fn until_text(&self) -> String {
        self.state.read().unwrap().until_text.clone()
    }

    /// Should the system proxy point at us at all?
    pub fn intercepts(&self) -> bool {
        self.mode() != Mode::Paused
    }
    /// Domain block/allow rules and application-control domains.
    pub fn enforces_policy(&self) -> bool {
        self.mode() == Mode::Full
    }
    pub fn enforces_dlp(&self) -> bool {
        self.mode() == Mode::Full
    }
    pub fn enforces_app_control(&self) -> bool {
        self.mode() == Mode::Full
    }
    /// Malware scanning protects the machine, not the company's view of
    /// the person — so it survives into security_only.
    pub fn scans_downloads(&self) -> bool {
        matches!(self.mode(), Mode::Full | Mode::SecurityOnly)
    }
    pub fn checks_threat_intel(&self) -> bool {
        matches!(self.mode(), Mode::Full | Mode::SecurityOnly)
    }
    /// Screenshots and activity tracking are monitoring, not machine
    /// protection — full enforcement only.
    pub fn captures_screenshots(&self) -> bool {
        self.mode() == Mode::Full
    }
    /// `activity` is ordinary browsing telemetry; `security` is a malware
    /// or threat-intel block. Off hours, only the latter is defensible.
    pub fn logs(&self, kind: &str) -> bool {
        match self.mode() {
            Mode::Full => true,
            Mode::SecurityOnly => kind == "security",
            Mode::Paused => false,
        }
    }

    /// Takes the heartbeat's enforcement block. Returns the new mode if it
    /// changed, else None.
    pub fn apply(&self, payload: &EnforcementPayload, server_time: Option<&str>) -> Option<Mode> {
        let mode = match &payload.mode {
            Some(m) => Mode::from_str(m),
            None => {
                if payload.active.unwrap_or(true) {
                    Mode::Full
                } else {
                    Mode::Paused
                }
            }
        };

        let mut expires_at = None;
        let mut until_text = String::new();
        if let Some(until) = &payload.until {
            if let Some(remaining) = crate::rfc3339::seconds_between(server_time, until) {
                if remaining > 0.0 {
                    expires_at = Some(Instant::now() + Duration::from_secs_f64(remaining));
                }
            }
            until_text = until.clone();
        }

        let mut state = self.state.write().unwrap();
        let changed = mode != state.mode;
        state.mode = mode.clone();
        state.reason = payload.reason.clone().unwrap_or_default();
        state.source = payload.source.clone().unwrap_or_default();
        state.expires_at = expires_at;
        state.until_text = until_text;
        if changed {
            Some(mode)
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload(mode: &str) -> EnforcementPayload {
        EnforcementPayload { mode: Some(mode.to_string()), active: None, reason: None, until: None, source: None }
    }

    #[test]
    fn test_default_mode_is_full() {
        let gate = EnforcementGate::default();
        assert_eq!(gate.mode(), Mode::Full);
        assert!(gate.intercepts());
        assert!(gate.enforces_policy());
        assert!(gate.enforces_dlp());
        assert!(gate.enforces_app_control());
        assert!(gate.scans_downloads());
        assert!(gate.checks_threat_intel());
        assert!(gate.captures_screenshots());
        assert!(gate.logs("activity"));
        assert!(gate.logs("security"));
    }

    #[test]
    fn test_paused_mode_disables_everything_including_interception() {
        let gate = EnforcementGate::default();
        gate.apply(&payload("paused"), None);
        assert_eq!(gate.mode(), Mode::Paused);
        assert!(!gate.intercepts());
        assert!(!gate.enforces_policy());
        assert!(!gate.enforces_dlp());
        assert!(!gate.enforces_app_control());
        assert!(!gate.scans_downloads());
        assert!(!gate.checks_threat_intel());
        assert!(!gate.captures_screenshots());
        assert!(!gate.logs("activity"));
        assert!(!gate.logs("security"));
    }

    #[test]
    fn test_security_only_mode_keeps_machine_protection_drops_monitoring() {
        let gate = EnforcementGate::default();
        gate.apply(&payload("security_only"), None);
        assert_eq!(gate.mode(), Mode::SecurityOnly);
        assert!(gate.intercepts());
        assert!(!gate.enforces_policy());
        assert!(!gate.enforces_dlp());
        assert!(!gate.enforces_app_control());
        assert!(gate.scans_downloads());
        assert!(gate.checks_threat_intel());
        assert!(!gate.captures_screenshots());
        assert!(!gate.logs("activity"));
        assert!(gate.logs("security"));
    }

    #[test]
    fn test_apply_returns_new_mode_only_on_change() {
        let gate = EnforcementGate::default();
        assert_eq!(gate.apply(&payload("full"), None), None);
        assert_eq!(gate.apply(&payload("paused"), None), Some(Mode::Paused));
        assert_eq!(gate.apply(&payload("paused"), None), None);
        assert_eq!(gate.apply(&payload("full"), None), Some(Mode::Full));
    }

    #[test]
    fn test_apply_defaults_unknown_mode_to_full() {
        let gate = EnforcementGate::default();
        gate.apply(&payload("paused"), None);
        gate.apply(&payload("nonsense"), None);
        assert_eq!(gate.mode(), Mode::Full);
    }

    #[test]
    fn test_apply_active_flag_without_mode_maps_to_full_or_paused() {
        let gate = EnforcementGate::default();
        gate.apply(&EnforcementPayload { mode: None, active: Some(false), reason: None, until: None, source: None }, None);
        assert_eq!(gate.mode(), Mode::Paused);
        gate.apply(&EnforcementPayload { mode: None, active: Some(true), reason: None, until: None, source: None }, None);
        assert_eq!(gate.mode(), Mode::Full);
    }

    #[test]
    fn test_reason_and_until_text_are_recorded() {
        let gate = EnforcementGate::default();
        gate.apply(
            &EnforcementPayload { mode: Some("paused".to_string()), active: None, reason: Some("Friday 6pm schedule".to_string()), until: Some("2026-01-01T00:00:00Z".to_string()), source: None },
            None,
        );
        assert_eq!(gate.reason(), "Friday 6pm schedule");
        assert_eq!(gate.until_text(), "2026-01-01T00:00:00Z");
    }
}
