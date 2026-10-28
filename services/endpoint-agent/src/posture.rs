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
    s.screen_lock = macos::screen_lock();
    s.os_up_to_date = macos::os_up_to_date(&s.os_version);
    s.antivirus = macos::antivirus();
}

/// The three macOS signals that used to come back unknown on every Mac.
///
/// - Screen lock read `com.apple.screensaver askForPassword`, a key macOS
///   stopped writing in High Sierra; the setting now lives where only
///   `sysadminctl -screenLock` can read it.
/// - OS-up-to-date and antivirus had no macOS probe at all.
///
/// Each one reads local state only, never the network: `softwareupdate -l`
/// would give a fresher answer but takes tens of seconds, and this runs on
/// every heartbeat with a 3-second budget per probe. The parsing is kept in
/// pure functions so the decisions are unit-tested without a Mac.
mod macos {
    use super::PROBE_TIMEOUT;
    use crate::procutil::{run, run_combined};

    const SU_PLIST: &str = "/Library/Preferences/com.apple.SoftwareUpdate.plist";

    /// Longest acceptable gap between going idle and the screen locking.
    /// Matches the 15-minute default most MDM baselines use.
    const MAX_LOCK_SECS: u64 = 15 * 60;

    /// A software update check older than this says nothing reliable about
    /// what is pending, so the answer becomes unknown instead of a guess.
    const MAX_SCAN_AGE_DAYS: u64 = 30;

    /// Screen lock passes only when the Mac both requires a password on
    /// wake and actually goes idle by itself (display sleep or screen saver)
    /// within `MAX_LOCK_SECS`. A password that is never asked for because
    /// the display never sleeps does not protect an unattended laptop.
    pub fn screen_lock() -> Option<bool> {
        let password = match run_combined("sysadminctl", &["-screenLock", "status"], PROBE_TIMEOUT) {
            Some((_, out)) if out.contains("screenLock") => parse_screen_lock_delay(&out),
            // macOS 12 and older have no -screenLock; the old key still works there.
            _ => run("defaults", &["read", "com.apple.screensaver", "askForPassword"], PROBE_TIMEOUT).map(|o| (o.trim() == "1").then_some(0)),
        }?;
        let Some(delay) = password else { return Some(false) };

        let display_sleep = run("pmset", &["-g"], PROBE_TIMEOUT).and_then(|o| parse_display_sleep_mins(&o)).map(|m| m * 60);
        let saver = run("defaults", &["-currentHost", "read", "com.apple.screensaver", "idleTime"], PROBE_TIMEOUT)
            .and_then(|o| o.trim().parse::<u64>().ok());
        auto_lock_ok(delay, display_sleep, saver)
    }

    /// `sysadminctl -screenLock status` → `Some(Some(delay_secs))` when a
    /// password is required, `Some(None)` when it is off, `None` when the
    /// output is not one we know.
    pub(super) fn parse_screen_lock_delay(out: &str) -> Option<Option<u64>> {
        if out.contains("screenLock is off") {
            return Some(None);
        }
        let rest = out.split("screenLock delay is ").nth(1)?;
        if rest.starts_with("immediate") {
            return Some(Some(0));
        }
        let n: u64 = rest.split_whitespace().next()?.parse().ok()?;
        Some(Some(n))
    }

    /// `pmset -g` prints ` displaysleep         10` (minutes; 0 = never),
    /// sometimes followed by a note about what is preventing sleep.
    pub(super) fn parse_display_sleep_mins(out: &str) -> Option<u64> {
        out.lines().find_map(|l| {
            let mut it = l.split_whitespace();
            (it.next() == Some("displaysleep")).then(|| it.next()?.parse().ok()).flatten()
        })
    }

    /// `delay` is the password grace period; `display_sleep_secs` and
    /// `saver_secs` are the idle timers (0 or missing = never).
    pub(super) fn auto_lock_ok(delay: u64, display_sleep_secs: Option<u64>, saver_secs: Option<u64>) -> Option<bool> {
        let idle = [display_sleep_secs, saver_secs].into_iter().flatten().filter(|&s| s > 0).min();
        match idle {
            Some(idle) => Some(idle + delay <= MAX_LOCK_SECS),
            // Display sleep is "never". Without a readable screen-saver
            // timer we cannot tell whether anything else ever locks it.
            None if saver_secs.is_none() => None,
            None => Some(false),
        }
    }

