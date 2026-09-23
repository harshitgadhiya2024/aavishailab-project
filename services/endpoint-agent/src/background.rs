//! The background agent thread — everything Python's `run_agent()` does
//! (proxy, MITM, DLP/malware scan orchestration, policy/threat/CASB
//! caching, activity reporting, heartbeat, app control, inventory) minus
//! the GUI, which lives on the real main thread instead (see gui.rs and
//! the module doc on why).
//!
//! Exactly one of these threads runs for the lifetime of the process. It
//! owns its own `tokio::runtime::Runtime` — created here, not via
//! `#[tokio::main]` on `fn main` — because the GUI needs the *real* OS
//! main thread for itself (`eframe::run_native` blocks it, and on macOS
//! AppKit will abort the process if touched from anywhere else). This
//! thread is the mirror image of that constraint: everything async lives
//! here, nothing here may ever block waiting on the GUI.

use crate::activity::ActivityReporter;
use crate::casb_cache::CASBControlCache;
use crate::config::Config;
use crate::deps::Deps;
use crate::enforcement::EnforcementGate;
use crate::http_client::{AgentClient, AgentRevoked};
use crate::mitm::MitmEngine;
use crate::policy_cache::PolicyCache;
use crate::threat_cache::ThreatIntelCache;
use crate::ui_state::UiState;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const RULES_REFRESH_INTERVAL: Duration = Duration::from_secs(10);
const ACTIVITY_FLUSH_INTERVAL: Duration = Duration::from_secs(5);
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(60);
const MITM_CONFIG_REFRESH_INTERVAL: Duration = Duration::from_secs(300);

/// What the GUI sends this thread. One channel, one command type, so there
/// is exactly one place ("handle_command") that has to reason about what
/// the background thread is doing when a click arrives.
pub enum Command {
    /// Start (or restart, after a Cancel) interactive enrollment.
    Connect,
    CancelConnect,
    /// Reports the disconnect, tears down local state, and stops
    /// enforcing — mirrors Python's `begin_disconnect`.
    Disconnect,
}

/// A live `AgentClient`, once one exists — the GUI needs this for
/// Disconnect (and, later, Enable-HTTPS/Uninstall) to talk to the server
/// with this device's own credentials, but nothing about the GUI should
/// have to know how the client was built or when.
pub type ClientSlot = Arc<Mutex<Option<AgentClient>>>;

pub struct Handles {
    pub ui: UiState,
    pub client_slot: ClientSlot,
    pub commands: tokio::sync::mpsc::Sender<Command>,
}

/// Spawns the background thread and returns immediately with the handles
/// the GUI needs. The thread itself blocks forever on its own runtime.
pub fn spawn() -> Handles {
    let ui = UiState::new();
    let client_slot: ClientSlot = Arc::new(Mutex::new(None));
    let (tx, rx) = tokio::sync::mpsc::channel(8);

    let ui2 = ui.clone();
    let client_slot2 = client_slot.clone();
    std::thread::Builder::new()
        .name("aavishield-background".to_string())
        .spawn(move || {
            // rustls needs a crypto backend installed exactly once, before
            // any TLS connection — see the identical note this used to
            // carry in main.rs. Must happen on whichever thread first does
            // TLS, so it belongs here now, not in the (no longer async) fn
            // main.
            let _ = rustls::crypto::CryptoProvider::install_default(
                rustls::crypto::aws_lc_rs::default_provider(),
            );
            let rt = tokio::runtime::Runtime::new().expect("failed to start the background runtime");
            rt.block_on(run(ui2, client_slot2, rx));
        })
        .expect("failed to spawn the background agent thread");

    Handles { ui, client_slot, commands: tx }
}

