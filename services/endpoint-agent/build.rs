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
}
