//! Platform system-proxy configuration — a port of Python's
//! `system_proxy_active`/`clear_system_proxy`/`apply_system_proxy`.
//!
//! **Verification status**: the Linux path (`gsettings`) is implemented
//! and runs on this build/test host, but this container has no GNOME
//! session, so even the Linux path is only "runs without crashing and
//! fails open" verified here, not "actually changes a real desktop's
//! proxy setting" verified. The macOS (`networksetup`) and Windows
//! (registry) paths are translated faithfully from the Python original's
//! logic but have **not been exercised on real macOS or Windows
//! hardware** — none is available in this build environment. Treat both
//! as "written, not proven" until validated on real devices; see the
//! top-level README.
//!
//! Every path fails open (returns `false`/logs and continues) rather than
//! panicking — a proxy-setting probe or mutation must never be allowed to
//! kill the agent.

use crate::enforcement::Mode;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
#[cfg(unix)]
use tokio::process::Command;

const LOCAL_PORT: u16 = crate::config::LOCAL_PORT;

/// How often the watchdog makes sure the proxy is still set everywhere.
const WATCH_INTERVAL: Duration = Duration::from_secs(10);

/// True while the agent has deliberately taken the proxy down — Disconnect,
/// uninstall, outside working hours, or its own listener dying — and until
/// it deliberately puts it back. The watchdog only ever restores what the
/// agent last chose, never overrides one of those decisions. Starts true:
/// nothing is armed until startup (or a mode change) actually applies it.
static HELD_OFF: AtomicBool = AtomicBool::new(true);

/// Serialises apply/clear with the watchdog, so a watchdog pass that
/// decided "missing, re-apply" can't land just after a clear.
static CHANGE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Whether *any* network service still points at this agent — the
/// question for taking the proxy down.
pub async fn system_proxy_active() -> bool {
    #[cfg(target_os = "macos")]
    {
        for svc in macos_network_services().await {
            if macos_service_points_here(&svc).await.0 {
                return true;
            }
        }
        false
    }
    #[cfg(target_os = "windows")]
    {
        return windows_proxy_enabled().unwrap_or(false);
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        match run(&["gsettings", "get", "org.gnome.system.proxy", "mode"]).await {
            Ok(out) => out.contains("manual"),
            Err(_) => false,
        }
    }
}

/// Whether *every* network service points at this agent, for both HTTP and
/// HTTPS — the question for keeping the proxy up.
///
/// "Any" used to be the only check, in both directions. On macOS the proxy
/// is a per-network-service setting (Wi-Fi, each Ethernet/USB-LAN adapter,
/// iPhone USB, Bluetooth PAN, Thunderbolt Bridge…), and a service that
/// didn't exist at install time — the first time a phone is tethered over
/// USB, a new dock's Ethernet — was never configured. Because Wi-Fi still
/// had the proxy, the agent considered it applied and never looked again,
/// so everything over the new connection went out unfiltered. Switching
/// Wi-Fi networks (office, home, a phone's hotspot) never had this problem:
/// that is one service, whatever network it joins.
///
/// Returns the services that are missing it, empty when fully applied.
pub async fn services_missing_proxy() -> Vec<String> {
    #[cfg(target_os = "macos")]
    {
        let mut missing = Vec::new();
        for svc in macos_network_services().await {
            if macos_service_points_here(&svc).await != (true, true) {
                missing.push(svc);
            }
        }
        missing
    }
    #[cfg(not(target_os = "macos"))]
    {
        if system_proxy_active().await { Vec::new() } else { vec!["system".to_string()] }
    }
}

/// Keeps the proxy where the agent last put it. Runs for the life of the
/// agent; see `services_missing_proxy` for what it catches. Does nothing
/// while the proxy is deliberately down (`HELD_OFF`).
pub async fn watchdog() {
    loop {
        tokio::time::sleep(WATCH_INTERVAL).await;
        let _guard = CHANGE.lock().await;
        if HELD_OFF.load(Ordering::SeqCst) {
            continue;
        }
        let missing = services_missing_proxy().await;
        if missing.is_empty() {
            continue;
        }
        tracing::warn!(?missing, "system proxy missing on a network connection — re-applying");
        apply_locked().await;
    }
}

