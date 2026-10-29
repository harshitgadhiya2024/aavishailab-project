//! The Windows service — the SYSTEM half of the Windows agent.
//!
//! The agent itself runs as the signed-in person (it owns their proxy
//! setting, their screen, their notifications), and a standard user can do
//! none of the three things below. This service, installed by the .msi as
//! LocalSystem (`aavishield-agent.exe --service`), does them, so nobody at
//! the company ever has to:
//!
//! 1. **Keeps the agent running** in every signed-in session, the way
//!    launchd's KeepAlive does on macOS: started at sign-in, right after
//!    install or upgrade, and again within seconds if it exits or crashes.
//! 2. **Trusts the organisation's inspection CA** machine-wide
//!    (LocalMachine\Root), as soon as a person on this PC enrolls. Without
//!    it HTTPS stays a blind tunnel: no DLP, no download scanning, no block
//!    page. The certificate is fetched by this service itself, from the
//!    built-in admin API over TLS with the device's own credentials, so a
//!    local user cannot get an arbitrary root installed by editing a file.
//! 3. **Installs updates**: polls for a newer Windows release, checks its
//!    SHA-256 and that it carries the same Authenticode signer as this
//!    build, then runs it with msiexec.
//!
//! `--uninstall-cleanup` (run by the .msi on removal) undoes all of it and
//! puts every user's proxy setting back.

use crate::win;
use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, Instant, SystemTime};
use winreg::enums::{HKEY_LOCAL_MACHINE, HKEY_USERS, KEY_READ, KEY_WOW64_64KEY};
use winreg::RegKey;

pub const SERVICE_NAME: &str = "AavishieldService";
const AGENT_EXE: &str = "aavishield-agent.exe";
/// HKLM\SOFTWARE\Aavishield — admin/SYSTEM-only, unlike anything under a
/// user profile.
const STATE_KEY: &str = "SOFTWARE\\Aavishield";
const TRUSTED_CAS_KEY: &str = "SOFTWARE\\Aavishield\\TrustedCAs";

const TICK: Duration = Duration::from_secs(3);
const CA_SYNC_EVERY: Duration = Duration::from_secs(15);
/// A config that has not changed is re-checked this often anyway, which is
/// how a rotated org CA reaches devices that are already enrolled.
const CA_RECHECK_EVERY: Duration = Duration::from_secs(6 * 3600);
const UPDATE_EVERY: Duration = Duration::from_secs(3600);

fn data_dir() -> PathBuf {
    let base = std::env::var_os("ProgramData").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\ProgramData"));
    base.join("Aavishield")
}

// ─── Service plumbing ────────────────────────────────────────────────────────

windows_service::define_windows_service!(ffi_service_main, service_main);

/// Entry point for `--service`; returns once the service has stopped.
pub fn run() {
    if let Err(e) = windows_service::service_dispatcher::start(SERVICE_NAME, ffi_service_main) {
        // Not started by the Service Control Manager (someone ran
        // `--service` by hand). Nothing to do.
        eprintln!("aavishield service: {e}");
    }
}

fn service_main(_args: Vec<OsString>) {
    use windows_service::service::{ServiceControl, ServiceControlAccept, ServiceExitCode, ServiceState, ServiceStatus, ServiceType};
    use windows_service::service_control_handler::{self, ServiceControlHandlerResult};

    // Before logging: this also repairs the permissions of files already in
    // there, including the log itself.
    secure_data_dir();
    init_logging();
    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let handler = move |event| match event {
        ServiceControl::Stop | ServiceControl::Shutdown => {
            let _ = stop_tx.send(());
            ServiceControlHandlerResult::NoError
        }
        ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
        _ => ServiceControlHandlerResult::NotImplemented,
    };
    let Ok(status) = service_control_handler::register(SERVICE_NAME, handler) else { return };
    let set = |state: ServiceState, accept: ServiceControlAccept| {
        let _ = status.set_service_status(ServiceStatus {
            service_type: ServiceType::OWN_PROCESS,
            current_state: state,
            controls_accepted: accept,
            exit_code: ServiceExitCode::Win32(0),
            checkpoint: 0,
            wait_hint: Duration::from_secs(10),
            process_id: None,
        });
    };
    set(ServiceState::Running, ServiceControlAccept::STOP | ServiceControlAccept::SHUTDOWN);
    tracing::info!(version = crate::config::AGENT_VERSION, "Aavishield service started");

    match tokio::runtime::Builder::new_multi_thread().worker_threads(2).enable_all().build() {
        Ok(rt) => rt.block_on(main_loop(stop_rx)),
        Err(e) => tracing::error!(error = %e, "could not start the service runtime"),
    }

    tracing::info!("Aavishield service stopping");
    set(ServiceState::Stopped, ServiceControlAccept::empty());
}

