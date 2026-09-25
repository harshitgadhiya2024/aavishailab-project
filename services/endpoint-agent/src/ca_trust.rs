//! Installs this org's MITM root CA into the OS trust store — the one
//! piece of the SSL-inspection story `config::mitm_ca_trusted`'s own doc
//! comment marked out of scope, and the reason HTTPS blocks never showed
//! the branded page: `mitm.rs`'s `MitmEngine` already gates interception
//! on `mitm_ca_trusted()` — `state.enabled = body.enabled &&
//! (self.ca_trusted)()` — and `/internal/agent/ca-cert` already exists
//! server-side to hand out the certificate. Nothing was missing from the
//! interception path itself; nothing had ever fetched the certificate and
//! flipped that marker.
//!
//! macOS only for now. Linux (`update-ca-certificates`/`trust anchor`) and
//! Windows (`certutil -addstore`) need their own privilege-escalation
//! story and are follow-up work, not part of this pass.

use crate::http_client::AgentClient;
use serde::Deserialize;

/// Just the one field this module needs from `/internal/agent/mitm-config`
/// — a small, deliberate duplication of `mitm.rs`'s own (private) response
/// shape rather than making that struct or its field `pub` just to share
/// it. This module only ever asks "does the org's policy want inspection
/// at all", never the bypass list `mitm.rs` itself owns and refreshes on
/// its own loop.
#[derive(Deserialize, Default)]
struct MitmConfigResponse {
    #[serde(default)]
    enabled: bool,
}

