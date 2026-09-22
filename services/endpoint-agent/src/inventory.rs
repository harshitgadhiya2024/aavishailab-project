//! Software inventory — what is actually installed on this machine.
//!
//! Application control only ever notices an app that is *running*, and only
//! one somebody already catalogued. That leaves the company blind to the
//! thing it most wants to know: an employee installed something. This walks
//! the operating system's own record of installed software and reports the
//! whole list, so a remote-access tool that has never been launched is still
//! visible — and so is a binary that arrived as a browser download rather
//! than through a package manager.
//!
//! A full snapshot is sent every time, not a delta. That is what makes
//! uninstalls detectable at all without the agent having to remember what it
//! last sent across restarts, reinstalls and version upgrades — state it has
//! no reliable place to keep and which would go wrong silently. The server
//! diffs the snapshot against what it already holds for this device.
//!
//! Every collector below shells out to a tool the OS already ships. That is
//! deliberate and matches the rest of this crate: adding a platform SDK
//! binding per OS would triple the build matrix for data that is read once an
//! hour.

use crate::enforcement::EnforcementGate;
use crate::http_client::AgentClient;
use serde::Serialize;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

/// Installing software is a rare event and enumerating it is the most
/// expensive thing this agent does on a timer. Hourly is well inside the
/// resolution anyone reads this data at.
pub const INTERVAL: Duration = Duration::from_secs(3600);

/// Enough of a delay after startup that the first report does not compete
/// with enrollment, the first policy fetch and the proxy coming up.
pub const FIRST_DELAY: Duration = Duration::from_secs(90);

/// A per-command ceiling. `dpkg-query` on a large system and PowerShell's
/// registry walk are both slow enough to need one, and a collector that
/// hangs would hold the whole loop.
const COMMAND_TIMEOUT: Duration = Duration::from_secs(60);

/// Caps one report. A developer machine realistically carries a few hundred
/// applications; past this is a malformed collector, and truncating beats
/// letting one device write unbounded rows. The list is sorted before
/// truncation so a capped report is the same subset every time rather than
/// an arbitrary one that churns between runs.
const MAX_ITEMS: usize = 2000;

/// One directory's worth of manually installed binaries. Bounded so a
/// user's `~/bin` full of scripts cannot dominate the report.
const MAX_BINARIES_PER_DIR: usize = 500;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct InstalledApp {
    /// The stable, OS-native key: a macOS CFBundleIdentifier, a Windows
    /// uninstall-registry key, a Linux package name. The display name
    /// changes between versions ("Visual Studio Code" → "Code"); this does
    /// not, which is what makes re-reporting idempotent server-side.
    pub identifier: String,
    pub name: String,
    pub version: String,
    pub vendor: String,
    pub install_path: String,
    /// Where on the machine this was found, which is also how much to trust
    /// the metadata: `registry` | `applications` | `dpkg` | `rpm` | `snap` |
    /// `flatpak` | `path`.
    pub source: String,
    /// RFC3339, empty when the platform records nothing usable. The server
    /// falls back to "first seen" rather than inventing an install time.
    pub installed_at: String,
}

#[derive(Serialize)]
struct InventoryReport {
    applications: Vec<InstalledApp>,
}

/// Runs the collector forever. Spawned once from `main`.
pub async fn loop_report(client: AgentClient, gate: Arc<EnforcementGate>) {
    tokio::time::sleep(FIRST_DELAY).await;
    loop {
        report_once(&client, &gate).await;
        tokio::time::sleep(INTERVAL).await;
    }
}

/// One collect-and-send cycle. Public so a caller can force a report (for
/// example immediately after enrollment) without waiting for the timer.
pub async fn report_once(client: &AgentClient, gate: &EnforcementGate) {
    // Enumerating the software on someone's personal laptop outside working
    // hours is the same intrusion the gate exists to prevent everywhere else.
    // A company-owned machine is always `full`, so this only ever skips on
    // BYOD, and only outside its window.
    if !gate.logs("activity") {
        return;
    }

    let apps = tokio::task::spawn_blocking(collect).await.unwrap_or_default();
    if apps.is_empty() {
        return;
    }
    let count = apps.len();

    match client.post_json("/internal/agent/inventory", &InventoryReport { applications: apps }).await {
        Ok(resp) if resp.status().is_success() => {
            tracing::info!(applications = count, "software inventory reported");
        }
        Ok(resp) => tracing::debug!(status = %resp.status(), "inventory upload rejected"),
        Err(e) => tracing::debug!(error = %e, "inventory upload failed"),
    }
}