/// C:\ProgramData\Aavishield\logs\service.log, restarted when it passes
/// 5 MB so it can never fill a disk.
fn init_logging() {
    let dir = data_dir().join("logs");
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("service.log");
    if std::fs::metadata(&path).map(|m| m.len() > 5 * 1024 * 1024).unwrap_or(false) {
        let _ = std::fs::rename(&path, dir.join("service.old.log"));
    }
    if let Ok(file) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = tracing_subscriber::fmt()
            .with_ansi(false)
            .with_writer(std::sync::Mutex::new(file))
            .with_env_filter(tracing_subscriber::EnvFilter::new("aavishield_agent=info"))
            .try_init();
    }
}

async fn main_loop(stop: mpsc::Receiver<()>) {
    note_failed_update();

    let mut supervisor = Supervisor::default();
    let mut ca = CaSync::default();
    let mut next_ca = Instant::now();
    let mut next_update = Instant::now() + Duration::from_secs(rand_secs(120, 600));

    loop {
        if stop.try_recv().is_ok() {
            return;
        }
        supervisor.tick();
        if Instant::now() >= next_ca {
            ca.sync().await;
            next_ca = Instant::now() + CA_SYNC_EVERY;
        }
        if Instant::now() >= next_update {
            if let Err(e) = update_check(&ca).await {
                tracing::warn!(error = %e, "update check failed");
            }
            next_update = Instant::now() + UPDATE_EVERY + Duration::from_secs(rand_secs(0, 900));
        }
        tokio::time::sleep(TICK).await;
    }
}

fn rand_secs(lo: u64, hi: u64) -> u64 {
    use rand::Rng;
    rand::thread_rng().gen_range(lo..hi)
}

/// ProgramData\Aavishield: full control for SYSTEM and Administrators,
/// read-only for everyone else. Update packages and CA files are staged
/// here, so a standard user must not be able to swap them.
fn secure_data_dir() {
    let dir = data_dir();
    let _ = std::fs::create_dir_all(&dir);
    lock_down(&dir, true);
}

/// `readable_by_users`: whether the Users group keeps read access.
fn lock_down(dir: &Path, readable_by_users: bool) -> bool {
    let path = dir.to_string_lossy().to_string();
    let mut args = vec![path.as_str(), "/inheritance:r", "/grant:r", "*S-1-5-18:(OI)(CI)F", "/grant:r", "*S-1-5-32-544:(OI)(CI)F"];
    if readable_by_users {
        args.extend(["/grant:r", "*S-1-5-32-545:(OI)(CI)RX"]);
    }
    args.extend(["/C", "/Q"]);
    let ok = crate::procutil::run("icacls", &args, Duration::from_secs(30)).is_some();
    // Everything already inside goes back to inheriting from the folder.
    // Not `/T` above: (OI)(CI) is meaningless on a file, and icacls left
    // existing files with no access entries at all, unreadable even by
    // SYSTEM.
    let children = format!("{path}\\*");
    let _ = crate::procutil::run("icacls", &[&children, "/reset", "/T", "/C", "/Q"], Duration::from_secs(30));
    ok
}

// ─── 1. Keeping the agent running ────────────────────────────────────────────

#[derive(Default)]
struct Supervisor {
    /// Recent launches per session, to stop a crashing agent from being
    /// relaunched in a tight loop.
    launches: HashMap<u32, Vec<Instant>>,
}

