use dlp_service::{build_router, config::Config, AppState, Metrics};
use std::sync::Arc;

#[tokio::main]
async fn main() {
    // The final image is debian-slim with no curl/wget (kept minimal), so
    // HEALTHCHECK shells out to this binary itself instead — same pattern
    // the distroless Go services use (`os.Args[1] == "healthcheck"`).
    if std::env::args().nth(1).as_deref() == Some("--healthcheck") {
        return healthcheck().await;
    }

    let config = Config::from_env();
    if config.require_auth && config.using_default_secret() {
        eprintln!(
            "WARNING: DLP_SERVICE_SECRET is the built-in default — set a strong \
             shared secret in production or the service token can be forged."
        );
    }

    let state = Arc::new(AppState { config, metrics: Metrics::default() });
    let app = build_router(state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:6200").await.unwrap();
    println!("dlp-service listening on 0.0.0.0:6200");
    axum::serve(listener, app).await.unwrap();
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