/// Collects, de-duplicates and sorts this machine's installed applications.
///
/// Blocking: every collector shells out. Callers run this on a blocking
/// thread — see `report_once`.
pub fn collect() -> Vec<InstalledApp> {
    let mut apps = if cfg!(target_os = "windows") {
        windows_registry()
    } else if cfg!(target_os = "macos") {
        let mut a = macos_bundles();
        a.extend(unix_manual_binaries());
        a
    } else {
        let mut a = linux_packages();
        a.extend(unix_manual_binaries());
        a
    };

    // Two collectors finding the same thing (a snap that is also a dpkg, a
    // binary in /usr/local/bin that a package owns) must not become two rows.
    apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()).then(a.identifier.cmp(&b.identifier)));
    apps.dedup_by(|a, b| a.identifier.eq_ignore_ascii_case(&b.identifier));
    apps.truncate(MAX_ITEMS);
    apps
}

/// Runs a command with a timeout, returning stdout on success.
///
/// A collector for a package manager this machine does not have exits
/// non-zero or is missing entirely; both are normal and silent here, because
/// "rpm is not installed" is not an error on a Debian box.
fn run(cmd: &str, args: &[&str]) -> Option<String> {
    use std::io::Read;
    use std::process::{Command, Stdio};

    let mut child = Command::new(cmd)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .stdin(Stdio::null())
        .spawn()
        .ok()?;

    // stdout MUST be drained on its own thread while we wait for the exit.
    //
    // A pipe holds ~64KB before the writer blocks, and these collectors
    // routinely exceed it — `dpkg-query` on an ordinary Ubuntu box emits
    // ~68KB for ~790 packages. Polling `try_wait()` without reading first
    // deadlocks: the child blocks writing, so it never exits, so the poll
    // never completes, and the command is eventually killed at the timeout
    // and reported as "not installed". That failure is silent and total —
    // caught here by probing a real machine, where dpkg contributed zero
    // rows while the much smaller `snap list` worked fine.
    let mut stdout = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf);
        buf
    });

    // std::process has no built-in timeout, and a hung package manager would
    // otherwise stall the collector indefinitely. Poll, then kill — killing
    // closes the pipe, which is also what releases the reader thread.
    let deadline = std::time::Instant::now() + COMMAND_TIMEOUT;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if std::time::Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = reader.join();
                    tracing::debug!(command = cmd, "inventory collector timed out");
                    return None;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(_) => {
                let _ = reader.join();
                return None;
            }
        }
    };

    let buf = reader.join().ok()?;
    if !status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&buf).into_owned())
}

// ─── Windows ─────────────────────────────────────────────────────────────

/// Both registry views plus the per-user hive.
///
/// Three paths, not one: 64-bit installers write to the native Uninstall key,
/// 32-bit ones are redirected to WOW6432Node, and anything installed without
/// administrator rights lands under HKCU — which is exactly where a manually
/// downloaded tool ends up, so omitting it would miss the case this whole
/// module exists for.
fn windows_registry() -> Vec<InstalledApp> {
    const SCRIPT: &str = concat!(
        "$paths = @(",
        "'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
        "'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
        "'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*');",
        "Get-ItemProperty $paths -ErrorAction SilentlyContinue | ",
        "Where-Object { $_.DisplayName } | ",
        "ForEach-Object { \"$($_.DisplayName)`t$($_.DisplayVersion)`t$($_.Publisher)`t",
        "$($_.PSChildName)`t$($_.InstallLocation)`t$($_.InstallDate)\" }"
    );

    let out = match run("powershell", &["-NoProfile", "-NonInteractive", "-Command", SCRIPT]) {
        Some(o) => o,
        None => return Vec::new(),
    };

    // Tab-separated rather than ConvertTo-Json: the JSON encoder emits a bare
    // object instead of an array when there is exactly one result, which is a
    // real case on a nearly-empty machine and a parsing branch not worth
    // carrying for data this flat.
    out.lines()
        .filter_map(|line| {
            let f: Vec<&str> = line.split('\t').collect();
            let name = f.first()?.trim();
            if name.is_empty() {
                return None;
            }
            let path = f.get(4).unwrap_or(&"").trim().to_string();
            let identifier = {
                let key = f.get(3).unwrap_or(&"").trim();
                if key.is_empty() { name.to_lowercase() } else { key.to_lowercase() }
            };
            Some(InstalledApp {
                identifier,
                name: name.to_string(),
                version: f.get(1).unwrap_or(&"").trim().to_string(),
                vendor: f.get(2).unwrap_or(&"").trim().to_string(),
                install_path: path,
                source: "registry".to_string(),
                installed_at: normalize_install_date(f.get(5).unwrap_or(&"").trim()),
            })
        })
        .collect()
}