impl Supervisor {
    fn tick(&mut self) {
        // Never while Windows Installer is busy: that is our own upgrade
        // replacing the very file we would start.
        if win::installer_running() {
            return;
        }
        let sessions = win::active_sessions();
        if sessions.is_empty() {
            return;
        }
        let Ok(exe) = std::env::current_exe() else { return };
        let me = std::process::id();
        let running: HashSet<u32> = win::processes()
            .into_iter()
            .filter(|p| p.pid != me && p.name.eq_ignore_ascii_case(AGENT_EXE))
            .filter_map(|p| win::session_of(p.pid))
            .collect();

        for session in sessions {
            if running.contains(&session) {
                continue;
            }
            let recent = self.launches.entry(session).or_default();
            recent.retain(|t| t.elapsed() < Duration::from_secs(300));
            // Three starts in five minutes that did not stay up: back off
            // to one attempt per five minutes rather than spin.
            if recent.len() >= 3 && recent.last().is_some_and(|t| t.elapsed() < Duration::from_secs(300)) {
                continue;
            }
            recent.push(Instant::now());
            match win::launch_in_session(session, &exe.to_string_lossy(), "") {
                Ok(pid) => tracing::info!(session, pid, "started the agent for the signed-in user"),
                Err(e) => tracing::warn!(session, error = %e, "could not start the agent in this session"),
            }
        }
    }
}

// ─── 2. Trusting the organisation CA ─────────────────────────────────────────

/// A user profile on this PC with an enrolled agent.
struct Enrolled {
    config_path: PathBuf,
    device_id: String,
    agent_key: String,
}

/// Every local and Azure AD account's profile directory, from the
/// registry rather than by listing C:\Users.
fn user_profiles() -> Vec<(String, PathBuf)> {
    let Ok(list) = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey_with_flags("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\ProfileList", KEY_READ | KEY_WOW64_64KEY) else {
        return Vec::new();
    };
    let system_drive = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into());
    list.enum_keys()
        .flatten()
        .filter(|sid| sid.starts_with("S-1-5-21-") || sid.starts_with("S-1-12-1-"))
        .filter_map(|sid| {
            let path: String = list.open_subkey(&sid).ok()?.get_value("ProfileImagePath").ok()?;
            Some((sid, PathBuf::from(path.replace("%SystemDrive%", &system_drive))))
        })
        .collect()
}

fn enrolled_profiles() -> Vec<Enrolled> {
    user_profiles()
        .into_iter()
        .filter_map(|(_, dir)| {
            let config_path = dir.join(".aavishield").join("config.json");
            let config: crate::config::Config = serde_json::from_slice(&std::fs::read(&config_path).ok()?).ok()?;
            // The admin API is the one built into this binary, never one
            // named in a file the user can edit: that file deciding where
            // SYSTEM fetches a root certificate from would let anyone on
            // the PC install a CA of their choosing.
            if origin(&config.admin_url) != origin(crate::config::DEFAULT_ADMIN_URL) {
                tracing::warn!(path = %config_path.display(), "ignoring an agent config that points at a different server");
                return None;
            }
            Some(Enrolled { config_path, device_id: config.device_id, agent_key: config.agent_key })
        })
        .collect()
}

fn origin(url: &str) -> String {
    let url = url.trim().trim_end_matches('/').to_ascii_lowercase();
    match url.find("://") {
        Some(i) => {
            let rest = &url[i + 3..];
            format!("{}{}", &url[..i + 3], &rest[..rest.find('/').unwrap_or(rest.len())])
        }
        None => url,
    }
}

fn http() -> reqwest::Client {
    // no_proxy: SYSTEM talks to the server directly, never through any
    // proxy setting it might inherit.
    reqwest::Client::builder()
        .no_proxy()
        .user_agent(concat!("AavishieldService/", env!("AAVISHIELD_VERSION")))
        .timeout(Duration::from_secs(30))
        .build()
        .unwrap_or_default()
}

async fn agent_get(path: &str, device_id: &str, agent_key: &str) -> Result<reqwest::Response, String> {
    let url = format!("{}{path}", crate::config::DEFAULT_ADMIN_URL);
    http().get(url).bearer_auth(format!("{device_id}:{agent_key}")).send().await.map_err(|e| e.to_string())
}

struct Known {
    modified: Option<SystemTime>,
    len: u64,
    thumbprint: String,
    checked: Instant,
}

#[derive(Default)]
struct CaSync {
    known: HashMap<PathBuf, Known>,
    /// Credentials of an enrolled agent, for the update check.
    creds: Option<(String, String)>,
}