async fn run(ui: UiState, client_slot: ClientSlot, mut commands: tokio::sync::mpsc::Receiver<Command>) {
    tracing::info!(version = crate::config::AGENT_VERSION, "aavishield-agent starting");

    // An existing config means this machine has already been through
    // enrollment (this run or a previous one) — start protecting
    // immediately and skip the "waiting for Connect" state entirely.
    if let Some(config) = crate::config::load().await {
        tracing::info!(device_id = %config.device_id, org_id = %config.org_id, "already enrolled");
        run_full_agent(config, ui, client_slot, commands).await;
        return;
    }

    // Not enrolled. Sit idle until the GUI's Connect button sends a
    // command — everything up to and including the proxy binding a port
    // waits for that, exactly as it does when a person is watching the
    // Python original's window.
    let cancel = Arc::new(AtomicBool::new(false));
    loop {
        let cmd = match commands.recv().await {
            Some(c) => c,
            None => return, // the GUI is gone; nothing left to wait for
        };
        match cmd {
            Command::Connect => {
                cancel.store(false, Ordering::SeqCst);
                ui.set_connecting();
                let portal_url = crate::config::resolved_portal_url();
                let admin_url = crate::config::resolved_admin_url();

                // `browser_enroll` can run for up to 30 minutes waiting on
                // a callback. It must not be `.await`ed directly here: that
                // would block this loop from ever reaching `commands.recv()`
                // again, so a CancelConnect sent mid-flight would just sit
                // in the channel, unread, until enrollment finished on its
                // own — exactly the bug an actual Cancel click found (the
                // window kept saying "Waiting for browser" indefinitely).
                // Racing the enrollment future against continued command
                // reception is what lets a command arrive *while* it's
                // still running: CancelConnect only flips a flag here, but
                // that flag is the same one `browser_enroll` polls every
                // 200ms, so together the click takes effect within about a
                // fifth of a second instead of never.
                let enroll_fut = crate::enroll_interactive::browser_enroll(&portal_url, &admin_url, cancel.clone());
                tokio::pin!(enroll_fut);
                let outcome = loop {
                    tokio::select! {
                        outcome = &mut enroll_fut => break outcome,
                        next = commands.recv() => match next {
                            Some(Command::CancelConnect) => cancel.store(true, Ordering::SeqCst),
                            // A second Connect while one is already running,
                            // or a Disconnect before anything exists to
                            // disconnect: neither has anything to do here.
                            Some(_) => {}
                            None => cancel.store(true, Ordering::SeqCst),
                        },
                    }
                };

                match outcome {
                    crate::enroll_interactive::EnrollOutcome::Enrolled(config) => {
                        tracing::info!(device_id = %config.device_id, "enrolled interactively");
                        run_full_agent(config, ui, client_slot, commands).await;
                        return;
                    }
                    crate::enroll_interactive::EnrollOutcome::Blocked(message) => {
                        ui.set_blocked(message);
                    }
                    crate::enroll_interactive::EnrollOutcome::Cancelled => {
                        ui.set_disconnected();
                    }
                }
            }
            Command::CancelConnect | Command::Disconnect => {
                // Nothing in flight to cancel, and nothing enrolled yet to
                // disconnect — both are no-ops outside an active Connect.
            }
        }
    }
}

