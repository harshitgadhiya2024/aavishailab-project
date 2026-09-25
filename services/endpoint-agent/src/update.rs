//! Auto-update — a port of Python's `AutoUpdater`.
//!
//! Polls the admin API for a newer packaged agent, verifies its SHA-256,
//! and swaps the running binary in place.
//!
//! Only runs in release builds. Python's original gate is
//! `sys.frozen` — true only inside a PyInstaller bundle, false for a
//! developer's own `python aavishield-agent.py` — so a source checkout is
//! never at risk of auto-updating itself. Rust has no equivalent notion of
//! "frozen"; a `cargo build --release` binary *is* the shipped artifact,
//! the same way a PyInstaller bundle is. `cfg!(debug_assertions)` is the
//! matching line here: false for `--release`, true for a plain `cargo
//! build`/`cargo run`, which is exactly the checkout-vs-package distinction
//! this guard exists to draw.

use crate::http_client::AgentClient;
use serde::Deserialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;

pub const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 3600);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(120);

/// Auto-update is off until the app ships with a Developer ID certificate.
///
/// The reason is TCC, not the update mechanism itself. Without Developer
/// ID the app is ad-hoc signed, so its signing identity is the cdhash and
/// every build has a different one. macOS keys Screen Recording and Input
/// Monitoring grants to that identity, so swapping the binary in place —
/// which is exactly what this module does — makes the running agent a
/// different app to macOS: both permissions silently revert to "not
/// granted", screenshots become blank and keyboard activity stops
/// counting, with nothing on screen to say why. An update meant to be
/// invisible would instead quietly disable the two features it most needs,
/// across the whole fleet at once.
///
/// Until then, updates go through uninstall + reinstall, which prompts for
/// the permissions again in the open (and clears the old grants first —
/// see uninstall.rs). When a Developer ID certificate is configured in
/// build-rust.sh, the signing identity becomes stable across builds, TCC
/// grants survive an update, and this flips back to `true`.
const AUTO_UPDATE_ENABLED: bool = false;

#[derive(Deserialize)]
struct Manifest {
    version: String,
    #[serde(default)]
    artifacts: HashMap<String, Artifact>,
}

#[derive(Deserialize)]
struct Artifact {
    url: String,
    sha256: String,
}

pub async fn loop_check(client: AgentClient) {
    let mut ticker = tokio::time::interval(CHECK_INTERVAL);
    ticker.tick().await; // the first tick fires immediately; skip straight to waiting one interval
    loop {
        ticker.tick().await;
        if let Err(e) = check_once(&client).await {
            tracing::debug!(error = %e, "update check failed");
        }
    }
}

/// Returns `Ok(true)` if an update was staged (the process is about to
/// exit), `Ok(false)` if nothing needed to happen, `Err` on any failure —
/// every error path here is deliberately non-fatal to the caller, matching
/// `check_once`'s Python counterpart which only ever logs and returns.
pub async fn check_once(client: &AgentClient) -> Result<bool, String> {
    if !AUTO_UPDATE_ENABLED {
        return Ok(false);
    }
    if cfg!(debug_assertions) {
        return Ok(false);
    }

    let resp = client.get("/internal/agent/version").await.map_err(|e| e.to_string())?;
    if resp.status() == reqwest::StatusCode::NO_CONTENT {
        return Ok(false); // no packages published yet
    }
    let manifest: Manifest = resp.json().await.map_err(|e| e.to_string())?;

    if manifest.version.is_empty() || !version_gt(&manifest.version, crate::config::AGENT_VERSION) {
        return Ok(false);
    }

    let platform_key = platform_key();
    let Some(artifact) = manifest.artifacts.get(platform_key) else {
        tracing::info!(latest = %manifest.version, platform = platform_key, "update available but no artifact for this platform");
        return Ok(false);
    };

    tracing::info!(from = crate::config::AGENT_VERSION, to = %manifest.version, "updating agent");
    download_and_swap(&artifact.url, &artifact.sha256).await?;
    Ok(true)
}