impl CaSync {
    async fn sync(&mut self) {
        let profiles = enrolled_profiles();
        self.creds = profiles.first().map(|p| (p.device_id.clone(), p.agent_key.clone()));
        if !profiles.is_empty() {
            // The installer's enrollment token has been used; a copy left
            // readable on disk is a credential nobody needs any more.
            let _ = std::fs::remove_file(data_dir().join("enroll.json"));
        }

        let mut wanted = HashSet::new();
        // Only remove a certificate when every enrolled profile answered:
        // a network blip must never take inspection away.
        let mut complete = true;
        for p in &profiles {
            let meta = std::fs::metadata(&p.config_path).ok();
            let (modified, len) = (meta.as_ref().and_then(|m| m.modified().ok()), meta.as_ref().map_or(0, |m| m.len()));
            if let Some(k) = self.known.get(&p.config_path) {
                if k.modified == modified && k.len == len && k.checked.elapsed() < CA_RECHECK_EVERY && is_trusted_root(&k.thumbprint) {
                    wanted.insert(k.thumbprint.clone());
                    continue;
                }
            }
            match fetch_ca(&p.device_id, &p.agent_key).await {
                Ok(Some(pem)) => match install_ca(&pem) {
                    Ok(thumb) => {
                        wanted.insert(thumb.clone());
                        self.known.insert(p.config_path.clone(), Known { modified, len, thumbprint: thumb, checked: Instant::now() });
                    }
                    Err(e) => {
                        complete = false;
                        tracing::warn!(error = %e, "could not trust the organisation CA");
                    }
                },
                // The server no longer knows this device (deleted or
                // revoked): its CA is not wanted on its behalf.
                Ok(None) => {
                    self.known.remove(&p.config_path);
                }
                Err(e) => {
                    complete = false;
                    if let Some(k) = self.known.get(&p.config_path) {
                        wanted.insert(k.thumbprint.clone());
                    }
                    tracing::debug!(error = %e, "could not fetch the organisation CA");
                }
            }
        }
        self.known.retain(|path, _| profiles.iter().any(|p| &p.config_path == path));
        if complete {
            remove_unwanted_cas(&wanted);
        }
    }
}

/// `Ok(None)` when the server rejects the device's credentials.
async fn fetch_ca(device_id: &str, agent_key: &str) -> Result<Option<String>, String> {
    let resp = agent_get("/internal/agent/ca-cert", device_id, agent_key).await?;
    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN || status == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !status.is_success() {
        return Err(format!("HTTP {status}"));
    }
    resp.text().await.map(Some).map_err(|e| e.to_string())
}

fn is_trusted_root(thumbprint: &str) -> bool {
    RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(format!("SOFTWARE\\Microsoft\\SystemCertificates\\ROOT\\Certificates\\{thumbprint}")).is_ok()
}

/// Adds the certificate to LocalMachine\Root and records that we did, so
/// uninstall (and a later change of organisation) removes exactly ours.
fn install_ca(pem: &str) -> Result<String, String> {
    let thumb = crate::ca_trust::thumbprint(pem).ok_or("not a PEM certificate")?;
    if !is_trusted_root(&thumb) {
        let dir = data_dir().join("ca");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let file = dir.join(format!("{thumb}.pem"));
        std::fs::write(&file, pem).map_err(|e| e.to_string())?;
        let out = crate::procutil::run_combined("certutil", &["-addstore", "-f", "Root", &file.to_string_lossy()], Duration::from_secs(30));
        if !matches!(out, Some((true, _))) || !is_trusted_root(&thumb) {
            return Err(format!("certutil -addstore failed: {}", out.map(|(_, o)| o).unwrap_or_default().trim()));
        }
        tracing::info!(thumbprint = %thumb, "organisation CA is now a trusted root on this PC");
    }
    if let Ok((key, _)) = RegKey::predef(HKEY_LOCAL_MACHINE).create_subkey(TRUSTED_CAS_KEY) {
        let _ = key.set_value(&thumb, &"Aavishield SSL Inspection CA");
    }
    Ok(thumb)
}

fn installed_cas() -> Vec<String> {
    RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(TRUSTED_CAS_KEY).map(|k| k.enum_values().flatten().map(|(name, _)| name).collect()).unwrap_or_default()
}

