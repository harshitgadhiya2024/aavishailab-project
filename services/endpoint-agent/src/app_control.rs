//! Application control — blocking software, not just its websites.
//!
//! Blocking a domain stops the browser, but an app that is already installed
//! keeps launching and keeps talking to whichever backend host nobody thought
//! to add to a policy. The network half of that is solved by shipping each
//! controlled app's whole domain bundle in the normal rule feed; this is the
//! other half — a process matching a controlled application is terminated on
//! sight, reported, and **the person is told why**.
//!
//! That last part matters and is new here: an app that simply vanishes is
//! indistinguishable from a crash. A desktop notification naming the app and
//! the reason is the difference between "IT blocked this, ask them" and "my
//! laptop is broken".
//!
//! Honest scope, so nobody mistakes this for more than it is: userland,
//! polled, identified by the executable's path. It stops the app being
//! usable; it does not stop the binary executing for the second or two before
//! a sweep notices, and renaming the executable defeats the name match (the
//! bundle-id and path matchers are harder to dodge, not impossible). An app
//! launched through an interpreter is invisible here, because the OS reports
//! the interpreter as the executable. Preventing execution outright needs
//! OS-level enforcement — macOS Endpoint Security, Windows WDAC/AppLocker —
//! which requires signed system extensions and MDM. Termination is what can
//! be done today on an unmanaged laptop, and the network block behind it is
//! what actually makes the app pointless.

use crate::enforcement::EnforcementGate;
use crate::http_client::AgentClient;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

/// Rules change rarely, processes constantly — sweep every tick, re-read
/// policy every fourth one.
const POLICY_EVERY_N_TICKS: u32 = 4;

/// Floor on the server-supplied sweep interval. Long enough not to matter on
/// battery, short enough that a blocked app dies seconds after launch.
const MIN_INTERVAL: Duration = Duration::from_secs(5);
const DEFAULT_INTERVAL: Duration = Duration::from_secs(15);

/// One controlled application, flattened by the server into just what this
/// watcher needs to recognise and act on a process.
#[derive(Debug, Clone, Deserialize)]
pub struct Matcher {
    #[serde(default)]
    pub app_id: String,
    #[serde(default)]
    pub name: String,
    /// `block` terminates; `alert` only reports.
    #[serde(default)]
    pub action: String,
    #[serde(default)]
    pub process_names: Vec<String>,
    #[serde(default)]
    pub bundle_ids: Vec<String>,
    #[serde(default)]
    pub path_patterns: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct AppControlResponse {
    #[serde(default)]
    applications: Vec<Matcher>,
    #[serde(default)]
    poll_interval_sec: u64,
}

#[derive(Serialize)]
struct BlockReport<'a> {
    app_id: &'a str,
    app_name: &'a str,
    process_name: &'a str,
    pid: i32,
    path: &'a str,
    action: &'a str,
    terminated: bool,
}

pub struct AppControlWatcher {
    client: AgentClient,
    gate: Arc<EnforcementGate>,
    matchers: tokio::sync::RwLock<Vec<Matcher>>,
    interval: tokio::sync::RwLock<Duration>,
    /// PIDs already reported, so one long-running app doesn't emit an event
    /// every sweep. Cleared when the process is gone, so the same app
    /// relaunching under a new PID is reported again — which is the signal
    /// we actually want.
    reported: tokio::sync::Mutex<HashMap<i32, String>>,
}

impl AppControlWatcher {
    pub fn new(client: AgentClient, gate: Arc<EnforcementGate>) -> Self {
        Self {
            client,
            gate,
            matchers: tokio::sync::RwLock::new(Vec::new()),
            interval: tokio::sync::RwLock::new(DEFAULT_INTERVAL),
            reported: tokio::sync::Mutex::new(HashMap::new()),
        }
    }

    pub async fn run(self: Arc<Self>) {
        let mut tick: u32 = 0;
        loop {
            if tick.is_multiple_of(POLICY_EVERY_N_TICKS) {
                self.refresh().await;
            }
            tick = tick.wrapping_add(1);

            let has_rules = !self.matchers.read().await.is_empty();
            if has_rules {
                self.sweep().await;
            }

            let interval = *self.interval.read().await;
            tokio::time::sleep(interval).await;
        }
    }

    async fn refresh(&self) {
        let resp = match self.client.get("/internal/agent/app-control").await {
            Ok(r) if r.status().is_success() => r,
            Ok(_) | Err(_) => return,
        };
        let body: AppControlResponse = match resp.json().await {
            Ok(b) => b,
            Err(e) => {
                tracing::debug!(error = %e, "app-control refresh returned an unparseable body");
                return;
            }
        };

        let count = body.applications.len();
        *self.interval.write().await =
            Duration::from_secs(body.poll_interval_sec).max(MIN_INTERVAL);
        *self.matchers.write().await = body.applications;
        if count > 0 {
            tracing::info!(applications = count, "application control active");
        }
    }