    /// False when macOS itself is offering an update to the release line
    /// this Mac is already on (26.6.2 → 26.7.2, or a Rapid Security
    /// Response). A new *major* release (26 → 27) does not count: holding
    /// majors back for app compatibility is a normal company decision, and
    /// Apple keeps shipping security fixes to the previous line.
    pub fn os_up_to_date(current: &str) -> Option<bool> {
        if current.is_empty() {
            return None;
        }
        let last = run("plutil", &["-extract", "LastSuccessfulDate", "raw", "-o", "-", SU_PLIST], PROBE_TIMEOUT)?;
        let scanned = crate::rfc3339::parse(Some(last.trim()))?;
        let age_days = (time::OffsetDateTime::now_utc() - scanned).whole_days();
        if age_days > MAX_SCAN_AGE_DAYS as i64 {
            return None;
        }
        // A missing key after a successful scan means nothing is pending.
        let pending = run("plutil", &["-extract", "RecommendedUpdates", "json", "-o", "-", SU_PLIST], PROBE_TIMEOUT).unwrap_or_else(|| "[]".into());
        Some(!has_same_line_os_update(&pending, current))
    }

    pub(super) fn has_same_line_os_update(recommended_json: &str, current: &str) -> bool {
        let Ok(items) = serde_json::from_str::<Vec<serde_json::Value>>(recommended_json) else { return false };
        let cur = numeric_parts(current);
        items.iter().any(|item| {
            let name = item.get("Display Name").and_then(|v| v.as_str()).unwrap_or("");
            let is_os = item.get("MobileSoftwareUpdate").and_then(|v| v.as_bool()).unwrap_or(false) || name.starts_with("macOS");
            let Some(version) = item.get("Display Version").and_then(|v| v.as_str()) else { return false };
            let offered = numeric_parts(version);
            is_os && offered.first() == cur.first() && (offered > cur || (offered == cur && version.trim() != current.trim()))
        })
    }

    fn numeric_parts(v: &str) -> Vec<u64> {
        let mut parts: Vec<u64> = v.split_whitespace().next().unwrap_or("").split('.').filter_map(|p| p.parse().ok()).collect();
        while parts.len() < 3 {
            parts.push(0);
        }
        parts
    }

    /// Process-name fragments of the third-party AV/EDR products companies
    /// actually deploy on Macs. Matched against `ps` output, lowercased.
    const THIRD_PARTY_AV: &[&str] = &[
        "crowdstrike", "sentineld", "sentinelone", "sophos", "wdavdaemon", "malwarebytes", "rtprotectiondaemon", "esets", "bdldaemon",
        "bitdefender", "symdaemon", "norton", "avast", "kaspersky", "trendmicro", "icoreservice", "cbdaemon", "carbonblack", "cylance",
        "intego", "webroot", "jamf protect", "jamfprotect", "elastic-endpoint", "cortex xdr", "cortex-xdr",
    ];

    /// Passes with a running third-party AV/EDR, or with Apple's built-in
    /// protection intact: XProtect present, Gatekeeper on, and XProtect's
    /// definition updates not switched off. XProtect cannot be disabled,
    /// but Gatekeeper and the definition feed can — and with either off,
    /// the built-in protection stops doing its job.
    pub fn antivirus() -> Option<bool> {
        if let Some(ps) = run("ps", &["-axo", "comm="], PROBE_TIMEOUT) {
            if third_party_av_running(&ps) {
                return Some(true);
            }
        }
        let xprotect = ["/Library/Apple/System/Library/CoreServices/XProtect.bundle", "/System/Library/CoreServices/XProtect.bundle"]
            .iter()
            .any(|p| std::path::Path::new(p).exists());
        if !xprotect {
            return None;
        }
        let gatekeeper_on = match run_combined("spctl", &["--status"], PROBE_TIMEOUT) {
            Some((_, out)) if out.contains("assessments enabled") => true,
            Some((_, out)) if out.contains("assessments disabled") => false,
            _ => return None,
        };
        let definitions_off = run("plutil", &["-extract", "ConfigDataInstall", "raw", "-o", "-", SU_PLIST], PROBE_TIMEOUT)
            .is_some_and(|v| v.trim() == "false");
        Some(gatekeeper_on && !definitions_off)
    }