fn remove_unwanted_cas(wanted: &HashSet<String>) {
    for thumb in installed_cas() {
        if !wanted.contains(&thumb) {
            remove_ca(&thumb);
        }
    }
}

fn remove_ca(thumb: &str) {
    // Only ever a thumbprint we recorded installing: hex, nothing else.
    if thumb.is_empty() || !thumb.chars().all(|c| c.is_ascii_hexdigit()) {
        return;
    }
    let _ = crate::procutil::run("certutil", &["-delstore", "Root", thumb], Duration::from_secs(30));
    if !is_trusted_root(thumb) {
        tracing::info!(thumbprint = %thumb, "removed an organisation CA this PC no longer needs");
        if let Ok(key) = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey_with_flags(TRUSTED_CAS_KEY, winreg::enums::KEY_ALL_ACCESS) {
            let _ = key.delete_value(thumb);
        }
        let _ = std::fs::remove_file(data_dir().join("ca").join(format!("{thumb}.pem")));
    }
}

// ─── 3. Updates ──────────────────────────────────────────────────────────────

#[derive(serde::Deserialize)]
struct Manifest {
    version: String,
    #[serde(default)]
    artifacts: HashMap<String, Artifact>,
}

#[derive(serde::Deserialize)]
struct Artifact {
    url: String,
    sha256: String,
}

fn state_key() -> Option<RegKey> {
    RegKey::predef(HKEY_LOCAL_MACHINE).create_subkey(STATE_KEY).ok().map(|(k, _)| k)
}

/// An attempt recorded before msiexec ran that left us on an older version
/// failed. Its package is never tried again; the next release is.
fn note_failed_update() {
    let Some(key) = state_key() else { return };
    let Ok(attempt) = key.get_value::<String, _>("UpdateAttempt") else { return };
    let _ = key.delete_value("UpdateAttempt");
    if let Some((version, sha)) = attempt.split_once('|') {
        if crate::update::version_gt(version, crate::config::AGENT_VERSION) {
            tracing::warn!(version, "the last update did not install — not retrying that package");
            let _ = key.set_value("UpdateFailedSha", &sha.to_string());
        } else {
            tracing::info!(version = crate::config::AGENT_VERSION, "updated");
        }
    }
}

async fn update_check(ca: &CaSync) -> Result<(), String> {
    if cfg!(debug_assertions) {
        return Ok(());
    }
    let Some((device_id, agent_key)) = ca.creds.clone() else { return Ok(()) };
    let resp = agent_get("/internal/agent/version", &device_id, &agent_key).await?;
    if resp.status() == reqwest::StatusCode::NO_CONTENT || !resp.status().is_success() {
        return Ok(());
    }
    let manifest: Manifest = resp.json().await.map_err(|e| e.to_string())?;
    if !crate::update::version_gt(&manifest.version, crate::config::AGENT_VERSION) {
        return Ok(());
    }
    let Some(artifact) = manifest.artifacts.get("windows") else { return Ok(()) };
    let failed: Option<String> = state_key().and_then(|k| k.get_value("UpdateFailedSha").ok());
    if failed.as_deref().is_some_and(|f| f.eq_ignore_ascii_case(&artifact.sha256)) {
        return Ok(());
    }
    // The package must come from the same server, whatever the manifest says.
    if origin(&artifact.url) != origin(crate::config::DEFAULT_ADMIN_URL) {
        return Err(format!("refusing an update hosted at {}", artifact.url));
    }
    tracing::info!(from = crate::config::AGENT_VERSION, to = %manifest.version, "downloading update");

    let bytes = http().get(&artifact.url).timeout(Duration::from_secs(600)).send().await.map_err(|e| e.to_string())?.bytes().await.map_err(|e| e.to_string())?;
    let actual = {
        use sha2::{Digest, Sha256};
        hex::encode(Sha256::digest(&bytes))
    };
    if !actual.eq_ignore_ascii_case(&artifact.sha256) {
        return Err(format!("sha256 {actual} != expected {}", artifact.sha256));
    }

    // A fresh directory only SYSTEM and Administrators can write, so the
    // package cannot be swapped between the checks below and msiexec.
    let dir = data_dir().join("updates");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    if !lock_down(&dir, false) {
        return Err("could not restrict the update directory".into());
    }
    let msi = dir.join(format!("aavishield-agent-{}.msi", manifest.version));
    std::fs::write(&msi, &bytes).map_err(|e| e.to_string())?;

    let version = manifest.version.clone();
    let msi_for_check = msi.clone();
    tokio::task::spawn_blocking(move || verify_package(&msi_for_check, &version)).await.map_err(|e| e.to_string())??;

    if let Some(key) = state_key() {
        let _ = key.set_value("UpdateAttempt", &format!("{}|{}", manifest.version, artifact.sha256));
    }
    let log = data_dir().join("logs").join(format!("update-{}.log", manifest.version));
    tracing::info!(version = %manifest.version, "installing update");
    // Detached: msiexec stops this service as part of the upgrade, and the
    // install must carry on without us. The new service starts the agent
    // again when it is done.
    use std::os::windows::process::CommandExt;
    const DETACHED_PROCESS: u32 = 0x0000_0008;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    std::process::Command::new("msiexec.exe")
        .args(["/i", &msi.to_string_lossy(), "/qn", "/norestart", "/l*v", &log.to_string_lossy()])
        .creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP)
        .spawn()
        .map_err(|e| format!("could not start msiexec: {e}"))?;
    Ok(())
}

