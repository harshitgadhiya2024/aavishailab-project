//! Auto-update — a port of Python's `AutoUpdater`, rebuilt for the .pkg
//! the macOS release actually ships.
//!
//! Polls the admin API for a newer packaged agent, verifies its SHA-256,
//! and installs it in place, then exits so launchd's KeepAlive starts the
//! new build.
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
//!
//! macOS only, for now. What the server publishes per platform is an
//! installer — .pkg, .msi, .deb — never a bare binary, so the original
//! "write the download over current_exe" approach would have replaced the
//! agent with an installer file and left it unable to start. Windows and
//! Linux need their own installer step (msiexec / dpkg, both as root) and
//! stay on manual upgrades until that exists.
//!
//! Why macOS can do this without root: the package's postinstall chowns
//! /Applications/Aavishield.app to the console user, so the agent — which
//! runs as that user — can replace the bundle's `Contents` itself, even on
//! a standard (non-admin) account. Nothing outside the bundle changes; the
//! LaunchAgent plist stays as installed, so a release that needs a new
//! plist still has to ship as a manual install.
//!
//! Why this is safe for TCC: Screen Recording and Input Monitoring are
//! granted against the app's designated requirement. Release builds are
//! Developer ID signed, so that requirement is "this bundle id, signed by
//! this team" — stable across versions. The new bundle is checked against
//! the *running* app's own requirement before anything is swapped, so an
//! update can never land a build those grants would not carry over to. A
//! running build without a team identity (ad-hoc, local) never updates
//! itself: for it, every new build would silently lose both permissions.

use crate::http_client::AgentClient;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

/// Hourly, plus up to 15 minutes of jitter so a fleet that booted together
/// does not download a release together.
pub const CHECK_INTERVAL: Duration = Duration::from_secs(3600);
const CHECK_JITTER_SECS: u64 = 15 * 60;
/// First check shortly after start rather than an interval later: a laptop
/// that was shut while a release went out picks it up the same morning.
const FIRST_CHECK_DELAY_SECS: std::ops::Range<u64> = 120..600;
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(300);

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

/// The sha256 of a package that already failed to install. Without this, a
/// bad release (wrong signature, wrong version inside) would be downloaded
/// again every hour on every device; with it, the device waits for the
/// server to publish different bytes.
static FAILED_SHA: Mutex<Option<String>> = Mutex::new(None);

pub async fn loop_check(client: AgentClient) {
    use rand::Rng;
    let first = rand::thread_rng().gen_range(FIRST_CHECK_DELAY_SECS);
    tokio::time::sleep(Duration::from_secs(first)).await;
    loop {
        if let Err(e) = check_once(&client).await {
            tracing::warn!(error = %e, "update check failed");
        }
        let jitter = rand::thread_rng().gen_range(0..CHECK_JITTER_SECS);
        tokio::time::sleep(CHECK_INTERVAL + Duration::from_secs(jitter)).await;
    }
}