/// Fetches the org's CA and installs it into the current user's own login
/// keychain trust settings, then writes the marker `mitm_ca_trusted()`
/// checks for.
///
/// The login keychain, not the System one, and deliberately so — this was
/// the second design here, not the first. The first tried
/// `security add-trusted-cert -d` into `/Library/Keychains/System.keychain`
/// via `osascript ... with administrator privileges`, the same elevation
/// `uninstall.rs` already uses for removing this exact certificate. It
/// failed every time, from a real LaunchAgent, with `SecTrustSettingsSet
/// TrustSettings: The authorization was denied since no user interaction
/// was possible` — confirmed (not guessed) live: `LimitLoadToSessionType:
/// Aqua` on the job didn't change it, and neither did making the app's own
/// window frontmost and on-screen first. macOS does not consider a hidden,
/// `LSUIElement` background agent — which is what this is, by design —
/// eligible to own a modal admin-authorization sheet, no matter which
/// session it's attached to.
///
/// The login keychain needs no such escalation, because it doesn't need
/// root: it's a trust decision the logged-in user is already allowed to
/// make about their own keychain, evaluated the same as any other user
/// or admin trust-settings domain macOS walks when a browser or curl
/// checks a certificate chain — Safari, Chrome and this agent's own
/// terminated connections all honour it. That's the whole requirement:
/// this proxy only ever needs *this user's* traffic trusted, never the
/// whole machine's every account. Confirmed on the same box: the same
/// `security add-trusted-cert` command against the login keychain (no
/// `-d`, no osascript) surfaced a real, answerable confirmation dialog —
/// "authorization was canceled" rather than "no interaction was possible"
/// — proving the dialog is genuinely reachable here.
///
/// Idempotent and safe to call on every start: it checks the marker first,
/// so a device that already trusts the CA never sees the prompt again.
/// Only runs when the org's policy has SSL inspection turned on at all
/// (checked via `/internal/agent/mitm-config`, the same source mitm.rs's
/// own refresh loop reads) — a device whose org never asked for HTTPS
/// inspection is never shown this dialog.
#[cfg(target_os = "macos")]
pub async fn install_if_needed(client: &AgentClient) {
    if crate::config::mitm_ca_trusted() {
        return;
    }

    match client.get("/internal/agent/mitm-config").await {
        Ok(resp) if resp.status().is_success() => match resp.json::<MitmConfigResponse>().await {
            Ok(cfg) if cfg.enabled => {}
            Ok(_) => return, // org's policy doesn't want SSL inspection — never prompt for it
            Err(e) => {
                tracing::debug!(error = %e, "could not parse MITM config — skipping CA install for now");
                return;
            }
        },
        Ok(resp) => {
            tracing::debug!(status = %resp.status(), "could not fetch MITM config — skipping CA install for now");
            return;
        }
        Err(e) => {
            tracing::debug!(error = %e, "could not reach admin-api for MITM config — skipping CA install for now");
            return;
        }
    }

    let cert_pem = match client.get("/internal/agent/ca-cert").await {
        Ok(resp) if resp.status().is_success() => match resp.text().await {
            Ok(pem) => pem,
            Err(e) => {
                tracing::warn!(error = %e, "could not read the CA certificate response");
                return;
            }
        },
        Ok(resp) => {
            tracing::debug!(status = %resp.status(), "CA certificate not available yet");
            return;
        }
        Err(e) => {
            tracing::debug!(error = %e, "could not fetch the CA certificate");
            return;
        }
    };
    if cert_pem.is_empty() {
        return;
    }

    // Kept in state_dir, not a throwaway temp file: `security` needs a
    // real path to read from inside the elevated shell script below, and
    // leaving it here (world-readable, like the marker) means a support
    // engineer can verify which certificate got installed without asking
    // the agent to fetch it again.
    let cert_path = crate::config::state_dir().join("ca.pem");
    if let Some(dir) = cert_path.parent() {
        if let Err(e) = tokio::fs::create_dir_all(dir).await {
            tracing::warn!(error = %e, "could not create the state directory for the CA certificate");
            return;
        }
    }
    if let Err(e) = tokio::fs::write(&cert_path, &cert_pem).await {
        tracing::warn!(error = %e, "could not write the CA certificate to disk");
        return;
    }

    let cert_path_str = cert_path.to_string_lossy().into_owned();
    let result = tokio::task::spawn_blocking(move || install_into_login_keychain(&cert_path_str)).await;

    let installed = matches!(result, Ok(Ok(())));
    match &result {
        Ok(Ok(())) => tracing::info!("MITM root CA installed and trusted — HTTPS inspection is now active"),
        Ok(Err(e)) => tracing::warn!(error = %e, "could not install the MITM root CA — HTTPS traffic stays in blind-tunnel mode"),
        Err(e) => tracing::warn!(error = %e, "CA installation task panicked"),
    }

    if installed {
        let marker = crate::config::state_dir().join("ca-trusted");
        if let Err(e) = tokio::fs::write(&marker, b"").await {
            tracing::warn!(error = %e, "CA is trusted but the marker file could not be written — will retry the (harmless, already-trusted) install next cycle");
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub async fn install_if_needed(_client: &AgentClient) {
    // Linux/Windows: see this module's doc comment. mitm_ca_trusted()
    // stays false forever on these platforms until they get their own
    // implementation, and everything downstream already treats that as
    // "stay in blind-tunnel mode" — the same fail-open this had before
    // this file existed at all.
}

/// Adds the certificate as a trusted root to the current user's login
/// keychain — no elevation, no `osascript`, just `security` run directly.
/// macOS still surfaces its own confirmation dialog for changing trust
/// settings (this is a real, user-visible security decision — installing
/// a root CA — and macOS is right to always ask), but it's the keychain's
/// own access-control prompt, not `AuthorizationExecuteWithPrivileges`,
/// and it does not require this process to be an elevated, foreground, or
/// even visible one to reach the person.
///
/// `-r trustRoot` is what makes this a CA trust anchor rather than a
/// single leaf certificate — carried over from the System-keychain
/// attempt this replaced, which itself carried it over from Python's
/// original `_install_ca_darwin`. No `-d`: that flag targets the System
/// (not per-keychain) trust store specifically, which is the one thing
/// this version deliberately does not do.
#[cfg(target_os = "macos")]
fn install_into_login_keychain(cert_path: &str) -> Result<(), String> {
    let keychain = std::env::var("HOME").unwrap_or_default() + "/Library/Keychains/login.keychain-db";
    let output = std::process::Command::new("/usr/bin/security")
        .args(["add-trusted-cert", "-r", "trustRoot", "-k", &keychain, cert_path])
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(())
    } else {
        // User-cancelled looks identical to a real failure here; both
        // leave the marker absent and MITM off, which is the correct,
        // safe outcome either way — nothing to distinguish for a retry
        // that will just ask again next cycle.
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}
