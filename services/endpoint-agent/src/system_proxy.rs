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
#[cfg(unix)]
use tokio::process::Command;

const LOCAL_PORT: u16 = crate::config::LOCAL_PORT;

pub async fn system_proxy_active() -> bool {
    #[cfg(target_os = "macos")]
    {
        for svc in macos_network_services().await {
            if let Ok(out) = run(&["networksetup", "-getwebproxy", &svc]).await {
                if out.contains("Enabled: Yes") && out.contains(&LOCAL_PORT.to_string()) {
                    return true;
                }
            }
        }
        return false;
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

/// Points the OS back at a direct connection. This is what makes "paused"
/// safe on a personal laptop: leaving the proxy armed while the agent
/// stops serving would break every request on the machine.
pub async fn clear_system_proxy() -> bool {
    #[cfg(target_os = "macos")]
    {
        let mut ok = false;
        for svc in macos_network_services().await {
            let _ = run(&["networksetup", "-setwebproxystate", &svc, "off"]).await;
            let _ = run(&["networksetup", "-setsecurewebproxystate", &svc, "off"]).await;
            ok = true;
        }
        return ok;
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
        return applied;
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
    if !system_proxy_active().await {
        apply_system_proxy().await;
    }
}

#[cfg(unix)]
async fn run(argv: &[&str]) -> std::io::Result<String> {
    let output = Command::new(argv[0]).args(&argv[1..]).output().await?;
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[cfg(target_os = "macos")]
async fn macos_network_services() -> Vec<String> {
    let out = match run(&["networksetup", "-listallnetworkservices"]).await {
        Ok(o) => o,
        Err(_) => return Vec::new(),
    };
    out.lines().skip(1).filter(|l| !l.starts_with('*')).map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect()
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
    Ok(())
}