    async fn sweep(&self) {
        // Terminating somebody's applications on their own laptop in their own
        // time is exactly what a working-hours schedule exists to prevent.
        if !self.gate.enforces_app_control() {
            return;
        }
        let matchers = self.matchers.read().await.clone();
        if matchers.is_empty() {
            return;
        }

        let processes = tokio::task::spawn_blocking(list_processes).await.unwrap_or_default();
        let own_pid = std::process::id() as i32;
        let mut seen: Vec<i32> = Vec::new();

        for (pid, exe_path) in processes {
            if pid == own_pid {
                continue;
            }
            let Some(matcher) = matchers.iter().find(|m| matches(m, &exe_path)) else {
                continue;
            };
            seen.push(pid);

            let terminated = if matcher.action == "alert" {
                false
            } else {
                terminate(pid)
            };

            // One event per (pid, app).
            let mut reported = self.reported.lock().await;
            if reported.get(&pid).map(|id| id != &matcher.app_id).unwrap_or(true) {
                reported.insert(pid, matcher.app_id.clone());
                drop(reported);

                let exe_name = exe_path.rsplit(['/', '\\']).next().unwrap_or("").to_string();
                self.report(matcher, pid, &exe_name, &exe_path, terminated).await;

                if terminated {
                    // Told, not just stopped — see the module docs.
                    notify_blocked(&matcher.name).await;
                }
                tracing::info!(
                    app = %matcher.name, pid,
                    outcome = if terminated { "blocked" } else { "detected" },
                    "application control"
                );
            }
        }

        // Forget PIDs that are gone, so a relaunch is reported.
        self.reported.lock().await.retain(|pid, _| seen.contains(pid));
    }

    async fn report(&self, matcher: &Matcher, pid: i32, exe_name: &str, path: &str, terminated: bool) {
        let truncated: String = path.chars().take(500).collect();
        let body = BlockReport {
            app_id: &matcher.app_id,
            app_name: &matcher.name,
            process_name: exe_name,
            pid,
            path: &truncated,
            action: if terminated { "blocked" } else { "alerted" },
            terminated,
        };
        if let Err(e) = self.client.post_json("/internal/agent/app-block", &body).await {
            tracing::debug!(error = %e, "app-block report failed");
        }
    }
}

/// Does this executable belong to a controlled application?
///
/// Only the executable's own path is matched, never the command line. A
/// process whose arguments merely mention an app (a grep, an editor, a build
/// script) is not that app, and terminating it because of a string in argv
/// would be indefensible.
fn matches(matcher: &Matcher, exe_path: &str) -> bool {
    let path_lower = exe_path.to_lowercase();
    let exe_name = path_lower.rsplit(['/', '\\']).next().unwrap_or("");

    if matcher.process_names.iter().any(|n| n.trim().to_lowercase() == exe_name) {
        return true;
    }
    if matcher
        .path_patterns
        .iter()
        .any(|p| !p.trim().is_empty() && path_lower.contains(&p.trim().to_lowercase()))
    {
        return true;
    }
    if !matcher.bundle_ids.is_empty() {
        if let Some(id) = bundle_identifier(exe_path) {
            let id = id.to_lowercase();
            if matcher.bundle_ids.iter().any(|b| b.trim().to_lowercase() == id) {
                return true;
            }
        }
    }
    false
}

/// CFBundleIdentifier of the `.app` a macOS executable lives in.
///
/// Returns None off macOS, and for any path not inside a bundle. Deliberately
/// not cached here (the Python original cached per bundle): a sweep runs every
/// 15 seconds at most and only reaches this for a process that already failed
/// the cheaper name and path checks, so the read is rare.
#[cfg(target_os = "macos")]
fn bundle_identifier(exe_path: &str) -> Option<String> {
    let idx = exe_path.find(".app/")?;
    let bundle = &exe_path[..idx + 4];
    let info = format!("{bundle}/Contents/Info.plist");
    let out = std::process::Command::new("/usr/libexec/PlistBuddy")
        .args(["-c", "Print :CFBundleIdentifier", &info])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let id = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if id.is_empty() { None } else { Some(id) }
}

#[cfg(not(target_os = "macos"))]
fn bundle_identifier(_exe_path: &str) -> Option<String> {
    None
}