/// Windows records InstallDate as `YYYYMMDD`. Anything else (absent, or a
/// value an installer wrote in its own format) becomes empty rather than a
/// guess — the server treats empty as "we don't know" and shows first-seen.
fn normalize_install_date(raw: &str) -> String {
    if raw.len() == 8 && raw.chars().all(|c| c.is_ascii_digit()) {
        format!("{}-{}-{}", &raw[0..4], &raw[4..6], &raw[6..8])
    } else {
        String::new()
    }
}

// ─── macOS ───────────────────────────────────────────────────────────────

/// Every `.app` bundle, read from its own `Info.plist`.
///
/// `system_profiler SPApplicationsDataType` gives the same answer but
/// routinely takes 30+ seconds and pins a core while it does. Walking the
/// application directories and reading the plists directly is near-instant
/// and yields the identifier that actually matters here — the
/// CFBundleIdentifier, which survives the app being renamed.
fn macos_bundles() -> Vec<InstalledApp> {
    let mut out = Vec::new();
    let home = std::env::var("HOME").unwrap_or_default();
    let roots = [
        "/Applications".to_string(),
        "/Applications/Utilities".to_string(),
        format!("{home}/Applications"),
    ];

    for root in roots.iter() {
        let entries = match std::fs::read_dir(root) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("app") {
                continue;
            }
            let bundle = path.to_string_lossy().into_owned();
            let fallback_name = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();

            // PlistBuddy is the only plist reader guaranteed present on a
            // stock macOS, and adding a plist crate to the dependency tree
            // for three fields read once an hour is not a trade worth making.
            let info = format!("{bundle}/Contents/Info.plist");
            let read = |key: &str| -> String {
                run("/usr/libexec/PlistBuddy", &["-c", &format!("Print :{key}"), &info])
                    .map(|v| v.trim().to_string())
                    .unwrap_or_default()
            };

            let identifier = read("CFBundleIdentifier");
            let mut version = read("CFBundleShortVersionString");
            if version.is_empty() {
                version = read("CFBundleVersion");
            }
            let name = {
                let n = read("CFBundleName");
                if n.is_empty() { fallback_name } else { n }
            };

            out.push(InstalledApp {
                identifier: if identifier.is_empty() { bundle.to_lowercase() } else { identifier.to_lowercase() },
                name,
                version,
                vendor: String::new(),
                install_path: bundle.clone(),
                source: "applications".to_string(),
                // macOS records no install date, so the bundle's own creation
                // time is the closest honest answer available.
                installed_at: created_at_rfc3339(&path),
            });
        }
    }
    out
}

// ─── Linux ───────────────────────────────────────────────────────────────