/// Runs the full data plane forever: proxy, MITM, DLP/malware scan calls,
/// policy/threat/CASB caching, activity reporting, heartbeat, app control,
/// inventory. Identical to what `main.rs` used to do inline before the GUI
/// existed — relocated, not rewritten.
///
/// Still listens for `Command::Disconnect` after startup: an enrolled
/// device can still be disconnected from the window at any time.
async fn run_full_agent(config: Config, ui: UiState, client_slot: ClientSlot, mut commands: tokio::sync::mpsc::Receiver<Command>) {
    let revoked = AgentRevoked::default();
    let client = AgentClient::new(config, revoked.clone());
    *client_slot.lock().unwrap() = Some(client.clone());

    let gate = Arc::new(EnforcementGate::default());
    let policy = Arc::new(PolicyCache::new(client.clone()));
    let threats = Arc::new(ThreatIntelCache::new(client.clone()));
    let casb = Arc::new(CASBControlCache::new(client.clone()));
    let reporter = Arc::new(ActivityReporter::new(client.clone(), gate.clone()));
    let branding = Arc::new(crate::block_page::BrandingCache::new(client.clone()));
    let mitm = Arc::new(MitmEngine::new(client.clone(), Arc::new(crate::config::mitm_ca_trusted)));

    let deps = Arc::new(Deps {
        client: client.clone(),
        policy: policy.clone(),
        threats: threats.clone(),
        casb: casb.clone(),
        mitm: mitm.clone(),
        reporter: reporter.clone(),
        gate: gate.clone(),
        branding: branding.clone(),
        ui: ui.clone(),
    });

    crate::heartbeat::seed_enforcement(&deps).await;

    policy.refresh().await;
    mitm.refresh().await;
    branding.refresh().await;

    tokio::spawn({
        let policy = policy.clone();
        async move {
            loop {
                tokio::time::sleep(RULES_REFRESH_INTERVAL).await;
                policy.refresh().await;
            }
        }
    });
    tokio::spawn(mitm.clone().loop_refresh(MITM_CONFIG_REFRESH_INTERVAL));
    tokio::spawn(branding.clone().loop_refresh(crate::block_page::REFRESH_INTERVAL));
    tokio::spawn(reporter.clone().loop_flush(ACTIVITY_FLUSH_INTERVAL));
    tokio::spawn(crate::heartbeat::loop_heartbeat(deps.clone(), HEARTBEAT_INTERVAL));
    tokio::spawn(crate::inventory::loop_report(client.clone(), gate.clone()));
    tokio::spawn(Arc::new(crate::app_control::AppControlWatcher::new(client.clone(), gate.clone())).run());

    if gate.intercepts() {
        crate::system_proxy::apply_system_proxy().await;
    }

    // Disconnect is handled on its own task: it has to run concurrently
    // with the proxy below (which occupies this async fn for the rest of
    // the process's life), not compete with it in the same select! loop —
    // the proxy is the reason this thread exists, and nothing about
    // watching for a Disconnect click should ever add latency to it.
    let disconnect_client = client.clone();
    let disconnect_ui = ui.clone();
    let disconnect_revoked = revoked.clone();
    tokio::spawn(async move {
        while let Some(cmd) = commands.recv().await {
            if let Command::Disconnect = cmd {
                handle_disconnect(&disconnect_client, &disconnect_ui, &disconnect_revoked).await;
            }
            // Connect/CancelConnect have nothing to do once already
            // enrolled — the button that would send them isn't shown.
        }
    });

    let addr = SocketAddr::from(([127, 0, 0, 1], crate::config::LOCAL_PORT));
    if let Err(e) = crate::proxy::run(addr, deps).await {
        tracing::error!(error = %e, "proxy listener exited");
    }
}

/// Stops protection on this device and tells the company — a port of
/// Python's `begin_disconnect`.
///
/// Disconnecting is the employee's to make, but it ends coverage, so it is
/// reported rather than silently allowed: the server writes an activity
/// event and emails the org's admins. Local teardown happens regardless of
/// whether that report reaches the server — the person asked to stop being
/// monitored, and a network hiccup must not be the reason it doesn't take.
async fn handle_disconnect(client: &AgentClient, ui: &UiState, revoked: &AgentRevoked) {
    if let Err(e) = client.post_json("/internal/agent/lifecycle/disconnected", &serde_json::json!({})).await {
        tracing::warn!(error = %e, "could not report the disconnect");
    }
    crate::system_proxy::clear_system_proxy().await;
    if let Err(e) = crate::config::remove().await {
        tracing::warn!(error = %e, "could not remove the local config file");
    }
    revoked.set(); // stops the running loops from enforcing
    ui.set_disconnected();
    tracing::info!("disconnected by the employee");
}
