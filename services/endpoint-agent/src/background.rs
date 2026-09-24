//! The background agent thread — everything Python's `run_agent()` does
//! (proxy, MITM, DLP/malware scan orchestration, policy/threat/CASB
//! caching, activity reporting, heartbeat, app control, inventory,
//! screenshot capture, activity monitoring, auto-update) minus the GUI,
//! which lives on the real main thread instead (see gui.rs and the
//! module doc on why).
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
    /// Removal needs a company administrator's credentials, verified by
    /// the server — the employee cannot do this alone. `respond` carries
    /// back `Ok(())` (the platform uninstaller has been kicked off — the
    /// GUI should show a "removing…" confirmation) or `Err(message)` (the
    /// credentials were rejected, or the server couldn't be reached) —
    /// mirrors Python's `begin_uninstall` returning `{ok}` or `{error}`
    /// for the window to render directly. A `oneshot`, not fire-and-
    /// forget like Connect/Disconnect: unlike those, the GUI has
    /// something specific to say back to the person depending on the
    /// outcome.
    Uninstall { email: String, password: String, respond: tokio::sync::oneshot::Sender<Result<(), String>> },
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

    // Self-heal a stale system proxy left behind by a previous instance
    // of this same agent that never got to run its own cleanup — killed,
    // crashed, or the process simply vanished mid-run (all reproduced for
    // real today: an install that silently failed left the LaunchAgent
    // registered but the binary gone, so nothing ever relaunched to clear
    // the proxy it had set, and every request on the machine failed with
    // "can't reach page" until someone noticed and turned it off by hand).
    // clear_system_proxy()/apply_system_proxy() only ever run from inside
    // a live process (handle_disconnect, the uninstall flow, the
    // intercepts()-gated call further down) — nothing runs if that
    // process is gone, so the very next thing to start (a fresh launch,
    // or launchd's KeepAlive after a crash) is the first real chance to
    // notice and fix it. system_proxy_active() only ever returns true for
    // our own literal port — nothing else on the machine would coincide
    // with it — so clearing it here can't be clobbering someone else's
    // proxy configuration. Whatever this run decides about its own
    // interception (below, once enrolled and gated) re-applies it fresh
    // either way.
    if crate::system_proxy::system_proxy_active().await {
        tracing::warn!("system proxy was already pointed at this agent on startup (likely left behind by a previous instance that didn't exit cleanly) — clearing it before deciding whether to re-apply");
        crate::system_proxy::clear_system_proxy().await;
    }

    // An existing config means this machine has already been through
    // enrollment (this run or a previous one) — start protecting
    // immediately and skip the "waiting for Connect" state entirely.
    if let Some(config) = crate::config::load().await {
        tracing::info!(device_id = %config.device_id, org_id = %config.org_id, "already enrolled");
        // Connected the instant a config is found, not after the first
        // successful server round-trip. A machine that boots offline (WiFi
        // not up yet, VPN still connecting) would otherwise sit on "Not
        // connected" with a Connect button that makes no sense — there is
        // nothing left to connect, the device already has credentials.
        // This is a direct port of the Python original's `main()`, which
        // calls `state.set_connected()` synchronously the moment
        // `ensure_enrolled()` returns a config, before `run_agent` ever
        // touches the network. Caught here — not in unit tests — by
        // actually running the binary under Xvfb against an unreachable
        // admin URL and watching the window stay on "Not connected"
        // indefinitely; `gui.rs` already falls back org_name/employee_name
        // to "Your company"/"This device" while empty, so the only piece
        // missing was this call. `seed_enforcement`, inside
        // `run_full_agent` below, overwrites both names with the real
        // ones on the first successful response — `set_connected` is
        // idempotent about `connected_at`, so calling it twice doesn't
        // reset the uptime clock.
        ui.set_connected("", "");
        run_full_agent(config, ui, client_slot, commands).await;
        return;
    }

    // No saved config yet. A packaged/MDM-pushed install carries its
    // enrollment token via AAVISHIELD_ENROLL_TOKEN or a drop file (see
    // config::find_enroll_token) rather than a person opening the window
    // and clicking Connect — try that silent path once, here, before
    // falling back to waiting on the GUI. Mirrors Python's
    // `ensure_enrolled()` exactly.
    //
    // Closes a real gap found by actually running this binary with
    // AAVISHIELD_ENROLL_TOKEN set on real hardware: `enroll::
    // ensure_enrolled` — which wraps exactly this token/drop-file lookup —
    // existed and was fully implemented, but nothing in the GUI binary's
    // own startup ever called it. A managed install with no person at the
    // keyboard had no way to enroll itself; the window would sit on "Not
    // connected" until someone clicked Connect and went through the
    // interactive browser flow instead.
    if let Some((token, admin_url, portal_url)) = crate::config::find_enroll_token().await {
        let admin_url = admin_url.unwrap_or_else(|| crate::config::DEFAULT_ADMIN_URL.to_string());
        let portal_url = portal_url.unwrap_or_else(|| crate::config::DEFAULT_PORTAL_URL.to_string());
        match crate::enroll::enroll_with_token(&token, &admin_url, &portal_url).await {
            Ok(config) => {
                crate::config::discard_enroll_drops().await;
                tracing::info!(device_id = %config.device_id, org_id = %config.org_id, "enrolled via token");
                ui.set_connected("", "");
                spawn_report_connected(&config);
                spawn_permission_warm_up();
                run_full_agent(config, ui, client_slot, commands).await;
                return;
            }
            Err(crate::enroll::EnrollError::AlreadyEnrolled(msg)) => {
                // Terminal, same as the interactive flow's own handling of
                // this error a few lines below — only an administrator can
                // clear it, so this falls through to the ordinary
                // wait-for-commands loop with the window showing Blocked
                // rather than retrying.
                tracing::warn!(message = %msg, "token enrollment refused — device already registered");
                ui.set_blocked(msg);
            }
            Err(e) => {
                // Transient (network, server error): log and fall through
                // to the normal wait-for-Connect state rather than
                // retrying in a loop with no backoff — matches Python's
                // ensure_enrolled(), which also just logs and returns
                // None on failure, leaving the person to click Connect.
                tracing::warn!(error = %e, "token enrollment failed — falling back to interactive Connect");
            }
        }
    }

    // Not enrolled (or the token path above just failed/was blocked). Sit
    // idle until the GUI's Connect button sends a command — everything up
    // to and including the proxy binding a port waits for that, exactly as
    // it does when a person is watching the Python original's window.
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
                        spawn_report_connected(&config);
                        spawn_permission_warm_up();
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
            Command::Uninstall { respond, .. } => {
                // Mirrors Python's begin_uninstall: nothing enrolled yet
                // means nothing to remove. uninstall_allowed only becomes
                // true once the server has said so on a heartbeat this
                // device never got that far to receive, so the GUI's own
                // gating should make this unreachable in practice — this
                // is the same defensive answer Python gives regardless.
                let _ = respond.send(Err("This device isn't connected, so there's nothing to remove.".to_string()));
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
    let screenshots = crate::screenshot_config::ScreenshotConfig::new();
    let activity_monitor = crate::activity_monitor::ActivityMonitor::new();

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
        screenshots: screenshots.clone(),
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
    // Activity monitoring only ever touches the OS input APIs once the org
    // has screenshots on — start_when_enabled polls for that rather than
    // starting eagerly, so a device that is never monitored never triggers
    // the Input Monitoring permission prompt at all.
    tokio::spawn({
        let activity_monitor = activity_monitor.clone();
        let screenshots = screenshots.clone();
        let gate = gate.clone();
        async move { activity_monitor.start_when_enabled(&screenshots, &gate).await }
    });
    tokio::spawn(
        Arc::new(crate::screenshot::ScreenshotCapturer::new(client.clone(), screenshots.clone(), gate.clone(), activity_monitor.clone())).run(),
    );
    tokio::spawn(crate::update::loop_check(client.clone()));

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
            match cmd {
                Command::Disconnect => {
                    handle_disconnect(&disconnect_client, &disconnect_ui, &disconnect_revoked).await;
                }
                Command::Uninstall { email, password, respond } => {
                    // authorize_and_run resolves as soon as the server has
                    // accepted or rejected the credentials — it spawns the
                    // actual platform uninstaller as its own detached task
                    // rather than waiting on it, the same shape Python's
                    // begin_uninstall has (a background thread that
                    // outlives the `{"ok": True}` response). The GUI
                    // should never sit on "removing…" for as long as the
                    // uninstaller itself takes.
                    let result = crate::uninstall::authorize_and_run(&disconnect_client, &email, &password).await;
                    let _ = respond.send(result);
                }
                // Connect/CancelConnect have nothing to do once already
                // enrolled — the button that would send them isn't shown.
                Command::Connect | Command::CancelConnect => {}
            }
        }
    });

    let addr = SocketAddr::from(([127, 0, 0, 1], crate::config::LOCAL_PORT));
    if let Err(e) = crate::proxy::run(addr, deps).await {
        tracing::error!(error = %e, "proxy listener exited");
    }
}

