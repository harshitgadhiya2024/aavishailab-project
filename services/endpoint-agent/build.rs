//! Stamps the release version into the binary at compile time.
//!
//! `config::AGENT_VERSION` used to be a hardcoded `"1.0.0-rust"` constant —
//! harmless for local `cargo build`/`cargo test`, but a real bug the moment
//! this binary ships: every packaging script passes a real version (e.g.
//! "2.6.0") to the *manifest* update.rs polls against, but the running
//! binary would still report "1.0.0-rust" forever. Since "2.6.0" > "1.0.0"
//! by update.rs's own version_gt, the auto-updater would conclude an update
//! is always available, download the exact binary it's already running,
//! and restart — every `update::CHECK_INTERVAL` (6 hours), forever, on
//! every device. Caught by tracing through what an actual publish would do
//! before doing it, not after devices started looping.
//!
//! Mirrors exactly what the Python build scripts already do by regex-
//! stamping `AGENT_VERSION` into a scratch copy of the source before
//! freezing it (see packaging/*/build.sh's "Freeze the agent" step) — same
//! outcome, idiomatic-for-Rust mechanism: an env var read at compile time
//! instead of a source rewrite.

fn main() {
    let version = std::env::var("AAVISHIELD_VERSION").unwrap_or_else(|_| "1.0.0-dev".to_string());
    println!("cargo:rustc-env=AAVISHIELD_VERSION={version}");
    // Only re-run this build script if the env var actually changes value
    // between builds — without this, cargo reruns it (and everything that
    // depends on the resulting env! value) on every build regardless,
    // since env var changes aren't tracked by file mtime the way source
    // changes are.
    println!("cargo:rerun-if-env-changed=AAVISHIELD_VERSION");

    #[cfg(windows)]
    windows_resources(&version);
}

/// Embeds the Aavishield icon (packaging/icons/aavishield.ico, generated
/// from the brand favicon by packaging/make-icons.py) and the product
/// details into the .exe. Only compiled on a Windows build host; only run
/// when actually targeting Windows.
#[cfg(windows)]
fn windows_resources(version: &str) {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }
    let icon = "../../packaging/icons/aavishield.ico";
    println!("cargo:rerun-if-changed={icon}");

    // "2.9.0" -> 0x0002_0009_0000_0000, the packed form FILEVERSION wants.
    let mut parts = version.split(|c: char| !c.is_ascii_digit()).filter(|p| !p.is_empty()).map(|p| p.parse::<u64>().unwrap_or(0));
    let packed = (0..4).fold(0u64, |acc, _| (acc << 16) | (parts.next().unwrap_or(0) & 0xFFFF));

    let mut res = winresource::WindowsResource::new();
    res.set_icon(icon)
        .set("ProductName", "Aavishield")
        .set("FileDescription", "Aavishield Agent")
        .set("CompanyName", "Aavishield")
        .set("LegalCopyright", "© Aavish AI Lab")
        .set("ProductVersion", version)
        .set("FileVersion", version)
        .set("OriginalFilename", "aavishield-agent.exe")
        .set_version_info(winresource::VersionInfo::FILEVERSION, packed)
        .set_version_info(winresource::VersionInfo::PRODUCTVERSION, packed);
    if let Err(e) = res.compile() {
        // A missing resource compiler must not break the build; the exe
        // just falls back to the default icon. Loud, so CI logs show it.
        println!("cargo:warning=could not embed Windows icon/version resources: {e}");
    }
}
