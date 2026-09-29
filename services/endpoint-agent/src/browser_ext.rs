//! Browser VPN/proxy extension detection.
//!
//! Blocking a VPN *app* (app_control.rs) does nothing about a VPN *browser
//! extension*: the extension overrides the browser's own proxy for that
//! browser only, going around the system proxy this agent sets. The clean way
//! to stop one is the browser's `ExtensionInstallBlocklist` policy — but on an
//! unmanaged macOS device that policy is only honoured when it comes from an
//! MDM configuration profile, not from anything the agent can write itself
//! (verified live against real Chrome: a policy written to the JSON managed
//! directory never took effect). So on the devices this product actually runs
//! on, the reliable, universal thing the agent can do is *see* the extension
//! and report it — the company learns who has one, and the employee is told
//! it is against policy. Outright blocking is left to an MDM profile.
//!
//! Reported as a lifecycle, the same shape as a device's connect/disconnect:
//! one "installed" event when an extension first appears and one "removed"
//! event when it is later taken off — so the company sees, per employee, both
//! that one was added and that it was removed, and never the same installed
//! extension over and over. The set already reported is persisted to disk, so
//! a restart doesn't re-report what is still there.
//!
//! Every Chromium browser (Chrome, Edge, Brave) shares the Chrome Web Store,
//! so an extension has the same id in all three, and they lay their profiles
//! out identically: `<data root>/<profile>/Extensions/<id>/`. The installed
//! ids are the directory names there; whether each is enabled comes from the
//! profile's preferences file. The id list to match against is delivered by
//! the server (GetAppControl's vpn_extensions), so it grows without a new
//! agent build.

use crate::enforcement::EnforcementGate;
use crate::http_client::AgentClient;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

const FIRST_DELAY: Duration = Duration::from_secs(20);
const INTERVAL: Duration = Duration::from_secs(60);

#[derive(Deserialize)]
struct AppControlResp {
    #[serde(default)]
    vpn_extensions: Vec<VpnExtension>,
}

#[derive(Deserialize)]
struct VpnExtension {
    id: String,
    #[serde(default)]
    name: String,
}

#[derive(Serialize)]
struct ExtensionReport<'a> {
    extension_id: &'a str,
    name: &'a str,
    browser: &'a str,
    profile: &'a str,
    enabled: bool,
    /// "installed" the first time it is seen, "removed" once it is gone.
    status: &'a str,
}

/// One VPN extension found installed — also what we persist, so a removal can
/// still be reported with its name and location after it is gone from disk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Seen {
    browser: String,
    profile: String,
    id: String,
    name: String,
    enabled: bool,
}

fn key(browser: &str, profile: &str, id: &str) -> String {
    format!("{browser}|{profile}|{id}")
}

pub async fn loop_scan(client: AgentClient, gate: Arc<EnforcementGate>) {
    tokio::time::sleep(FIRST_DELAY).await;
    loop {
        scan_once(&client, &gate).await;
        tokio::time::sleep(INTERVAL).await;
    }
}

async fn scan_once(client: &AgentClient, gate: &EnforcementGate) {
    // Same gate as app control: don't inspect someone's browser on their own
    // machine outside working hours.
    if !gate.enforces_app_control() {
        return;
    }

    let wanted = match fetch_vpn_extension_ids(client).await {
        Some(w) if !w.is_empty() => w,
        // No list (or the fetch failed) — do nothing, and in particular do
        // NOT treat "found nothing" as "everything was removed".
        _ => return,
    };

    let found = tokio::task::spawn_blocking(scan_installed_extensions).await.unwrap_or_default();

    // The VPN extensions present right now, keyed for diffing.
    let mut current: BTreeMap<String, Seen> = BTreeMap::new();
    for ext in found {
        if let Some(name) = wanted.get(&ext.id) {
            let display = if name.is_empty() { "VPN browser extension".to_string() } else { name.clone() };
            current.insert(
                key(&ext.browser, &ext.profile, &ext.id),
                Seen { browser: ext.browser, profile: ext.profile, id: ext.id, name: display, enabled: ext.enabled },
            );
        }
    }

    let previous = load_state();

    // Newly appeared -> "installed" (+ tell the employee).
    for (k, ext) in &current {
        if !previous.contains_key(k) && report(client, ext, "installed").await {
            notify_detected(&ext.name).await;
        }
    }
    // Gone since last time -> "removed" (the employee took it off).
    for (k, ext) in &previous {
        if !current.contains_key(k) {
            report(client, ext, "removed").await;
        }
    }

    save_state(&current);
}