/// Tells the company this device just (re)connected — a port of Python's
/// `_report_connected`, fired the same way Python fires it: a detached
/// background task right after a successful enrollment, never awaited by
/// the caller. Best-effort and silent on failure, matching
/// `handle_disconnect`'s own reporting call below — a missed report must
/// never be the reason enrollment itself fails.
///
/// Only called from the two places enrollment actually just happened
/// (token-file and interactive), not from the plain "config already on
/// disk" cold-start path in `run()` — that path is an ordinary app
/// restart/reboot, not a new connection, and logging one there would
/// misreport routine restarts as reconnects and spam admins with a
/// "device connected" email on every launch.
///
/// Builds its own throwaway `AgentClient`/`AgentRevoked` rather than
/// reusing whatever `run_full_agent` constructs a moment later: this call
/// races ahead of it (fire-and-forget, not awaited), and the two never
/// need to share revocation state for a single POST.
fn spawn_report_connected(config: &Config) {
    let client = AgentClient::new(config.clone(), AgentRevoked::default());
    tokio::spawn(async move {
        if let Err(e) = client.post_json("/internal/agent/lifecycle/connected", &serde_json::json!({})).await {
            tracing::warn!(error = %e, "could not report the connection");
        }
    });
}

/// Surfaces the macOS Screen Recording permission prompt immediately on
/// enrollment (see `screenshot::warm_up_permissions`'s own doc comment for
/// why), instead of leaving it to whenever the screenshot loop's
/// randomized interval happens to elapse. `spawn_blocking`, not
/// `tokio::spawn`: `xcap`'s capture call is synchronous and can briefly
/// block on the OS compositor — exactly the kind of call that must never
/// run on an async worker thread shared with the proxy/enforcement loops.
fn spawn_permission_warm_up() {
    tokio::task::spawn_blocking(crate::screenshot::warm_up_permissions);
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

    // The window's "Connect" button on a Disconnected state sends
    // Command::Connect — but this task (see its caller) only ever
    // handles Disconnect and Uninstall; Connect is a deliberate no-op
    // here (see that match arm's own comment) because it was written
    // assuming Disconnected is unreachable once enrolled. It isn't: this
    // function is exactly how a device reaches it. Without this exit,
    // clicking "Connect" again in the same process does nothing —
    // enrollment only actually runs from `run()`'s cold-start path,
    // which never re-executes inside a still-running process. So: exit
    // after a short pause (same "let the window paint its confirmation
    // first" grace `uninstall.rs` uses) and let the OS-level supervisor
    // restart the process — the LaunchAgent's KeepAlive (macOS) and the
    // systemd user unit's Restart=always (Linux) both bring it back
    // immediately, and with the config file already removed above,
    // `run()` takes the cold-start path and shows a real, working
    // Connect button that starts actual browser-based re-enrollment.
    // Windows has no such supervisor on a Run-key launch, so there the
    // employee reopens the app from the Start Menu — the same manual
    // step quitting any ordinary Windows tray app already requires.
    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    std::process::exit(0);
}