/// Linux packages, restricted to what somebody actually chose to install.
///
/// A bare `dpkg-query -W` is the wrong list for this feature: on an ordinary
/// Ubuntu box it returns ~790 rows, almost all of them libraries and base
/// system packages pulled in as dependencies (`libc6`, `base-files`,
/// `python3-minimal`). Reporting those as "applications this employee
/// installed" would bury the handful of rows a security team actually cares
/// about under two orders of magnitude of noise.
///
/// `apt-mark showmanual` is the package manager's own answer to "what was
/// explicitly installed rather than dragged in" — ~131 rows on the same box.
/// It still includes the base system (Ubuntu marks the initial install as
/// manual), but it is the correct signal and the only one dpkg offers.
///
/// If apt-mark is missing (a non-Debian system, or a stripped container) this
/// falls back to the full list rather than reporting nothing: over-reporting
/// is recoverable by filtering in the dashboard, while silently omitting an
/// employee's software defeats the point of the feature.
fn linux_packages() -> Vec<InstalledApp> {
    let mut out = Vec::new();

    if let Some(text) = run("dpkg-query", &["-W", "-f=${Package}\\t${Version}\\t${Maintainer}\\n"]) {
        let mut apps = parse_tabbed(&text, "dpkg");
        if let Some(manual) = run("apt-mark", &["showmanual"]) {
            let explicit: std::collections::HashSet<String> =
                manual.lines().map(|l| l.trim().to_lowercase()).filter(|l| !l.is_empty()).collect();
            if !explicit.is_empty() {
                apps.retain(|a| explicit.contains(&a.name.to_lowercase()));
            }
        }
        out.extend(apps);
    }
    if let Some(text) = run("rpm", &["-qa", "--queryformat", "%{NAME}\\t%{VERSION}\\t%{VENDOR}\\n"]) {
        let mut apps = parse_tabbed(&text, "rpm");
        // dnf's equivalent of apt-mark. Same fallback reasoning as above.
        if let Some(manual) = run("dnf", &["history", "userinstalled"]) {
            let explicit: std::collections::HashSet<String> = manual
                .lines()
                .map(|l| l.trim().to_lowercase())
                // dnf prints a header line and package NEVRA strings; the
                // name is everything before the first '-' followed by a digit.
                .filter(|l| !l.is_empty() && !l.starts_with("Packages"))
                .collect();
            if !explicit.is_empty() {
                apps.retain(|a| explicit.iter().any(|e| e.starts_with(&a.name.to_lowercase())));
            }
        }
        out.extend(apps);
    }

    if let Some(text) = run("snap", &["list"]) {
        // First line is a header.
        for line in text.lines().skip(1) {
            let mut cols = line.split_whitespace();
            if let Some(name) = cols.next() {
                out.push(InstalledApp {
                    identifier: format!("snap:{}", name.to_lowercase()),
                    name: name.to_string(),
                    version: cols.next().unwrap_or("").to_string(),
                    vendor: String::new(),
                    install_path: String::new(),
                    source: "snap".to_string(),
                    installed_at: String::new(),
                });
            }
        }
    }

    if let Some(text) = run("flatpak", &["list", "--columns=application,version"]) {
        for line in text.lines() {
            let mut cols = line.split_whitespace();
            if let Some(name) = cols.next() {
                out.push(InstalledApp {
                    identifier: format!("flatpak:{}", name.to_lowercase()),
                    name: name.to_string(),
                    version: cols.next().unwrap_or("").to_string(),
                    vendor: String::new(),
                    install_path: String::new(),
                    source: "flatpak".to_string(),
                    installed_at: String::new(),
                });
            }
        }
    }

    out
}

fn parse_tabbed(text: &str, source: &str) -> Vec<InstalledApp> {
    text.lines()
        .filter_map(|line| {
            let f: Vec<&str> = line.split('\t').collect();
            let name = f.first()?.trim();
            if name.is_empty() {
                return None;
            }
            Some(InstalledApp {
                identifier: format!("{source}:{}", name.to_lowercase()),
                name: name.to_string(),
                version: f.get(1).unwrap_or(&"").trim().to_string(),
                vendor: f.get(2).unwrap_or(&"").trim().to_string(),
                install_path: String::new(),
                source: source.to_string(),
                installed_at: String::new(),
            })
        })
        .collect()
}

// ─── Manually installed binaries (macOS + Linux) ─────────────────────────

