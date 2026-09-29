use dlp_service::{ai, build_router, config::Config, extract, AppState, Metrics};
use std::sync::Arc;

#[tokio::main]
async fn main() {
    // The final image is debian-slim with no curl/wget (kept minimal), so
    // HEALTHCHECK shells out to this binary itself instead — same pattern
    // the distroless Go services use (`os.Args[1] == "healthcheck"`).
    if std::env::args().nth(1).as_deref() == Some("--healthcheck") {
        return healthcheck().await;
    }

    dlp_service::tracing_init::init("dlp-service");

    let config = Config::from_env();
    if config.require_auth && config.using_default_secret() {
        eprintln!(
            "WARNING: DLP_SERVICE_SECRET is the built-in default — set a strong \
             shared secret in production or the service token can be forged."
        );
    }

    let ai = ai::AiConfig::from_env().map(|c| Arc::new(ai::Ai::new(c)));
    if ai.is_none() {
        eprintln!("NOTE: no LLM provider key set — the AI tier (ai_text/ai_visual/ai_audio) is off.");
    }
    if !extract::pdf::available() {
        eprintln!("WARNING: pdfium library not found — PDFs will be reported unscannable.");
    }
    let state = Arc::new(AppState { config, metrics: Metrics::default(), limits: extract::Limits::from_env(), ai });
    let app = build_router(state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:6200").await.unwrap();
    println!("dlp-service listening on 0.0.0.0:6200");
    axum::serve(listener, app).with_graceful_shutdown(shutdown_signal()).await.unwrap();
}

/// Without this, `docker compose stop`/a rolling redeploy sends SIGTERM,
/// axum::serve ignores it, and Docker SIGKILLs the process after its
/// default 10s grace period — killing any request still in flight (a scan
/// mid-window) rather than letting it finish. Waits for either signal so
/// this also behaves under a plain `cargo run` + Ctrl-C locally.
async fn shutdown_signal() {
    let ctrl_c = async { tokio::signal::ctrl_c().await.expect("failed to install Ctrl+C handler") };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).expect("failed to install SIGTERM handler").recv().await;
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {}
        _ = terminate => {}
    }
    println!("shutdown signal received, draining in-flight requests");
}

/// A raw-socket GET /healthz — deliberately not pulling in a full HTTP
/// client (reqwest) just for a container HEALTHCHECK probe.
async fn healthcheck() {
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::time::Duration;

    let ok = (|| -> std::io::Result<bool> {
        let mut stream = TcpStream::connect("127.0.0.1:6200")?;
        stream.set_read_timeout(Some(Duration::from_secs(2)))?;
        stream.write_all(b"GET /healthz HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")?;
        let mut buf = [0u8; 32];
        let n = stream.read(&mut buf)?;
        Ok(buf[..n].starts_with(b"HTTP/1.1 200"))
    })()
    .unwrap_or(false);

    std::process::exit(if ok { 0 } else { 1 });
}