/// Points the OS back at a direct connection. This is what makes "paused"
/// safe on a personal laptop: leaving the proxy armed while the agent
/// stops serving would break every request on the machine.
pub async fn clear_system_proxy() -> bool {
    let _guard = CHANGE.lock().await;
    HELD_OFF.store(true, Ordering::SeqCst);
    #[cfg(target_os = "macos")]
    {
        let mut ok = false;
        for svc in macos_network_services().await {
            let _ = run(&["networksetup", "-setwebproxystate", &svc, "off"]).await;
            let _ = run(&["networksetup", "-setsecurewebproxystate", &svc, "off"]).await;
            ok = true;
        }
        ok
    }
    #[cfg(target_os = "windows")]
    {
        return windows_set_proxy(false, "").is_ok();
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        run(&["gsettings", "set", "org.gnome.system.proxy", "mode", "none"]).await.is_ok()
    }
}

/// Points the OS at this agent. Returns true if it looks applied.
pub async fn apply_system_proxy() -> bool {
    let _guard = CHANGE.lock().await;
    apply_locked().await
}

async fn apply_locked() -> bool {
    HELD_OFF.store(false, Ordering::SeqCst);
    // Turning protection on from fully off (install, login, working hours
    // starting, a Disconnect ended): browsers open right now hold
    // connections that will never go through the proxy. See
    // app_control::close_running_browsers. Not when only a newly added
    // network connection is being covered — everything else already was.
    let was_off = !system_proxy_active().await;
    let applied = apply_os_proxy().await;
    if applied && was_off {
        tokio::spawn(crate::app_control::close_running_browsers());
    }
    applied
}

async fn apply_os_proxy() -> bool {
    let port = LOCAL_PORT.to_string();
    #[cfg(target_os = "macos")]
    {
        let mut applied = false;
        for svc in macos_network_services().await {
            let _ = run(&["networksetup", "-setwebproxy", &svc, "127.0.0.1", &port]).await;
            let _ = run(&["networksetup", "-setwebproxystate", &svc, "on"]).await;
            let _ = run(&["networksetup", "-setsecurewebproxy", &svc, "127.0.0.1", &port]).await;
            let _ = run(&["networksetup", "-setsecurewebproxystate", &svc, "on"]).await;
            let _ = run(&["networksetup", "-setproxybypassdomains", &svc, "localhost", "127.0.0.1", "*.local", "169.254/16", "fe80::/10"]).await;
            applied = true;
        }
        applied
    }
    #[cfg(target_os = "windows")]
    {
        return windows_set_proxy(true, &format!("127.0.0.1:{port}")).is_ok();
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let pairs: &[(&str, &str, &str)] = &[
            ("org.gnome.system.proxy", "mode", "manual"),
            ("org.gnome.system.proxy.http", "host", "127.0.0.1"),
            ("org.gnome.system.proxy.http", "port", &port),
            ("org.gnome.system.proxy.https", "host", "127.0.0.1"),
            ("org.gnome.system.proxy.https", "port", &port),
        ];
        let mut ok = true;
        for (schema, key, val) in pairs {
            if run(&["gsettings", "set", schema, key, val]).await.is_err() {
                ok = false;
            }
        }
        ok
    }
}

/// Arms or disarms the interception layer when the enforcement mode
/// changes — a port of `apply_enforcement_transition`. The critical part
/// is the proxy: if the agent stops inspecting but the OS still points at
/// 127.0.0.1, every request on the machine fails.
pub async fn apply_enforcement_transition(mode: &Mode) {
    if *mode == Mode::Paused {
        tracing::info!("outside working hours — standing down");
        if system_proxy_active().await {
            clear_system_proxy().await;
        }
        return;
    }
    tracing::info!("enforcement active");
    if !services_missing_proxy().await.is_empty() {
        apply_system_proxy().await;
    }
}