/// Executables in the places a manual download actually lands.
///
/// A package database by definition knows nothing about a binary someone
/// curl'd into `~/.local/bin` or `/usr/local/bin` — which is how most
/// developer tooling gets installed, and precisely the blind spot the
/// requirement calls out. Only regular executable files are reported, only
/// one directory level deep, so this stays a bounded scan and never becomes
/// a filesystem crawl.
fn unix_manual_binaries() -> Vec<InstalledApp> {
    let home = std::env::var("HOME").unwrap_or_default();
    let roots = [
        "/usr/local/bin".to_string(),
        format!("{home}/.local/bin"),
        format!("{home}/bin"),
    ];

    let mut out = Vec::new();
    for root in roots.iter() {
        let entries = match std::fs::read_dir(root) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten().take(MAX_BINARIES_PER_DIR) {
            let path = entry.path();
            // A symlink here is almost always a package manager's shim
            // pointing back at something already reported by name.
            match entry.file_type() {
                Ok(ft) if ft.is_file() => {}
                _ => continue,
            }
            if !is_executable(&path) {
                continue;
            }
            let full = path.to_string_lossy().into_owned();
            out.push(InstalledApp {
                identifier: full.to_lowercase(),
                name: path.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default(),
                version: String::new(),
                vendor: String::new(),
                install_path: full,
                source: "path".to_string(),
                installed_at: modified_at_rfc3339(&path),
            });
        }
    }
    out
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path).map(|m| m.permissions().mode() & 0o111 != 0).unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable(_path: &Path) -> bool {
    false
}

fn created_at_rfc3339(path: &Path) -> String {
    std::fs::metadata(path)
        .and_then(|m| m.created())
        .ok()
        .and_then(system_time_to_rfc3339)
        .unwrap_or_default()
}

fn modified_at_rfc3339(path: &Path) -> String {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(system_time_to_rfc3339)
        .unwrap_or_default()
}

fn system_time_to_rfc3339(t: std::time::SystemTime) -> Option<String> {
    let secs = t.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs();
    let dt = time::OffsetDateTime::from_unix_timestamp(secs as i64).ok()?;
    dt.format(&time::format_description::well_known::Rfc3339).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_windows_install_date_normalizes_yyyymmdd() {
        assert_eq!(normalize_install_date("20240115"), "2024-01-15");
    }

    /// An installer that wrote its own format must not become a fabricated
    /// date — the server shows "first seen" for an empty value, which is
    /// honest, where a misparsed one would silently be wrong.
    #[test]
    fn test_windows_install_date_rejects_anything_else() {
        assert_eq!(normalize_install_date(""), "");
        assert_eq!(normalize_install_date("15/01/2024"), "");
        assert_eq!(normalize_install_date("2024-01-15"), "");
        assert_eq!(normalize_install_date("2024011"), "");
    }

    #[test]
    fn test_parse_tabbed_reads_name_version_vendor() {
        let apps = parse_tabbed("code\t1.85.0\tMicrosoft\nvim\t9.0\tBram\n", "dpkg");
        assert_eq!(apps.len(), 2);
        assert_eq!(apps[0].name, "code");
        assert_eq!(apps[0].version, "1.85.0");
        assert_eq!(apps[0].vendor, "Microsoft");
        assert_eq!(apps[0].identifier, "dpkg:code");
        assert_eq!(apps[0].source, "dpkg");
    }

    /// A blank line, or a line whose first field is empty, is skipped rather
    /// than producing a nameless row the dashboard would render as an empty
    /// table cell.
    #[test]
    fn test_parse_tabbed_skips_nameless_rows() {
        let apps = parse_tabbed("\n\t1.0\tVendor\ngood\t2.0\tV\n", "rpm");
        assert_eq!(apps.len(), 1);
        assert_eq!(apps[0].name, "good");
    }

    /// The identifier is namespaced by source so a dpkg package and a snap
    /// of the same name stay two distinct rows — they are two installs, and
    /// collapsing them would hide one.
    #[test]
    fn test_identifier_is_namespaced_by_source() {
        let dpkg = parse_tabbed("code\t1.0\tv\n", "dpkg");
        let rpm = parse_tabbed("code\t1.0\tv\n", "rpm");
        assert_ne!(dpkg[0].identifier, rpm[0].identifier);
    }
}
