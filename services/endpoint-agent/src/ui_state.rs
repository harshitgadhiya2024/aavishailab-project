//! Shared connector state — a port of Python's `AgentState`.
//!
//! One `Arc<Mutex<Inner>>`, written from background tasks (enrollment,
//! heartbeat, the GUI's own button handlers) and read once per frame by the
//! GUI. The split exists because the GUI event loop and the background
//! agent loops run on different OS threads (see main.rs) and neither may
//! block on the other: a heartbeat that stalls must never freeze the
//! window, and a window redraw must never delay a policy refresh.

use std::sync::{Arc, Mutex};
use std::time::Instant;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnState {
    Disconnected,
    Connecting,
    Connected,
    /// Only ever reached on a personal device outside its working-hours
    /// window — the server forces company hardware to "full", so this
    /// state cannot appear there. Mirrors `EnforcementGate`'s "paused" mode.
    Paused,
    /// The server refused enrollment because this machine already has a
    /// device row (see EnrollmentBlocked in the Python original) — terminal
    /// until an administrator clears it, not a retry.
    Blocked,
    /// The device's registration was removed on the server, so the agent
    /// stopped enforcing. Distinct from Disconnected: this device *was*
    /// connected and lost that status from the other side, not by the
    /// employee's own action.
    Revoked,
}

#[derive(Debug, Clone)]
pub struct Snapshot {
    pub state: ConnState,
    /// Notice body for Blocked/Revoked — the server's own wording when it
    /// has one, otherwise a fallback the GUI supplies.
    pub message: String,
    /// Why the device is paused (a schedule's own reason string).
    pub reason: String,
    pub org_name: String,
    pub employee_name: String,
    pub uptime: String,
    /// "company" | "personal". Drives whether Disconnect is offered at all —
    /// see the comment on set_ownership.
    pub ownership: String,
    /// None = not applicable (not intercepting yet, or this platform trusts
    /// the CA some other way). Some(false) is what shows the "finish setup"
    /// notice; Some(true) clears it.
    pub https_ready: Option<bool>,
    pub uninstall_allowed: bool,
}

struct Inner {
    state: ConnState,
    message: String,
    reason: String,
    org_name: String,
    employee_name: String,
    connected_at: Option<Instant>,
    ownership: String,
    https_ready: Option<bool>,
    uninstall_allowed: bool,
}

impl Default for Inner {
    fn default() -> Self {
        Inner {
            state: ConnState::Disconnected,
            message: String::new(),
            reason: String::new(),
            org_name: String::new(),
            employee_name: String::new(),
            connected_at: None,
            // Company is the default and the stricter of the two — see the
            // matching comment on the Python/Rust connector's set_ownership.
            // A device that hasn't heard from the server yet must not offer
            // Disconnect just because nobody's said "personal" yet.
            ownership: "company".to_string(),
            https_ready: None,
            uninstall_allowed: false,
        }
    }
}

#[derive(Clone)]
pub struct UiState(Arc<Mutex<Inner>>);

impl UiState {
    pub fn new() -> Self {
        UiState(Arc::new(Mutex::new(Inner::default())))
    }

    pub fn snapshot(&self) -> Snapshot {
        let s = self.0.lock().unwrap();
        let uptime = match (s.state, s.connected_at) {
            (ConnState::Connected | ConnState::Paused, Some(t)) => format_uptime(t.elapsed()),
            _ => String::new(),
        };
        Snapshot {
            state: s.state,
            message: s.message.clone(),
            reason: s.reason.clone(),
            org_name: s.org_name.clone(),
            employee_name: s.employee_name.clone(),
            uptime,
            ownership: s.ownership.clone(),
            https_ready: s.https_ready,
            uninstall_allowed: s.uninstall_allowed,
        }
    }

    pub fn set_connecting(&self) {
        let mut s = self.0.lock().unwrap();
        s.state = ConnState::Connecting;
        s.message.clear();
    }

    pub fn set_connected(&self, org_name: impl Into<String>, employee_name: impl Into<String>) {
        let mut s = self.0.lock().unwrap();
        s.state = ConnState::Connected;
        s.org_name = org_name.into();
        s.employee_name = employee_name.into();
        s.connected_at.get_or_insert_with(Instant::now);
    }

    pub fn set_disconnected(&self) {
        let mut s = self.0.lock().unwrap();
        s.state = ConnState::Disconnected;
        s.connected_at = None;
    }