async fn report(client: &AgentClient, ext: &Seen, status: &str) -> bool {
    let body = ExtensionReport {
        extension_id: &ext.id,
        name: &ext.name,
        browser: &ext.browser,
        profile: &ext.profile,
        enabled: ext.enabled,
        status,
    };
    match client.post_json("/internal/agent/browser-extension", &body).await {
        Ok(r) if r.status().is_success() => {
            tracing::info!(browser = %ext.browser, id = %ext.id, name = %ext.name, %status, "VPN browser extension");
            true
        }
        Ok(r) => {
            tracing::debug!(status = %r.status(), "browser-extension report rejected");
            false
        }
        Err(e) => {
            tracing::debug!(error = %e, "browser-extension report failed");
            false
        }
    }
}

async fn notify_detected(name: &str) {
    let safe: String = name.chars().filter(|c| !matches!(c, '"' | '\\' | '\'' | '\n' | '\r')).take(80).collect();
    crate::app_control::notify(
        "Against your company's policy",
        &format!("The {safe} browser extension is not allowed on this device. Please remove it — your IT administrator has been notified."),
    )
    .await;
}

async fn fetch_vpn_extension_ids(client: &AgentClient) -> Option<HashMap<String, String>> {
    let resp = client.get("/internal/agent/app-control").await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let body: AppControlResp = resp.json().await.ok()?;
    Some(body.vpn_extensions.into_iter().map(|e| (e.id, e.name)).collect())
}

fn state_path() -> PathBuf {
    crate::config::state_dir().join("browser_extensions.json")
}