#[cfg(unix)]
async fn run(argv: &[&str]) -> std::io::Result<String> {
    let output = Command::new(argv[0]).args(&argv[1..]).output().await?;
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Every network service, including ones currently disabled (listed with a
/// leading `*`): a disabled adapter the person switches on later is exactly
/// the connection that would otherwise come up without the proxy.
#[cfg(target_os = "macos")]
async fn macos_network_services() -> Vec<String> {
    let out = match run(&["networksetup", "-listallnetworkservices"]).await {
        Ok(o) => o,
        Err(_) => return Vec::new(),
    };
    parse_network_services(&out)
}

#[cfg(any(target_os = "macos", test))]
fn parse_network_services(out: &str) -> Vec<String> {
    out.lines()
        .skip(1) // "An asterisk (*) denotes that a network service is disabled."
        .map(|l| l.trim().trim_start_matches('*').trim().to_string())
        .filter(|l| !l.is_empty())
        .collect()
}

/// (HTTP proxy points here, HTTPS proxy points here) for one service.
#[cfg(target_os = "macos")]
async fn macos_service_points_here(svc: &str) -> (bool, bool) {
    let http = run(&["networksetup", "-getwebproxy", svc]).await.map(|o| points_here(&o)).unwrap_or(false);
    let https = run(&["networksetup", "-getsecurewebproxy", svc]).await.map(|o| points_here(&o)).unwrap_or(false);
    (http, https)
}

/// Parses `networksetup -get[secure]webproxy` output.
#[cfg(any(target_os = "macos", test))]
fn points_here(out: &str) -> bool {
    let field = |name: &str| {
        out.lines().find_map(|l| l.strip_prefix(name).map(|v| v.trim().to_string())).unwrap_or_default()
    };
    field("Enabled:") == "Yes" && field("Server:") == "127.0.0.1" && field("Port:") == LOCAL_PORT.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_disabled_services_are_included() {
        let out = "An asterisk (*) denotes that a network service is disabled.\nWi-Fi\n*iPhone USB\nThunderbolt Bridge\n";
        assert_eq!(parse_network_services(out), vec!["Wi-Fi", "iPhone USB", "Thunderbolt Bridge"]);
    }

    #[test]
    fn test_points_here_needs_enabled_host_and_port() {
        let on = "Enabled: Yes\nServer: 127.0.0.1\nPort: 6118\nAuthenticated Proxy Enabled: 0\n";
        assert!(points_here(on));
        assert!(!points_here(&on.replace("Enabled: Yes", "Enabled: No")));
        assert!(!points_here(&on.replace("127.0.0.1", "10.0.0.5")));
        assert!(!points_here(&on.replace("6118", "61180")));
        assert!(!points_here("Enabled: No\nServer: \nPort: 0\n"));
    }
}

#[cfg(target_os = "windows")]
fn windows_proxy_enabled() -> std::io::Result<bool> {
    use winreg::enums::*;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu.open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings")?;
    let enabled: u32 = key.get_value("ProxyEnable").unwrap_or(0);
    let server: String = key.get_value("ProxyServer").unwrap_or_default();
    Ok(enabled != 0 && server.contains(&LOCAL_PORT.to_string()))
}

#[cfg(target_os = "windows")]
fn windows_set_proxy(enabled: bool, server: &str) -> std::io::Result<()> {
    use winreg::enums::*;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu.create_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings")?;
    if enabled {
        key.set_value("ProxyServer", &server)?;
        key.set_value("ProxyOverride", &"localhost;127.0.0.1;<local>")?;
    }
    key.set_value("ProxyEnable", &(enabled as u32))?;
    crate::win::notify_proxy_changed();
    Ok(())
}
