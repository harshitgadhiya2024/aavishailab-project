//! Entry point — wires config/enrollment, the caches, the enforcement
//! gate, the activity reporter, the MITM engine, the heartbeat loop, and
//! the local proxy together. A port of Python's `main()`, minus the tray
//! UI and the pieces documented as out of scope in the README (screenshot
//! capture, keystroke/mouse monitoring, the interactive browser-callback
//! enrollment flow).

use aavishield_agent::activity::ActivityReporter;
use aavishield_agent::casb_cache::CASBControlCache;
use aavishield_agent::deps::Deps;
use aavishield_agent::enforcement::EnforcementGate;
use aavishield_agent::http_client::{AgentClient, AgentRevoked};
use aavishield_agent::mitm::MitmEngine;
use aavishield_agent::policy_cache::PolicyCache;
use aavishield_agent::threat_cache::ThreatIntelCache;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

const RULES_REFRESH_INTERVAL: Duration = Duration::from_secs(10);
const ACTIVITY_FLUSH_INTERVAL: Duration = Duration::from_secs(5);
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(60);
const MITM_CONFIG_REFRESH_INTERVAL: Duration = Duration::from_secs(300);

#[tokio::main]
async fn main() {
    // rustls 0.23 no longer auto-selects a crypto backend when more than
    // one is reachable in the dependency graph (reqwest's rustls-tls
    // feature and this crate's own tokio-rustls usage can each pull one
    // in) — install one explicitly, once, before any TLS connection is
    // attempted. Caught live: this panicked inside the first MITM'd
    // connection's spawned task instead of at startup, which is exactly
    // the kind of "only shows up under real traffic" bug this whole
    // rewrite exists to catch before it ships.
    let _ = rustls::crypto::CryptoProvider::install_default(rustls::crypto::aws_lc_rs::default_provider());

    tracing_subscriber::fmt().with_env_filter(tracing_subscriber::EnvFilter::from_default_env().add_directive("aavishield_agent=info".parse().unwrap())).init();

    tracing::info!(version = aavishield_agent::config::AGENT_VERSION, "aavishield-agent starting");

    let config = match aavishield_agent::enroll::ensure_enrolled().await {
        Some(c) => c,
        None => {
            tracing::error!("no enrollment token found and no existing config — see README for enrollment options. Exiting.");
            std::process::exit(1);
        }
    };
    tracing::info!(device_id = %config.device_id, org_id = %config.org_id, "enrolled");

    let revoked = AgentRevoked::default();
    let client = AgentClient::new(config, revoked.clone());

    let gate = Arc::new(EnforcementGate::default());
    let policy = Arc::new(PolicyCache::new(client.clone()));
    let threats = Arc::new(ThreatIntelCache::new(client.clone()));
    let casb = Arc::new(CASBControlCache::new(client.clone()));
    let reporter = Arc::new(ActivityReporter::new(client.clone(), gate.clone()));

    let mitm_client = client.clone();
    let mitm = Arc::new(MitmEngine::new(mitm_client, Arc::new(aavishield_agent::config::mitm_ca_trusted)));

    let deps = Arc::new(Deps { client: client.clone(), policy: policy.clone(), threats: threats.clone(), casb: casb.clone(), mitm: mitm.clone(), reporter: reporter.clone(), gate: gate.clone() });

    // Seed the working-hours verdict before doing anything else — fails
    // open to "enforcing" (see heartbeat::seed_enforcement's doc comment).
    aavishield_agent::heartbeat::seed_enforcement(&deps).await;

    // Initial synchronous loads so the proxy doesn't start with an empty
    // policy cache and zero SSL Inspection config on its very first
    // requests.
    policy.refresh().await;
    mitm.refresh().await;

    // Background refresh loops.
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
    tokio::spawn(reporter.clone().loop_flush(ACTIVITY_FLUSH_INTERVAL));
    tokio::spawn(aavishield_agent::heartbeat::loop_heartbeat(deps.clone(), HEARTBEAT_INTERVAL));

    // Arm the system proxy if enforcement starts in an intercepting mode.
    if gate.intercepts() {
        aavishield_agent::system_proxy::apply_system_proxy().await;
    }

    let addr = SocketAddr::from(([127, 0, 0, 1], aavishield_agent::config::LOCAL_PORT));
    if let Err(e) = aavishield_agent::proxy::run(addr, deps).await {
        tracing::error!(error = %e, "proxy listener exited");
        std::process::exit(1);
    }
}