/// The package must be signed by the same publisher as the running build
/// (both valid, same subject and issuer), and contain the version it was
/// published as. An unsigned running build never updates itself: there is
/// no publisher to match.
fn verify_package(msi: &Path, version: &str) -> Result<(), String> {
    const SCRIPT: &str = r#"
$ErrorActionPreference='Stop'
$a=Get-AuthenticodeSignature -LiteralPath $env:AAVISHIELD_NEW
$b=Get-AuthenticodeSignature -LiteralPath $env:AAVISHIELD_SELF
"new=$($a.Status)|$($a.SignerCertificate.Subject)|$($a.SignerCertificate.Issuer)"
"self=$($b.Status)|$($b.SignerCertificate.Subject)|$($b.SignerCertificate.Issuer)"
$i=New-Object -ComObject WindowsInstaller.Installer
$db=$i.GetType().InvokeMember('OpenDatabase','InvokeMethod',$null,$i,@($env:AAVISHIELD_NEW,0))
$v=$db.GetType().InvokeMember('OpenView','InvokeMethod',$null,$db,@("SELECT Value FROM Property WHERE Property='ProductVersion'"))
$v.GetType().InvokeMember('Execute','InvokeMethod',$null,$v,$null) | Out-Null
$r=$v.GetType().InvokeMember('Fetch','InvokeMethod',$null,$v,$null)
"version=$($r.GetType().InvokeMember('StringData','GetProperty',$null,$r,1))"
$v.GetType().InvokeMember('Close','InvokeMethod',$null,$v,$null) | Out-Null
"#;
    let me = std::env::current_exe().map_err(|e| e.to_string())?;
    let out = crate::procutil::command("powershell")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", SCRIPT])
        .env("AAVISHIELD_NEW", msi)
        .env("AAVISHIELD_SELF", &me)
        .output()
        .map_err(|e| e.to_string())?;
    check_verification(&String::from_utf8_lossy(&out.stdout), version)
}

fn check_verification(out: &str, version: &str) -> Result<(), String> {
    let field = |k: &str| out.lines().find_map(|l| l.trim().strip_prefix(k)?.strip_prefix('=').map(str::to_string)).unwrap_or_default();
    let (new, me) = (field("new"), field("self"));
    if !me.starts_with("Valid|") {
        return Err("this build is not signed, so it cannot verify an update — install the new version manually".into());
    }
    if new != me {
        return Err(format!("the package is not signed by the same publisher ({new})"));
    }
    let inner = field("version");
    if inner.trim() != version {
        return Err(format!("package contains {} but was published as {version}", inner.trim()));
    }
    Ok(())
}

// ─── Uninstall ───────────────────────────────────────────────────────────────