fn load_state() -> BTreeMap<String, Seen> {
    std::fs::read_to_string(state_path())
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn save_state(state: &BTreeMap<String, Seen>) {
    if let Ok(json) = serde_json::to_string(state) {
        let path = state_path();
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(path, json);
    }
}

/// One installed extension found on disk, before matching against the VPN list.
struct Installed {
    browser: String,
    profile: String,
    id: String,
    enabled: bool,
}

/// Every extension installed in every Chromium browser profile on this
/// machine. Blocking (directory walks, file reads); callers run it on a
/// blocking thread.
fn scan_installed_extensions() -> Vec<Installed> {
    let mut out = Vec::new();
    for (browser, root) in chromium_data_roots() {
        let Ok(profiles) = std::fs::read_dir(&root) else {
            continue;
        };
        for entry in profiles.flatten() {
            let profile_dir = entry.path();
            let ext_dir = profile_dir.join("Extensions");
            if !ext_dir.is_dir() {
                continue; // not a profile
            }
            let profile_name = entry.file_name().to_string_lossy().to_string();
            let enabled_state = read_extension_states(&profile_dir);
            let Ok(ids) = std::fs::read_dir(&ext_dir) else {
                continue;
            };
            for id_entry in ids.flatten() {
                if !id_entry.path().is_dir() {
                    continue;
                }
                let id = id_entry.file_name().to_string_lossy().to_string();
                if !is_extension_id(&id) {
                    continue; // skip "Temp" and similar non-id dirs
                }
                out.push(Installed {
                    browser: browser.to_string(),
                    profile: profile_name.clone(),
                    enabled: enabled_state.get(&id).copied().unwrap_or(true),
                    id,
                });
            }
        }
    }
    out
}

/// A Chrome extension id is 32 characters, each a-p. Folders like "Temp"
/// under Extensions/ are not ids.
fn is_extension_id(s: &str) -> bool {
    s.len() == 32 && s.bytes().all(|b| (b'a'..=b'p').contains(&b))
}

/// Reads a profile's extension enabled/disabled states from its preferences.
/// Chrome keeps them in "Secure Preferences", other builds in "Preferences";
/// try both. `state` is 1 for enabled, 0 for disabled. Best-effort: an
/// extension whose state can't be read is treated as enabled, since its
/// directory being present already means it is installed.
fn read_extension_states(profile_dir: &std::path::Path) -> HashMap<String, bool> {
    let mut states = HashMap::new();
    for file in ["Secure Preferences", "Preferences"] {
        let Ok(text) = std::fs::read_to_string(profile_dir.join(file)) else {
            continue;
        };
        let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else {
            continue;
        };
        if let Some(settings) = json.pointer("/extensions/settings").and_then(|v| v.as_object()) {
            for (id, cfg) in settings {
                if let Some(state) = cfg.get("state").and_then(|v| v.as_i64()) {
                    states.insert(id.to_lowercase(), state == 1);
                }
            }
        }
    }
    states
}

/// (browser name, profiles root) for every Chromium browser on this OS. The
/// root holds one directory per profile ("Default", "Profile 1", ...).
fn chromium_data_roots() -> Vec<(&'static str, PathBuf)> {
    // Test/QA override: colon-separated data-root paths, each scanned as if it
    // were Chrome's. Lets a test point the scanner at a throwaway profile tree
    // instead of the real browsers on the machine. Never set in production.
    if let Ok(custom) = std::env::var("AAVISHIELD_BROWSER_DATA_ROOTS") {
        return custom
            .split(':')
            .filter(|s| !s.is_empty())
            .map(|p| ("Chrome", PathBuf::from(p)))
            .collect();
    }

    let mut roots = Vec::new();
    let Some(base) = directories::BaseDirs::new() else {
        return roots;
    };

    #[cfg(target_os = "macos")]
    {
        let app_support = base.home_dir().join("Library/Application Support");
        roots.push(("Chrome", app_support.join("Google/Chrome")));
        roots.push(("Edge", app_support.join("Microsoft Edge")));
        roots.push(("Brave", app_support.join("BraveSoftware/Brave-Browser")));
    }
    #[cfg(target_os = "windows")]
    {
        let local = base.data_local_dir(); // %LOCALAPPDATA%
        roots.push(("Chrome", local.join("Google/Chrome/User Data")));
        roots.push(("Edge", local.join("Microsoft/Edge/User Data")));
        roots.push(("Brave", local.join("BraveSoftware/Brave-Browser/User Data")));
    }
    #[cfg(target_os = "linux")]
    {
        let config = base.config_dir(); // ~/.config
        roots.push(("Chrome", config.join("google-chrome")));
        roots.push(("Edge", config.join("microsoft-edge")));
        roots.push(("Brave", config.join("BraveSoftware/Brave-Browser")));
    }
    roots
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extension_id_shape() {
        assert!(is_extension_id("gkojfkhlekighikafcpjkiklfbnlmeio")); // Hola VPN
        assert!(!is_extension_id("Temp"));
        assert!(!is_extension_id(""));
        assert!(!is_extension_id("gkojfkhlekighikafcpjkiklfbnlmeiZ")); // Z out of a-p
        assert!(!is_extension_id("gkojfkhlekighikafcpjkiklfbnlmei")); // 31 chars
    }

    #[test]
    fn test_read_states_reads_disabled_flag() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("Secure Preferences"),
            r#"{"extensions":{"settings":{"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa":{"state":1},"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb":{"state":0}}}}"#,
        )
        .unwrap();
        let states = read_extension_states(dir.path());
        assert_eq!(states.get("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), Some(&true));
        assert_eq!(states.get("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"), Some(&false));
    }

    #[test]
    fn test_scan_finds_a_vpn_extension_in_a_profile_tree() {
        // A realistic layout: <root>/Default/Extensions/<id>/1.0/, with the
        // profile's Secure Preferences marking one enabled and one disabled.
        let root = tempfile::tempdir().unwrap();
        let hola = "gkojfkhlekighikafcpjkiklfbnlmeio"; // enabled
        let touch = "bihmplhobchoageeokmgbdihknkjbknd"; // disabled
        for id in [hola, touch] {
            std::fs::create_dir_all(root.path().join("Default").join("Extensions").join(id).join("1.0")).unwrap();
        }
        std::fs::write(
            root.path().join("Default").join("Secure Preferences"),
            format!(r#"{{"extensions":{{"settings":{{"{hola}":{{"state":1}},"{touch}":{{"state":0}}}}}}}}"#),
        )
        .unwrap();

        // SAFETY: single-threaded test; the override is read synchronously below.
        unsafe { std::env::set_var("AAVISHIELD_BROWSER_DATA_ROOTS", root.path().to_str().unwrap()) };
        let found = scan_installed_extensions();
        unsafe { std::env::remove_var("AAVISHIELD_BROWSER_DATA_ROOTS") };

        let by_id: HashMap<_, _> = found.iter().map(|e| (e.id.as_str(), e)).collect();
        assert_eq!(by_id.len(), 2, "both extensions should be found");
        assert!(by_id[hola].enabled, "Hola marked state:1 should read enabled");
        assert!(!by_id[touch].enabled, "Touch marked state:0 should read disabled");
        assert_eq!(by_id[hola].profile, "Default");
    }

    #[test]
    fn test_state_round_trips() {
        let mut m = BTreeMap::new();
        m.insert(
            key("Chrome", "Default", "gkojfkhlekighikafcpjkiklfbnlmeio"),
            Seen {
                browser: "Chrome".into(),
                profile: "Default".into(),
                id: "gkojfkhlekighikafcpjkiklfbnlmeio".into(),
                name: "Hola VPN".into(),
                enabled: true,
            },
        );
        let json = serde_json::to_string(&m).unwrap();
        let back: BTreeMap<String, Seen> = serde_json::from_str(&json).unwrap();
        assert_eq!(m, back);
    }
}