/// Returns `Ok(true)` if an update was installed (the process is about to
/// exit), `Ok(false)` if nothing needed to happen, `Err` on any failure —
/// every error path here is deliberately non-fatal to the caller, matching
/// `check_once`'s Python counterpart which only ever logs and returns.
pub async fn check_once(client: &AgentClient) -> Result<bool, String> {
    if cfg!(debug_assertions) || !cfg!(target_os = "macos") {
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
    if FAILED_SHA.lock().unwrap().as_deref() == Some(artifact.sha256.as_str()) {
        return Ok(false);
    }

    tracing::info!(from = crate::config::AGENT_VERSION, to = %manifest.version, "updating agent");
    // A failed download is retried next check; a package that downloaded
    // fine but failed verification or install is not (until restart, or
    // until the server publishes different bytes).
    let pkg = download(&artifact.url, &artifact.sha256).await?;
    let version = manifest.version.clone();
    let result = tokio::task::spawn_blocking(move || mac::install_pkg(&pkg, &version)).await.map_err(|e| e.to_string())?;
    if let Err(e) = result {
        *FAILED_SHA.lock().unwrap() = Some(artifact.sha256.clone());
        return Err(format!("update to {} not installed: {e}", manifest.version));
    }

    tracing::info!(version = %manifest.version, "update installed — restarting into it");
    // launchd's KeepAlive starts the new binary straight away; the system
    // proxy points at our port for that second or two, the same as any
    // restart, and is re-applied by the new process on start.
    std::process::exit(0);
}

async fn download(url: &str, expected_sha: &str) -> Result<Vec<u8>, String> {
    use sha2::{Digest, Sha256};

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

    let actual = hex::encode(Sha256::digest(&bytes));
    if !actual.eq_ignore_ascii_case(expected_sha) {
        // A mismatch means the download was corrupted or tampered with.
        // Never install it.
        return Err(format!("sha256 {actual} != expected {expected_sha}"));
    }
    Ok(bytes.to_vec())
}

mod mac {
    use crate::procutil::{run, run_combined};
    use std::path::{Path, PathBuf};
    use std::time::Duration;

    const TOOL_TIMEOUT: Duration = Duration::from_secs(120);
    const BUNDLE_ID: &str = "com.aavishield.agent";

    /// Expand the package, check the app inside it, and swap it in.
    ///
    /// Every check happens before the swap; after it, the only remaining
    /// step is deleting the old copy. A failure anywhere leaves the
    /// installed app exactly as it was.
    pub fn install_pkg(pkg: &[u8], version: &str) -> Result<(), String> {
        install_into(&running_bundle()?, pkg, version)
    }

    pub(super) fn install_into(bundle: &Path, pkg: &[u8], version: &str) -> Result<(), String> {
        let requirement = designated_requirement(bundle)?;

        let work = std::env::temp_dir().join(format!("aavishield-update-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&work);
        std::fs::create_dir_all(&work).map_err(|e| e.to_string())?;
        let result = stage_and_swap(&work, pkg, version, bundle, &requirement);
        let _ = std::fs::remove_dir_all(&work);
        result
    }

    fn stage_and_swap(work: &Path, pkg: &[u8], version: &str, bundle: &Path, requirement: &str) -> Result<(), String> {
        let pkg_path = work.join("update.pkg");
        std::fs::write(&pkg_path, pkg).map_err(|e| e.to_string())?;

        let expanded = work.join("expanded");
        tool("pkgutil", &["--expand-full", path_str(&pkg_path)?, path_str(&expanded)?])?;
        let new_app = find_app(&expanded).ok_or("package does not contain Aavishield.app")?;

        // Same signer as the running app, so TCC grants carry over.
        let req_arg = format!("-R={requirement}");
        tool("codesign", &["--verify", "--deep", "--strict", &req_arg, path_str(&new_app)?])
            .map_err(|e| format!("new build is not signed like the running one: {e}"))?;

        // The version inside must be the one advertised; otherwise a
        // mislabelled upload would reinstall itself every hour forever.
        let plist = new_app.join("Contents/Info.plist");
        let inner = run("plutil", &["-extract", "CFBundleShortVersionString", "raw", "-o", "-", path_str(&plist)?], TOOL_TIMEOUT)
            .ok_or("could not read the new build's version")?;
        if inner.trim() != version {
            return Err(format!("package contains {} but was published as {version}", inner.trim()));
        }

        // Copy into the bundle itself so the swap below is a same-directory
        // rename (and needs no write access to /Applications), then swap
        // the two Contents directories in one atomic call: there is no
        // moment where launchd could find the bundle without a binary.
        let staged = bundle.join(".Contents.update");
        let _ = std::fs::remove_dir_all(&staged);
        tool("ditto", &[path_str(&new_app.join("Contents"))?, path_str(&staged)?])?;
        let live = bundle.join("Contents");
        swap(&staged, &live)?;
        // `staged` now holds the old build.
        let _ = std::fs::remove_dir_all(&staged);
        // Bump the bundle's mtime so Launch Services and Finder pick up the
        // new version string promptly.
        let _ = run("touch", &[path_str(bundle)?], TOOL_TIMEOUT);
        Ok(())
    }

    /// /Applications/Aavishield.app, from …/Contents/MacOS/aavishield-agent.
    fn running_bundle() -> Result<PathBuf, String> {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let exe = exe.canonicalize().unwrap_or(exe);
        exe.ancestors()
            .nth(3)
            .filter(|p| p.extension().is_some_and(|e| e == "app"))
            .map(Path::to_path_buf)
            .ok_or_else(|| format!("{} is not inside an .app bundle", exe.display()))
    }

    /// The running app's own designated requirement — exactly what TCC
    /// recorded its grants against. Refuses ad-hoc builds, whose
    /// requirement is a cdhash that no other build can ever satisfy.
    fn designated_requirement(bundle: &Path) -> Result<String, String> {
        let (_, out) = run_combined("codesign", &["-d", "-r-", path_str(bundle)?], TOOL_TIMEOUT).ok_or("codesign did not run")?;
        let req = out.lines().find_map(|l| l.strip_prefix("designated => ")).ok_or("running app has no designated requirement")?.trim().to_string();
        check_requirement(&req)?;
        Ok(req)
    }

    pub(super) fn check_requirement(req: &str) -> Result<(), String> {
        if req.contains("cdhash") || !req.contains("subject.OU") || !req.contains(&format!("identifier \"{BUNDLE_ID}\"")) {
            return Err("running app is not Developer ID signed — auto-update would reset its permissions; reinstall manually".into());
        }
        Ok(())
    }

    fn find_app(expanded: &Path) -> Option<PathBuf> {
        std::fs::read_dir(expanded).ok()?.flatten().map(|e| e.path().join("Payload/Applications/Aavishield.app")).find(|p| p.join("Contents/MacOS").is_dir())
    }

    #[cfg(target_os = "macos")]
    fn swap(a: &Path, b: &Path) -> Result<(), String> {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt;
        let a = CString::new(a.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
        let b = CString::new(b.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
        // SAFETY: two valid NUL-terminated paths; renamex_np only reads them.
        if unsafe { libc::renamex_np(a.as_ptr(), b.as_ptr(), libc::RENAME_SWAP) } != 0 {
            return Err(format!("swap failed: {}", std::io::Error::last_os_error()));
        }
        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    fn swap(_: &Path, _: &Path) -> Result<(), String> {
        Err("in-place swap is only implemented on macOS".into())
    }

    fn tool(cmd: &str, args: &[&str]) -> Result<(), String> {
        match run_combined(cmd, args, TOOL_TIMEOUT) {
            Some((true, _)) => Ok(()),
            Some((false, out)) => Err(format!("{cmd} failed: {}", out.trim())),
            None => Err(format!("{cmd} did not finish")),
        }
    }

    fn path_str(p: &Path) -> Result<&str, String> {
        p.to_str().ok_or_else(|| format!("non-UTF-8 path {}", p.display()))
    }
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
pub(crate) fn version_gt(a: &str, b: &str) -> bool {
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

    #[test]
    fn test_only_developer_id_builds_may_self_update() {
        let developer_id = r#"identifier "com.aavishield.agent" and anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] /* exists */ and certificate leaf[field.1.2.840.113635.100.6.1.13] /* exists */ and certificate leaf[subject.OU] = GSSGP2CX29"#;
        assert!(mac::check_requirement(developer_id).is_ok());
        assert!(mac::check_requirement(r#"cdhash H"0123abcd""#).is_err());
        assert!(mac::check_requirement(&developer_id.replace("com.aavishield.agent", "com.other.app")).is_err());
    }

    /// End to end against a real signed release, on a copy of an installed
    /// app — never the live one. Needs a Mac with Aavishield installed and
    /// a downloaded package, so it only runs on request:
    ///
    ///   AAVISHIELD_TEST_PKG=/path/aavishield-agent-rust-X.pkg AAVISHIELD_TEST_PKG_VERSION=X \
    ///     cargo test --lib update::tests::test_install_swaps_a_copy_of_the_installed_app -- --ignored
    #[test]
    #[ignore]
    #[cfg(target_os = "macos")]
    fn test_install_swaps_a_copy_of_the_installed_app() {
        use std::process::Command;
        let pkg = std::fs::read(std::env::var("AAVISHIELD_TEST_PKG").unwrap()).unwrap();
        let version = std::env::var("AAVISHIELD_TEST_PKG_VERSION").unwrap();
        let root = std::env::temp_dir().join(format!("aavishield-update-test-{}", std::process::id()));
        let bundle = root.join("Aavishield.app");
        assert!(Command::new("ditto").args(["/Applications/Aavishield.app", bundle.to_str().unwrap()]).status().unwrap().success());
        let marker = bundle.join("Contents/old-build-marker");
        std::fs::write(&marker, "old").unwrap();

        // A package whose inner version disagrees with the manifest is refused
        // and leaves the app alone.
        assert!(mac::install_into(&bundle, &pkg, "999.0.0").unwrap_err().contains("published as 999.0.0"));
        assert!(marker.exists());

        mac::install_into(&bundle, &pkg, &version).unwrap();
        assert!(!marker.exists(), "Contents was not replaced");
        assert!(!bundle.join(".Contents.update").exists(), "staging copy left behind");
        assert!(Command::new("codesign").args(["--verify", "--deep", "--strict", bundle.to_str().unwrap()]).status().unwrap().success());
        let _ = std::fs::remove_dir_all(&root);
    }
}
