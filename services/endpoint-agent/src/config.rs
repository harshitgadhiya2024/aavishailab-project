//! Agent configuration — a faithful port of the Python agent's config
//! loading (`load_config`, `ensure_enrolled`, `_find_enroll_token`).
//!
//! Enrollment scope note: this port implements **token-file enrollment**
//! only (an enrollment token dropped by a packaged installer or MDM
//! profile at a well-known path, or via env vars) — not the interactive
//! browser-callback flow (`browser_enroll` in the Python original, which
//! opens a browser and listens on loopback :6119 for the portal to hand
//! the token back). Browser enrollment is a first-run UX convenience for
//! a human clicking through a manual install; token-file enrollment is
//! what an actual managed deployment (packaged installer, MDM push) uses,
//! and is the one that matters for "production".

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub const AGENT_VERSION: &str = "1.0.0-rust";
pub const LOCAL_PORT: u16 = 6118;

pub const ENROLL_TOKEN_ENV: &str = "AAVISHIELD_ENROLL_TOKEN";
pub const ENROLL_ADMIN_ENV: &str = "AAVISHIELD_ADMIN_URL";
pub const ENROLL_PORTAL_ENV: &str = "AAVISHIELD_PORTAL_URL";

pub const DEFAULT_ADMIN_URL: &str = "https://aavishield-api.aavishailab.com";
pub const DEFAULT_PORTAL_URL: &str = "https://aavishield-employee.aavishailab.com";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub device_id: String,
    pub agent_key: String,
    pub org_id: String,
    #[serde(default)]
    pub employee_id: Option<String>,
    #[serde(default = "default_admin_url")]
    pub admin_url: String,
    #[serde(default = "default_portal_url")]
    pub portal_url: String,
    #[serde(default)]
    pub hostname: String,
}

fn default_admin_url() -> String {
    DEFAULT_ADMIN_URL.to_string()
}
fn default_portal_url() -> String {
    DEFAULT_PORTAL_URL.to_string()
}

/// Where the agent keeps its config, logs, and cached MITM leaf certs.
/// Mirrors `~/.aavishield/` in the Python original.
pub fn state_dir() -> PathBuf {
    if let Some(dirs) = directories::BaseDirs::new() {
        dirs.home_dir().join(".aavishield")
    } else {
        PathBuf::from(".aavishield")
    }
}

pub fn config_path() -> PathBuf {
    state_dir().join("config.json")
}

pub fn mitm_cert_dir() -> PathBuf {
    state_dir().join("certs")
}

/// Enrollment-token drop paths a packaged installer or MDM profile can
/// leave for an agent that hasn't enrolled yet. Order matters: the
/// per-user path first, then the two machine-wide ones.
pub fn enroll_drop_paths() -> Vec<PathBuf> {
    let mut paths = vec![state_dir().join("enroll.json")];
    if cfg!(target_os = "windows") {
        paths.push(PathBuf::from(r"C:\ProgramData\Aavishield\enroll.json"));
    } else {
        paths.push(PathBuf::from("/etc/aavishield/enroll.json"));
    }
    paths
}

#[derive(Debug, Deserialize)]
pub struct EnrollDrop {
    pub token: String,
    #[serde(default)]
    pub admin_url: Option<String>,
    #[serde(default)]
    pub portal_url: Option<String>,
}

/// Loads an existing config from disk, if present.
pub async fn load() -> Option<Config> {
    let path = config_path();
    let bytes = tokio::fs::read(&path).await.ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// Persists config to disk, `0600`-equivalent (owner-only) on Unix.
pub async fn save(config: &Config) -> std::io::Result<()> {
    let dir = state_dir();
    tokio::fs::create_dir_all(&dir).await?;
    let path = config_path();
    let body = serde_json::to_vec_pretty(config)?;
    write_private(&path, &body).await
}

#[cfg(unix)]
pub async fn write_private(path: &std::path::Path, content: &[u8]) -> std::io::Result<()> {
    use std::os::unix::fs::OpenOptionsExt;
    let path = path.to_path_buf();
    let content = content.to_vec();
    tokio::task::spawn_blocking(move || {
        use std::io::Write;
        let mut f = std::fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(&path)?;
        f.write_all(&content)
    })
    .await
    .unwrap()
}

#[cfg(not(unix))]
pub async fn write_private(path: &std::path::Path, content: &[u8]) -> std::io::Result<()> {
    tokio::fs::write(path, content).await
}

/// Finds an enrollment token from (in priority order) an env var or a
/// drop-file — mirrors `_find_enroll_token`.
pub async fn find_enroll_token() -> Option<(String, Option<String>, Option<String>)> {
    if let Ok(token) = std::env::var(ENROLL_TOKEN_ENV) {
        if !token.trim().is_empty() {
            return Some((token, std::env::var(ENROLL_ADMIN_ENV).ok(), std::env::var(ENROLL_PORTAL_ENV).ok()));
        }
    }
    for path in enroll_drop_paths() {
        if let Ok(bytes) = tokio::fs::read(&path).await {
            if let Ok(drop) = serde_json::from_slice::<EnrollDrop>(&bytes) {
                if !drop.token.trim().is_empty() {
                    return Some((drop.token, drop.admin_url, drop.portal_url));
                }
            }
        }
    }
    None
}

/// Removes any enrollment-drop files after a successful enroll, so a
/// stale token can't be reused/rediscovered on a later restart. Mirrors
/// `_discard_enroll_drops`.
pub async fn discard_enroll_drops() {
    for path in enroll_drop_paths() {
        let _ = tokio::fs::remove_file(&path).await;
    }
}

/// Root-owned, world-readable marker a privileged installer step leaves
/// behind once the org's MITM CA is actually in the OS/browser trust
/// store — a port of `mitm_ca_trusted`'s marker-file check.
///
/// Scope note: only the *check* is ported. Actually installing the CA
/// into the OS trust store (`_install_ca_darwin`/`_install_ca_linux`/
/// `_install_ca_windows`, and the privileged `--ca-trust-daemon` process
/// that runs them) is installer/packaging infrastructure, not core proxy
/// logic, and needs the code-signing/notarization pipeline this build
/// environment doesn't have — out of scope here, same as the rest of the
/// packaging story. Until an installer performs that step and leaves this
/// marker, MITM interception stays off (fail-open — see mitm.rs).
pub fn mitm_ca_trusted() -> bool {
    let marker = if cfg!(target_os = "windows") { PathBuf::from(r"C:\ProgramData\Aavishield\ca-trusted") } else { PathBuf::from("/etc/aavishield/ca-trusted") };
    marker.exists()
}

/// Test helper. Not `#[cfg(test)]`-gated: integration tests in `tests/`
/// compile as a separate crate that can't see `#[cfg(test)]` items in this
/// one (the same reason dlp-service-rust's `Config::for_test` isn't gated
/// either — see that crate's config.rs for the fuller explanation).
pub fn test_config() -> Config {
    Config {
        device_id: "11111111-1111-1111-1111-111111111111".to_string(),
        agent_key: "test-agent-key".to_string(),
        org_id: "22222222-2222-2222-2222-222222222222".to_string(),
        employee_id: None,
        admin_url: "https://admin.invalid".to_string(),
        portal_url: "https://portal.invalid".to_string(),
        hostname: "test-host".to_string(),
    }
}
