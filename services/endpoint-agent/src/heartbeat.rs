//! Heartbeat loop — a port of `send_heartbeat`/`heartbeat_loop`. The
//! working-hours verdict rides the heartbeat response (no extra poll, and
//! it arrives anchored to the server's own clock).
//!
//! Posture collection (disk encryption / firewall / OS-update / screen-
//! lock / antivirus probes) is out of scope for this port — see the
//! README. This still reports `status`/`proxy_port`/`agent_version` and,
//! critically, still applies the returned `enforcement` block, which is
//! the security-relevant half of the heartbeat.

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
    agent_version: &'static str,
}

#[derive(Deserialize)]
struct HeartbeatResponse {
    #[serde(default)]
    enforcement: Option<EnforcementPayload>,
    #[serde(default)]
    server_time: Option<String>,
}

pub async fn send(deps: &Deps) {
    let payload = HeartbeatRequest { status: "online", proxy_port: crate::config::LOCAL_PORT, os_type: os_type_str(), agent_version: crate::config::AGENT_VERSION };

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

    if let Some(enforcement) = &body.enforcement {
        let changed = deps.gate.apply(enforcement, body.server_time.as_deref());
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
    }
    if let Ok(body) = resp.json::<ConfigResponse>().await {
        if let Some(enforcement) = &body.enforcement {
            deps.gate.apply(enforcement, None);
        }
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