/// `--uninstall-cleanup`, run as SYSTEM by the .msi on a real uninstall
/// (not an upgrade): stop every agent, give every user a working direct
/// internet connection back, remove the CAs we trusted, and delete the
/// per-user enrollment so a reinstall starts clean.
pub fn uninstall_cleanup() {
    init_logging();
    tracing::info!("uninstalling: cleaning up");
    let me = std::process::id();
    for p in win::processes() {
        if p.pid != me && p.name.eq_ignore_ascii_case(AGENT_EXE) {
            let _ = crate::procutil::run("taskkill", &["/F", "/PID", &p.pid.to_string()], Duration::from_secs(10));
        }
    }

    // Tell the company, as a disconnect would, so removal is never silent.
    if let Ok(rt) = tokio::runtime::Builder::new_current_thread().enable_all().build() {
        for p in enrolled_profiles() {
            let _ = rt.block_on(async {
                tokio::time::timeout(
                    Duration::from_secs(5),
                    http()
                        .post(format!("{}/internal/agent/lifecycle/disconnected", crate::config::DEFAULT_ADMIN_URL))
                        .bearer_auth(format!("{}:{}", p.device_id, p.agent_key))
                        .json(&serde_json::json!({"reason": "uninstalled"}))
                        .send(),
                )
                .await
            });
        }
    }

    for (sid, dir) in user_profiles() {
        reset_user_proxy(&sid, &dir);
        let _ = std::fs::remove_dir_all(dir.join(".aavishield"));
    }
    for thumb in installed_cas() {
        remove_ca(&thumb);
    }
    let _ = RegKey::predef(HKEY_LOCAL_MACHINE).delete_subkey_all(STATE_KEY);
    for sub in ["ca", "updates", "enroll.json"] {
        let path = data_dir().join(sub);
        let _ = std::fs::remove_dir_all(&path);
        let _ = std::fs::remove_file(&path);
    }
}

/// Turns the proxy off for one user if it still points at the agent —
/// including users who are not signed in, whose registry hive is loaded
/// just for this. Otherwise they would sign in after the uninstall to a PC
/// with no internet.
fn reset_user_proxy(sid: &str, profile: &Path) {
    const SETTINGS: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";
    let fix = |root: &RegKey| {
        let Ok(key) = root.open_subkey_with_flags(SETTINGS, winreg::enums::KEY_ALL_ACCESS) else { return };
        let server: String = key.get_value("ProxyServer").unwrap_or_default();
        if server.contains(&format!("127.0.0.1:{}", crate::config::LOCAL_PORT)) {
            let _ = key.set_value("ProxyEnable", &0u32);
            let _ = key.delete_value("ProxyServer");
            let _ = key.delete_value("ProxyOverride");
        }
    };
    let users = RegKey::predef(HKEY_USERS);
    if let Ok(root) = users.open_subkey(sid) {
        fix(&root);
        return;
    }
    let hive = profile.join("NTUSER.DAT");
    if !hive.exists() {
        return;
    }
    let mount = "AavishieldUninstall";
    if crate::procutil::run("reg", &["load", &format!("HKU\\{mount}"), &hive.to_string_lossy()], Duration::from_secs(30)).is_some() {
        if let Ok(root) = users.open_subkey(mount) {
            fix(&root);
        }
        let _ = crate::procutil::run("reg", &["unload", &format!("HKU\\{mount}")], Duration::from_secs(30));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_origin_ignores_path_case_and_trailing_slash() {
        assert_eq!(origin("https://API.aavishield.com/"), origin("https://api.aavishield.com"));
        assert_eq!(origin("https://api.aavishield.com/agent/packages/x.msi"), "https://api.aavishield.com");
        assert_ne!(origin("https://api.aavishield.com.evil.example"), origin("https://api.aavishield.com"));
    }

    #[test]
    fn test_update_needs_matching_signer_and_version() {
        let signed = "new=Valid|CN=A|CN=CA\nself=Valid|CN=A|CN=CA\nversion=3.0.0\n";
        assert!(check_verification(signed, "3.0.0").is_ok());
        assert!(check_verification(signed, "3.0.1").is_err(), "published version must match");
        assert!(check_verification("new=Valid|CN=B|CN=CA\nself=Valid|CN=A|CN=CA\nversion=3.0.0", "3.0.0").is_err(), "different publisher");
        assert!(check_verification("new=NotSigned||\nself=Valid|CN=A|CN=CA\nversion=3.0.0", "3.0.0").is_err());
        assert!(check_verification("new=NotSigned||\nself=NotSigned||\nversion=3.0.0", "3.0.0").is_err(), "an unsigned build never self-updates");
    }
}
