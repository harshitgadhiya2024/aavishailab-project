//! Heartbeat loop — a port of `send_heartbeat`/`heartbeat_loop`. The
//! working-hours verdict rides the heartbeat response (no extra poll, and
//! it arrives anchored to the server's own clock).
//!
//! Posture is collected fresh on every beat via `posture::collect` — the
//! same signals the Python original's `collect_posture()` computes,
//! serialized to match `postureclient.Signals` on the server exactly.
//! Collection shells out to real OS tools, so it runs on a blocking
//! thread (`spawn_blocking`) rather than inline in this async fn; a stuck
//! probe must never be why the working-hours verdict — carried by this
//! same request — arrives late.

use crate::deps::Deps;
use crate::enforcement::EnforcementPayload;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;

#[derive(Serialize)]
struct HeartbeatRequest {
    status: &'static str,
    proxy_port: u16,
    os_type: &'static str,
    os_version: String,
    agent_version: &'static str,
    posture: crate::posture::Signals,
    /// Which OS permissions the agent actually holds right now, so the
    /// company can see per device which features are live and which are
    /// stuck waiting on a grant. Sent every beat, not once at enrollment:
    /// a permission can be revoked in System Settings at any time, and the
    /// dashboard should reflect that within a minute rather than showing a
    /// capability the device lost hours ago. Checked live and cheaply —
    /// each field is one OS predicate call (see the two `*_permitted`
    /// helpers), no prompt.
    capabilities: Capabilities,
}

#[derive(Serialize)]
struct Capabilities {
    /// Screenshots require this on macOS; always true where the OS has no
    /// such gate (Windows, and Linux under X11).
    screen_recording: bool,
    /// Keyboard counting requires this on macOS; mouse and scroll survive
    /// without it, so a false here means activity reads low, not zero.
    input_monitoring: bool,
}

impl Capabilities {
    fn collect() -> Self {
        Capabilities {
            screen_recording: crate::screenshot::screen_capture_permitted(),
            input_monitoring: crate::activity_monitor::input_monitoring_permitted(),
        }
    }
}

#[derive(Deserialize)]
struct HeartbeatResponse {
    #[serde(default)]
    enforcement: Option<EnforcementPayload>,
    #[serde(default)]
    server_time: Option<String>,
    /// "company" | "personal" — rides every heartbeat, not just the initial
    /// config fetch, because it is the one piece of device state an admin
    /// changes *while the connector is already running*. The desktop
    /// window's Disconnect button reads this every frame (see ui_state.rs),
    /// so reclassifying a device here takes effect within a minute instead
    /// of needing a restart.
    #[serde(default)]
    ownership: Option<String>,
    #[serde(default)]
    screenshots: Option<ScreenshotPayload>,
}

/// Field names match `screenshotConfigFor` on the server exactly.
#[derive(Deserialize)]
struct ScreenshotPayload {
    enabled: bool,
    #[serde(default)]
    min_interval_seconds: u64,
    #[serde(default)]
    max_interval_seconds: u64,
    #[serde(default)]
    blur: bool,
}

pub async fn send(deps: &Deps) {
    // Real subprocess calls (fdesetup, ufw, netsh, …) — collected off the
    // async runtime for the same reason inventory.rs collects there.
    let posture = tokio::task::spawn_blocking(crate::posture::collect).await.unwrap_or_default();
    let payload = HeartbeatRequest {
        status: "online",
        proxy_port: crate::config::LOCAL_PORT,
        os_type: os_type_str(),
        os_version: posture.os_version.clone(),
        agent_version: crate::config::AGENT_VERSION,
        posture,
        capabilities: Capabilities::collect(),
    };

    let resp = match deps.client.post_json("/internal/agent/heartbeat", &payload).await {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(error = %e, "heartbeat failed");
            return;
        }
    };
    let body: HeartbeatResponse = match resp.json().await {
        Ok(b) => b,
        Err(e) => {
            tracing::warn!(error = %e, "heartbeat response unparseable");
            return;
        }
    };
    tracing::debug!("heartbeat sent");

    if let Some(ownership) = &body.ownership {
        deps.ui.set_ownership(ownership);
    }

    if let Some(sc) = &body.screenshots {
        deps.screenshots.apply(sc.enabled, sc.min_interval_seconds, sc.max_interval_seconds, sc.blur);
    }

    if let Some(enforcement) = &body.enforcement {
        let changed = deps.gate.apply(enforcement, body.server_time.as_deref());
        deps.ui.apply_mode(deps.gate.mode().as_str(), &deps.gate.reason());
        if let Some(mode) = changed {
            tracing::info!(mode = mode.as_str(), reason = %deps.gate.reason(), "enforcement mode changed");
            crate::system_proxy::apply_enforcement_transition(&mode).await;
        }
    }
}

/// One-shot fetch of the working-hours verdict at startup. Fails open to
/// "enforcing": if the server can't be reached we cannot know a schedule
/// exists, and the safe default is the same as for a company laptop —
/// enforce. The first successful heartbeat corrects it within a minute.
pub async fn seed_enforcement(deps: &Deps) {
    let resp = match deps.client.get("/internal/agent/config").await {
        Ok(r) => r,
        Err(e) => {
            tracing::debug!(error = %e, "could not read enforcement state at startup");
            return;
        }
    };
    #[derive(Deserialize)]
    struct ConfigResponse {
        #[serde(default)]
        enforcement: Option<EnforcementPayload>,
        #[serde(default)]
        org_name: String,
        #[serde(default)]
        employee_name: String,
        #[serde(default)]
        ownership: Option<String>,
        #[serde(default)]
        screenshots: Option<ScreenshotPayload>,
        #[serde(default)]
        uninstall_allowed: bool,
    }
    if let Ok(body) = resp.json::<ConfigResponse>().await {
        if let Some(enforcement) = &body.enforcement {
            deps.gate.apply(enforcement, None);
        }
        if let Some(ownership) = &body.ownership {
            deps.ui.set_ownership(ownership);
        }
        if let Some(sc) = &body.screenshots {
            deps.screenshots.apply(sc.enabled, sc.min_interval_seconds, sc.max_interval_seconds, sc.blur);
        }
        // Only the company can enable removal, so the desktop UI has to
        // learn it from the server rather than assume — the entry stays
        // hidden (UiState's own default is `false`) until this arrives.
        // Matches the Python original's `seed_enforcement` reading this
        // same field from the same endpoint — see `uninstallAllowed()`'s
        // doc comment on the server for why it is unconditionally true
        // today. This was defined end-to-end (server field, `UiState::
        // set_uninstall_allowed`, the GUI's own gate on it) but never
        // actually connected here — the entry point could never have
        // appeared until this line existed.
        deps.ui.set_uninstall_allowed(body.uninstall_allowed);
        // Connected the moment the very first server round-trip succeeds —
        // the window shouldn't sit on "Connecting" a beat longer than it has
        // to just because these two names arrived a fraction later.
        deps.ui.set_connected(body.org_name, body.employee_name);
        deps.ui.apply_mode(deps.gate.mode().as_str(), &deps.gate.reason());
    }
}

pub async fn loop_heartbeat(deps: Arc<Deps>, interval: Duration) {
    let mut ticker = tokio::time::interval(interval);
    loop {
        ticker.tick().await;
        send(&deps).await;
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
