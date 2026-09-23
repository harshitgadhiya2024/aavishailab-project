//! Removes the connector — a port of Python's `begin_uninstall` +
//! `_uninstall_darwin`.
//!
//! Removal is a company decision, not the employee's: the server verifies
//! a company administrator's credentials before anything is deleted (see
//! `AuthorizeUninstall` in admin-api), and this module's job is entirely
//! downstream of that — ask the server, then, only on success, remove the
//! connector from this machine.

use crate::http_client::AgentClient;
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
struct AuthorizeRequest<'a> {
    email: &'a str,
    password: &'a str,
}

#[derive(Deserialize, Default)]
struct ErrorBody {
    #[serde(default)]
    error: String,
}

/// Verifies the administrator's credentials with the server, and — only on
/// success — kicks off the platform uninstaller as its own detached task
/// (matching Python's background thread: this returns as soon as
/// authorization is settled, not after removal finishes).
pub async fn authorize_and_run(client: &AgentClient, email: &str, password: &str) -> Result<(), String> {
    let body = AuthorizeRequest { email, password };
    let resp = match client.post_json("/internal/agent/lifecycle/authorize-uninstall", &body).await {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(error = %e, "uninstall authorization failed");
            return Err("Could not reach the server to check those credentials.".to_string());
        }
    };

    let status = resp.status();
    if status.is_success() {
        let portal_url = client.config().portal_url.clone();
        // "Let the window paint its confirmation first" — same one-second
        // grace Python's `_run_uninstaller` gives, so the person sees the
        // success state land before their screen starts changing under
        // them (a system-proxy reset, an admin prompt on macOS, a new
        // browser tab on Windows/Linux).
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            let _ = crate::system_proxy::clear_system_proxy().await;
            run_platform_uninstaller(&portal_url);
        });
        return Ok(());
    }

    if status.as_u16() == 429 {
        return Err("Too many attempts. Wait a minute and try again.".to_string());
    }

    let detail: ErrorBody = resp.json().await.unwrap_or_default();
    Err(if detail.error.is_empty() { "Those administrator credentials were not accepted.".to_string() } else { detail.error })
}

/// Runs the OS-appropriate removal. Best-effort throughout, matching the
/// Python original: a failed removal step is logged, never panics, and
/// never blocks anything else in the process (there is nothing else left
/// running by the time this is worth calling anyway — enforcement already
/// stopped mattering the moment a company administrator approved removal).
///
/// Two platform-gated definitions, not one function with a `#[cfg]`
/// branch inside it: macOS needs nothing from `portal_url` and Windows/
/// Linux need nothing else, and a single shared signature would leave
/// whichever half is compiled out with an unused-parameter warning on the
/// other platform.
#[cfg(target_os = "macos")]
fn run_platform_uninstaller(_portal_url: &str) {
    uninstall_macos();
}

/// Windows/Linux removal is the OS package manager's job (MSI/dpkg
/// already know how to remove what they installed); the portal serves a
/// script/uninstaller for the rare manual-install case.
#[cfg(not(target_os = "macos"))]
fn run_platform_uninstaller(portal_url: &str) {
    crate::enroll_interactive::open_in_browser(&format!("{}/dashboard/download", portal_url.trim_end_matches('/')));
}

/// Removes the connector from this Mac.
///
/// Needs root (LaunchAgent/LaunchDaemon plists, /Applications, the trusted
/// CA), so it goes through the same osascript admin prompt CA installation
/// uses. Authorization to *do* this was already granted by a company
/// administrator server-side (see `authorize_and_run`); this prompt is
/// macOS's own requirement for touching those locations, not a second
/// approval — the same distinction the Python original's own comment
/// draws.
///
/// The exact paths mirror the Python original's packaging layout
/// (`/Applications/Aavishield.app`, the LaunchAgent/LaunchDaemon plists,
/// `/etc/aavishield`) so this is ready the moment Rust packaging lands —
/// today there is nothing at those paths yet, since the Rust connector
/// has no packaging of its own (see REQUIREMENT_AUDIT_AND_PLAN.md, Phase
/// 4), so every step below is a correctly-targeted no-op on this build
/// until then.
#[cfg(target_os = "macos")]
fn uninstall_macos() {
    const CA_COMMON_NAME: &str = "Aavishield Root CA";
    let steps = [
        "/bin/launchctl bootout system /Library/LaunchDaemons/com.aavishield.catrust.plist 2>/dev/null",
        &format!("/bin/launchctl bootout gui/{}/com.aavishield.agent 2>/dev/null", unsafe { libc::getuid() }),
        "/bin/rm -f /Library/LaunchDaemons/com.aavishield.catrust.plist /Library/LaunchAgents/com.aavishield.agent.plist",
        "/bin/rm -rf /Applications/Aavishield.app /etc/aavishield /usr/local/aavishield",
        "/usr/sbin/pkgutil --forget com.aavishield.agent 2>/dev/null",
        &format!(
            "/usr/bin/security delete-certificate -c {} /Library/Keychains/System.keychain 2>/dev/null",
            shell_quote(CA_COMMON_NAME)
        ),
        "true", // keeps the whole chain's exit status 0 so osascript doesn't error
    ]
    .join(" ; ");

    let escaped = steps.replace('\\', "\\\\").replace('"', "\\\"");
    let script = format!(
        "do shell script \"{escaped}\" with administrator privileges with prompt \"Aavishield needs your permission to remove the connector.\""
    );

    let result = std::process::Command::new("/usr/bin/osascript")
        .arg("-e")
        .arg(&script)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
    if let Err(e) = result {
        tracing::warn!(error = %e, "uninstall command failed");
    }
}

/// Single-quotes a value for embedding in the shell string above — the CA
/// common name is a fixed constant here, not user input, but quoting it
/// properly costs nothing and matches the Python original's `shlex.quote`.
#[cfg(target_os = "macos")]
fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "macos")]
    #[test]
    fn test_shell_quote_wraps_in_single_quotes() {
        assert_eq!(shell_quote("Aavishield Root CA"), "'Aavishield Root CA'");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_shell_quote_escapes_embedded_single_quotes() {
        assert_eq!(shell_quote("O'Brien"), r"'O'\''Brien'");
    }

    #[test]
    fn test_error_body_defaults_to_empty_on_missing_field() {
        let parsed: ErrorBody = serde_json::from_str("{}").unwrap();
        assert_eq!(parsed.error, "");
    }
}