    /// Applies the working-hours verdict. Only ever moves between
    /// Connected and Paused — a device that is Disconnected, Connecting,
    /// Blocked or Revoked has nothing for a schedule to act on yet.
    pub fn apply_mode(&self, mode: &str, reason: &str) {
        let mut s = self.0.lock().unwrap();
        if !matches!(s.state, ConnState::Connected | ConnState::Paused) {
            return;
        }
        s.state = if mode == "paused" { ConnState::Paused } else { ConnState::Connected };
        s.reason = reason.to_string();
    }

    pub fn set_blocked(&self, message: impl Into<String>) {
        let mut s = self.0.lock().unwrap();
        s.state = ConnState::Blocked;
        s.message = message.into();
    }

    pub fn set_revoked(&self, message: impl Into<String>) {
        let mut s = self.0.lock().unwrap();
        s.state = ConnState::Revoked;
        s.message = message.into();
        s.connected_at = None;
    }

    pub fn set_https_ready(&self, ready: Option<bool>) {
        self.0.lock().unwrap().https_ready = ready;
    }

    /// Anything other than an explicit "personal" is company — see the
    /// matching guarantee on the Python/Rust connector's own set_ownership:
    /// a missing or unrecognised value must never be what hands somebody a
    /// Disconnect button on company hardware.
    pub fn set_ownership(&self, ownership: &str) {
        self.0.lock().unwrap().ownership =
            if ownership == "personal" { "personal".to_string() } else { "company".to_string() };
    }

    pub fn set_uninstall_allowed(&self, allowed: bool) {
        self.0.lock().unwrap().uninstall_allowed = allowed;
    }
}

impl Default for UiState {
    fn default() -> Self {
        Self::new()
    }
}

fn format_uptime(elapsed: std::time::Duration) -> String {
    let secs = elapsed.as_secs();
    if secs >= 3600 {
        format!("{}h {}m", secs / 3600, (secs % 3600) / 60)
    } else {
        format!("{}m", secs / 60)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_starts_disconnected_with_company_ownership() {
        let s = UiState::new().snapshot();
        assert_eq!(s.state, ConnState::Disconnected);
        assert_eq!(s.ownership, "company");
    }

    #[test]
    fn test_connect_then_disconnect_clears_connected_at() {
        let ui = UiState::new();
        ui.set_connected("Acme", "Priya");
        assert_eq!(ui.snapshot().state, ConnState::Connected);
        ui.set_disconnected();
        let s = ui.snapshot();
        assert_eq!(s.state, ConnState::Disconnected);
        assert_eq!(s.uptime, "");
    }

    #[test]
    fn test_apply_mode_only_acts_while_connected_or_paused() {
        let ui = UiState::new();
        // Disconnected: a schedule has nothing to act on.
        ui.apply_mode("paused", "Outside working hours");
        assert_eq!(ui.snapshot().state, ConnState::Disconnected);

        ui.set_connected("Acme", "Priya");
        ui.apply_mode("paused", "Outside working hours");
        let s = ui.snapshot();
        assert_eq!(s.state, ConnState::Paused);
        assert_eq!(s.reason, "Outside working hours");

        ui.apply_mode("full", "");
        assert_eq!(ui.snapshot().state, ConnState::Connected);
    }

    #[test]
    fn test_apply_mode_ignores_blocked_and_revoked() {
        let ui = UiState::new();
        ui.set_blocked("already registered");
        ui.apply_mode("paused", "x");
        assert_eq!(ui.snapshot().state, ConnState::Blocked);

        ui.set_revoked("removed");
        ui.apply_mode("full", "x");
        assert_eq!(ui.snapshot().state, ConnState::Revoked);
    }

    #[test]
    fn test_ownership_unrecognised_values_default_to_company() {
        let ui = UiState::new();
        for v in ["", "Personal", "PERSONAL", "corp", "unknown"] {
            ui.set_ownership(v);
            assert_eq!(ui.snapshot().ownership, "company", "value {v:?} should not unlock personal");
        }
        ui.set_ownership("personal");
        assert_eq!(ui.snapshot().ownership, "personal");
    }

    #[test]
    fn test_revoked_clears_uptime() {
        let ui = UiState::new();
        ui.set_connected("Acme", "Priya");
        ui.set_revoked("gone");
        assert_eq!(ui.snapshot().uptime, "");
    }
}