/// (pid, executable path) for every process this user can see.
fn list_processes() -> Vec<(i32, String)> {
    #[cfg(target_os = "windows")]
    {
        let out = std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId)|$($_.ExecutablePath)\" }",
            ])
            .output();
        let Ok(out) = out else { return Vec::new() };
        if !out.status.success() {
            return Vec::new();
        }
        return String::from_utf8_lossy(&out.stdout)
            .lines()
            .filter_map(|line| {
                let (pid, path) = line.trim().split_once('|')?;
                let pid: i32 = pid.parse().ok()?;
                if path.is_empty() { None } else { Some((pid, path.to_string())) }
            })
            .collect();
    }

    #[cfg(not(target_os = "windows"))]
    {
        // "pid=,comm=" and not "pid=,comm=,args=": an executable path can
        // contain spaces ("/Applications/Google Chrome.app/…/Google Chrome"),
        // so a multi-field line has no unambiguous split point. With one
        // field, everything after the pid is that field.
        let out = std::process::Command::new("ps").args(["-axo", "pid=,comm="]).output();
        let Ok(out) = out else { return Vec::new() };
        if !out.status.success() {
            return Vec::new();
        }
        String::from_utf8_lossy(&out.stdout)
            .lines()
            .filter_map(|line| {
                let line = line.trim();
                let (pid, path) = line.split_once(' ')?;
                let pid: i32 = pid.parse().ok()?;
                let path = path.trim();
                if path.is_empty() { None } else { Some((pid, path.to_string())) }
            })
            .collect()
    }
}

/// Kills a process. Returns whether it actually died.
///
/// A process owned by another user (or root) can't be killed from here. That
/// is still reported — the dashboard shows it was seen and that it survived,
/// which is more useful than silence.
fn terminate(pid: i32) -> bool {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    #[cfg(not(target_os = "windows"))]
    {
        // SAFETY: kill(2) with a validated positive pid. A pid that has
        // already exited returns ESRCH, which is reported as "not
        // terminated" rather than being treated as an error.
        unsafe { libc::kill(pid, libc::SIGKILL) == 0 }
    }
}

/// Tells the person why an application just closed.
///
/// Best-effort and fire-and-forget: a laptop with no notification daemon, or
/// a locked screen, must never hold up or fail a sweep. Every platform path
/// below uses a tool the OS already ships, for the same reason the rest of
/// this crate does.
async fn notify_blocked(app_name: &str) {
    // Nothing the company controls reaches this string, but it is
    // interpolated into an AppleScript/PowerShell literal, so quotes and
    // backslashes are stripped rather than escaped per-language.
    let safe: String = app_name.chars().filter(|c| !matches!(c, '"' | '\\' | '\'' | '\n' | '\r')).take(80).collect();
    let title = "Blocked by your company";
    let body = format!("{safe} is not allowed on this device. Contact your IT administrator if you need access.");

    let _ = tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "macos")]
        {
            let script = format!("display notification \"{body}\" with title \"{title}\"");
            let _ = std::process::Command::new("osascript").args(["-e", &script]).output();
        }
        #[cfg(target_os = "linux")]
        {
            let _ = std::process::Command::new("notify-send").args([title, &body]).output();
        }
        #[cfg(target_os = "windows")]
        {
            let script = format!(
                "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] > $null; \
                 $t=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent(2); \
                 $x=$t.GetElementsByTagName('text'); $x[0].AppendChild($t.CreateTextNode('{title}')) > $null; \
                 $x[1].AppendChild($t.CreateTextNode('{body}')) > $null; \
                 [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Aavishield').Show([Windows.UI.Notifications.ToastNotification]::new($t))"
            );
            let _ = std::process::Command::new("powershell")
                .args(["-NoProfile", "-NonInteractive", "-Command", &script])
                .output();
        }
    })
    .await;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn matcher(process_names: &[&str], path_patterns: &[&str], bundle_ids: &[&str]) -> Matcher {
        Matcher {
            app_id: "app-1".into(),
            name: "Test App".into(),
            action: "block".into(),
            process_names: process_names.iter().map(|s| s.to_string()).collect(),
            path_patterns: path_patterns.iter().map(|s| s.to_string()).collect(),
            bundle_ids: bundle_ids.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn test_matches_on_executable_name_case_insensitively() {
        let m = matcher(&["ChatGPT.exe"], &[], &[]);
        assert!(matches(&m, "C:\\Program Files\\OpenAI\\chatgpt.exe"));
    }

    /// The name match is on the *file name*, not a substring of the path —
    /// otherwise a directory that happens to contain the word would match
    /// every binary underneath it.
    #[test]
    fn test_name_match_does_not_fire_on_a_parent_directory() {
        let m = matcher(&["code"], &[], &[]);
        assert!(!matches(&m, "/opt/code/bin/helper"));
        assert!(matches(&m, "/usr/share/code/code"));
    }

    #[test]
    fn test_path_pattern_is_a_substring_match() {
        let m = matcher(&[], &["/applications/slack.app/"], &[]);
        assert!(matches(&m, "/Applications/Slack.app/Contents/MacOS/Slack"));
        assert!(!matches(&m, "/Applications/Notes.app/Contents/MacOS/Notes"));
    }

    /// An empty pattern would `contains("")` — true for every path — and
    /// silently terminate everything running on the machine.
    #[test]
    fn test_empty_path_pattern_never_matches() {
        let m = matcher(&[], &["", "   "], &[]);
        assert!(!matches(&m, "/usr/bin/anything"));
    }

    #[test]
    fn test_matcher_with_nothing_to_match_on_matches_nothing() {
        let m = matcher(&[], &[], &[]);
        assert!(!matches(&m, "/usr/bin/anything"));
    }
}