    pub(super) fn third_party_av_running(ps: &str) -> bool {
        let ps = ps.to_lowercase();
        ps.lines().any(|l| {
            let name = l.rsplit('/').next().unwrap_or(l);
            THIRD_PARTY_AV.iter().any(|m| l.contains(&format!("/{m}")) || name.contains(m))
        })
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
    fn test_screen_lock_delay_parses_every_sysadminctl_answer() {
        assert_eq!(macos::parse_screen_lock_delay("2026-10-28 sysadminctl[1] screenLock delay is immediate\n"), Some(Some(0)));
        assert_eq!(macos::parse_screen_lock_delay("screenLock delay is 300 seconds\n"), Some(Some(300)));
        assert_eq!(macos::parse_screen_lock_delay("screenLock is off\n"), Some(None));
        assert_eq!(macos::parse_screen_lock_delay("something else"), None);
    }

    #[test]
    fn test_display_sleep_reads_the_minutes_column() {
        let out = " sleep                1\n displaysleep         10 (display sleep prevented by Zoom)\n disksleep 10\n";
        assert_eq!(macos::parse_display_sleep_mins(out), Some(10));
        assert_eq!(macos::parse_display_sleep_mins(" displaysleep         0\n"), Some(0));
    }

    #[test]
    fn test_auto_lock_requires_an_idle_timer_within_limit() {
        assert_eq!(macos::auto_lock_ok(0, Some(600), None), Some(true));
        assert_eq!(macos::auto_lock_ok(0, Some(0), Some(300)), Some(true));
        assert_eq!(macos::auto_lock_ok(300, Some(900), Some(0)), Some(false)); // 20 min to lock
        assert_eq!(macos::auto_lock_ok(0, Some(0), Some(0)), Some(false)); // never idles
        assert_eq!(macos::auto_lock_ok(0, Some(0), None), None); // can't tell
    }

    #[test]
    fn test_os_update_counts_same_line_and_rsr_but_not_majors() {
        let offered = r#"[{"Display Name":"macOS 27.2","MobileSoftwareUpdate":true,"Display Version":"27.2"},
                          {"Display Name":"macOS Tahoe 26.7.2","MobileSoftwareUpdate":true,"Display Version":"26.7.2"},
                          {"Display Name":"Safari","Display Version":"27.2"}]"#;
        assert!(macos::has_same_line_os_update(offered, "26.6.2"));
        assert!(!macos::has_same_line_os_update(offered, "26.7.2"));
        let major_only = r#"[{"Display Name":"macOS 27.2","MobileSoftwareUpdate":true,"Display Version":"27.2"}]"#;
        assert!(!macos::has_same_line_os_update(major_only, "26.7.2"));
        let rsr = r#"[{"Display Name":"macOS Tahoe 26.3.1 (a)","MobileSoftwareUpdate":true,"Display Version":"26.3.1 (a)"}]"#;
        assert!(macos::has_same_line_os_update(rsr, "26.3.1"));
        assert!(!macos::has_same_line_os_update("[]", "26.6.2"));
        assert!(!macos::has_same_line_os_update("not json", "26.6.2"));
    }

    #[test]
    fn test_third_party_av_matches_daemons_not_lookalikes() {
        assert!(macos::third_party_av_running("/Library/SystemExtensions/X/com.crowdstrike.falcon.Agent.systemextension/Contents/MacOS/com.crowdstrike.falcon.Agent\n"));
        assert!(macos::third_party_av_running("/Library/Application Support/Microsoft/Defender/wdavdaemon\n"));
        assert!(!macos::third_party_av_running("/usr/libexec/xprotectd\n/Applications/Safari.app/Contents/MacOS/Safari\n"));
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
