//! Device posture collection — a port of Python's `collect_posture()`.
//!
//! Best-effort, per signal: each field is `Some(true)`, `Some(false)` or
//! `None` (unknown — tool missing, unsupported OS, or the probe failed),
//! and the server's posture-service scores `None` as a partial penalty
//! rather than treating it as either pass or fail. Nothing here is ever
//! fatal to the heartbeat it rides on: a probe that can't run just leaves
//! its field `None`.
//!
//! Every probe shells out to a tool the OS already ships, through
//! `procutil::run` — the same safe-drain-with-timeout helper inventory.rs
//! uses, because a posture probe hangs in exactly the same way a package
//! manager can, and here a hang would stall the heartbeat that carries the
//! working-hours enforcement verdict. `PROBE_TIMEOUT` is deliberately much
//! shorter than inventory's: this runs on every heartbeat, not once an
//! hour, and the whole point is to never be the slow part of one.

use crate::procutil::run;
use serde::Serialize;
use std::time::Duration;

const PROBE_TIMEOUT: Duration = Duration::from_secs(3);

/// Field names match `postureclient.Signals` on the server exactly — see
/// `services/admin-api/internal/postureclient/client.go` — so this
/// serializes straight into the heartbeat body with no translation layer.
#[derive(Debug, Default, Serialize, PartialEq, Eq)]
pub struct Signals {
    pub disk_encryption: Option<bool>,
    pub firewall: Option<bool>,
    pub os_up_to_date: Option<bool>,
    pub screen_lock: Option<bool>,
    pub antivirus: Option<bool>,
    pub os_type: String,
    pub os_version: String,
}

/// Collects every signal for the current platform. Synchronous and
/// blocking (several subprocess round-trips) — callers run this via
/// `tokio::task::spawn_blocking`, the same pattern `inventory::collect`
/// uses, so it never blocks the async heartbeat loop it feeds.
pub fn collect() -> Signals {
    let mut s = Signals { os_type: os_type_str().to_string(), os_version: os_version(), ..Default::default() };

    if cfg!(target_os = "macos") {
        collect_macos(&mut s);
    } else if cfg!(target_os = "linux") {
        collect_linux(&mut s);
    } else if cfg!(target_os = "windows") {
        collect_windows(&mut s);
    }

    s
}

fn collect_macos(s: &mut Signals) {
    if let Some(out) = run("fdesetup", &["status"], PROBE_TIMEOUT) {
        s.disk_encryption = Some(out.contains("FileVault is On"));
    }
    if let Some(out) = run("/usr/libexec/ApplicationFirewall/socketfilterfw", &["--getglobalstate"], PROBE_TIMEOUT) {
        s.firewall = Some(out.to_lowercase().contains("enabled"));
    }
    if let Some(out) = run("defaults", &["read", "com.apple.screensaver", "askForPassword"], PROBE_TIMEOUT) {
        s.screen_lock = Some(out.trim() == "1");
    }
}

fn collect_linux(s: &mut Signals) {
    if let Some(out) = run("lsblk", &["-o", "TYPE"], PROBE_TIMEOUT) {
        s.disk_encryption = Some(out.contains("crypt"));
    }
    if let Some(out) = run("ufw", &["status"], PROBE_TIMEOUT) {
        s.firewall = Some(out.contains("Status: active"));
    } else if let Some(out) = run("systemctl", &["is-active", "firewalld"], PROBE_TIMEOUT) {
        s.firewall = Some(out.trim() == "active");
    }
}

fn collect_windows(s: &mut Signals) {
    if let Some(out) = run("netsh", &["advfirewall", "show", "allprofiles", "state"], PROBE_TIMEOUT) {
        s.firewall = Some(out.to_uppercase().contains("ON"));
    }
}

fn os_type_str() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else {
        "linux"
    }
}

/// Best-effort OS version string for the heartbeat's `os_version` field.
/// None of these tools are guaranteed present on every distro; `None` here
/// just leaves the field blank, the same as an unresolved posture signal.
fn os_version() -> String {
    if cfg!(target_os = "macos") {
        run("sw_vers", &["-productVersion"], PROBE_TIMEOUT).map(|s| s.trim().to_string()).unwrap_or_default()
    } else if cfg!(target_os = "windows") {
        run("cmd", &["/C", "ver"], PROBE_TIMEOUT).map(|s| s.trim().to_string()).unwrap_or_default()
    } else {
        run("uname", &["-r"], PROBE_TIMEOUT).map(|s| s.trim().to_string()).unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_signals_serializes_with_server_field_names() {
        let s = Signals { disk_encryption: Some(true), firewall: Some(false), ..Default::default() };
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains("\"disk_encryption\":true"));
        assert!(json.contains("\"firewall\":false"));
        assert!(json.contains("\"os_up_to_date\":null"));
        assert!(json.contains("\"antivirus\":null"));
    }

    #[test]
    fn test_os_type_str_matches_current_platform() {
        // Whatever platform this test runs on, the value must be one of
        // the three the server's postureclient.Signals actually expects.
        assert!(["windows", "darwin", "linux"].contains(&os_type_str()));
    }

    #[test]
    fn test_collect_never_panics_and_sets_os_type() {
        // The real point of this test: collect() must be infallible on
        // whatever machine runs it (CI included, which has none of the
        // OS-specific tools these probes shell out to) — every probe
        // failing should just leave fields None, never panic.
        let s = collect();
        assert!(!s.os_type.is_empty());
    }
}