async fn download_and_swap(url: &str, expected_sha: &str) -> Result<(), String> {
    use sha2::{Digest, Sha256};
    use tokio::io::AsyncWriteExt;

    let target = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = target.parent().map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."));

    // The artifact URL is a public download route on admin-api
    // (/agent/packages/:file, no auth middleware — see router.go), not one
    // of the authenticated /internal/agent/* endpoints, so this is a plain
    // request rather than going through `AgentClient`.
    let http = reqwest::Client::builder().no_proxy().timeout(DOWNLOAD_TIMEOUT).build().map_err(|e| e.to_string())?;
    let resp = http.get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("download returned HTTP {}", resp.status()));
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;

    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let actual = hex::encode(hasher.finalize());
    if !actual.eq_ignore_ascii_case(expected_sha) {
        // A mismatch means the download was corrupted or tampered with.
        // Never execute it.
        return Err(format!("sha256 {actual} != expected {expected_sha}"));
    }

    // A temp file in the *same directory* as the target, not the system
    // temp dir: the final rename below must be same-filesystem to be
    // atomic, and to work at all when /tmp is a different mount (common in
    // containers and some Linux installs) than where the binary lives.
    let tmp = dir.join(format!(".aavishield-update-{}", std::process::id()));
    {
        let mut f = tokio::fs::File::create(&tmp).await.map_err(|e| e.to_string())?;
        f.write_all(&bytes).await.map_err(|e| e.to_string())?;
        f.flush().await.map_err(|e| e.to_string())?;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o755);
        std::fs::set_permissions(&tmp, perms).map_err(|e| e.to_string())?;
    }

    // Replacing the running executable's own file works on POSIX because a
    // process keeps its already-loaded image mapped even after the path is
    // unlinked/replaced — the same reason Python's `os.replace(tmp, target)`
    // works from inside a running PyInstaller binary. Windows locks a
    // running executable's file for writing, and whether a rename over it
    // succeeds depends on how the OS opened it — this is written from the
    // Python original's approach but, like the rest of this crate's
    // Windows-specific paths, NOT verified on real Windows hardware.
    tokio::fs::rename(&tmp, &target).await.map_err(|e| e.to_string())?;

    tracing::info!("update staged — restarting to apply");
    // launchd / systemd / Task Scheduler restart us with KeepAlive/auto-
    // restart, the same assumption the Python original documents.
    std::process::exit(0);
}

fn platform_key() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    }
}

/// Same loose comparison as Python's `_version_gt`: split on '.', take the
/// leading digits of each chunk (so "1.0.0-rust" reads as [1, 0, 0], the
/// trailing "-rust" contributing nothing), pad the shorter to the longer's
/// length with zeros, compare lexicographically.
fn version_gt(a: &str, b: &str) -> bool {
    fn parts(v: &str) -> Vec<u64> {
        v.split('.').map(|chunk| chunk.chars().take_while(|c| c.is_ascii_digit()).collect::<String>().parse().unwrap_or(0)).collect()
    }
    let (mut pa, mut pb) = (parts(a), parts(b));
    let len = pa.len().max(pb.len());
    pa.resize(len, 0);
    pb.resize(len, 0);
    pa > pb
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_version_gt_basic_semver() {
        assert!(version_gt("2.5.0", "2.4.0"));
        assert!(!version_gt("2.4.0", "2.5.0"));
        assert!(!version_gt("2.5.0", "2.5.0"));
    }

    #[test]
    fn test_version_gt_handles_different_lengths() {
        assert!(version_gt("2.5.1", "2.5"));
        assert!(!version_gt("2.5", "2.5.1"));
    }

    #[test]
    fn test_version_gt_ignores_non_numeric_suffix() {
        // "1.0.0-rust" must compare as [1, 0, 0], not fail to parse.
        assert!(version_gt("1.1.0-rust", "1.0.0-rust"));
        assert!(!version_gt("1.0.0-rust", "1.0.0-rust"));
    }

    #[test]
    fn test_version_gt_handles_empty_chunks() {
        assert!(!version_gt("", ""));
        assert!(version_gt("1.0", ""));
    }
}
