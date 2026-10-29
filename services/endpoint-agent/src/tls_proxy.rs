//! TLS termination + re-encryption for a single MITM'd CONNECT tunnel — a
//! port of Python's `_handle_mitm_tls`/`_serve_over_tls`/`_serve_https_block_page`.
//!
//! Once the client-side handshake is attempted, this connection is
//! committed: those bytes can't be un-consumed to fall back to a blind
//! relay if something goes wrong. The two ways this can still legitimately
//! fail — the org's CA not yet trusted on this device, and certificate
//! pinning — both just fail this one connection; nothing else is affected.
//!
//! Both legs (client-facing server TLS, upstream-facing client TLS) force
//! ALPN to http/1.1: the request/response relay below is HTTP/1.1-only,
//! same reason the Python original forces it — an h2 upstream's binary
//! framing has nothing in common with what this proxy parses.

use crate::deps::Deps;
use crate::mitm::Leaf;
use crate::proxy::{block_page_html, BoxBody};
use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use hyper::body::Incoming;
use hyper::server::conn::http1 as server_http1;
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use rustls_pemfile as pemfile;
use std::io::Cursor;
use std::sync::Arc;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio_rustls::rustls;

fn full_body(data: impl Into<Bytes>) -> BoxBody {
    Full::new(data.into()).map_err(|never| match never {}).boxed()
}

use crate::scan::{Screened, MAX_SCAN_BODY};

fn server_tls_config(leaf: &Leaf) -> std::io::Result<rustls::ServerConfig> {
    let certs: Vec<rustls_pki_types::CertificateDer<'static>> =
        pemfile::certs(&mut Cursor::new(leaf.cert_pem.as_bytes())).collect::<Result<_, _>>().map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    let key = pemfile::private_key(&mut Cursor::new(leaf.key_pem.as_bytes()))
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "no private key in leaf PEM"))?;

    let mut cfg = rustls::ServerConfig::builder().with_no_client_auth().with_single_cert(certs, key).map_err(std::io::Error::other)?;
    cfg.alpn_protocols = vec![b"http/1.1".to_vec()];
    Ok(cfg)
}

/// Built once. Trusts the Mozilla roots *and* the operating system's own:
/// with Mozilla's alone, a server whose certificate chains to a root only
/// the OS trusts — Microsoft's private PKI behind Windows Update delivery
/// and telemetry, or a company's own CA on its intranet — could not be
/// reached through inspection at all (fix 8 then passed it through; now it
/// is inspected like anything else). The browser trusts the same OS roots.
fn upstream_tls_config() -> Arc<rustls::ClientConfig> {
    static CONFIG: std::sync::OnceLock<Arc<rustls::ClientConfig>> = std::sync::OnceLock::new();
    CONFIG
        .get_or_init(|| {
            let mut roots = rustls::RootCertStore::empty();
            roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
            let native = rustls_native_certs::load_native_certs();
            let (added, _) = roots.add_parsable_certificates(native.certs);
            tracing::info!(os_roots = added, "upstream TLS trusts the operating system's roots too");
            let mut cfg = rustls::ClientConfig::builder().with_root_certificates(roots).with_no_client_auth();
            cfg.alpn_protocols = vec![b"http/1.1".to_vec()];
            Arc::new(cfg)
        })
        .clone()
}

/// Terminates TLS using a leaf for `host` and serves a branded 403 page as
/// the HTTPS response — no upstream connection is ever made. Turns a
/// domain block for an HTTPS site from a generic browser connection-error
/// screen into our own page.
/// Serves the block page, and returns whether the browser actually asked
/// for a page (see `is_page_request`) — the caller records a Web Gateway
/// event only then.
pub async fn serve_block_page<T>(deps: &Deps, io: T, host: &str, leaf: &Leaf, reason: &str, category: &str) -> std::io::Result<bool>
where
    T: AsyncRead + AsyncWrite + Unpin,
{
    let cfg = server_tls_config(leaf)?;
    let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(cfg));
    let mut tls = acceptor.accept(io).await?;

    // Read the browser's request before answering it. This used to write
    // the page straight after the handshake and close: with the request
    // still unread in the socket, closing makes the kernel send RST rather
    // than FIN, and a browser that sees the RST before it has read the
    // response shows ERR_SOCKET_NOT_CONNECTED instead of the page — a
    // race, so it only showed up under load (about 1 in 200 navigations
    // with five browsers opening blocked sites at once).
    let head = tokio::time::timeout(BLOCK_PAGE_READ_TIMEOUT, read_request_head(&mut tls)).await.unwrap_or_default();
    let page_request = is_page_request(&head);

    let html = block_page_html(deps, host, reason, category);
    let response = format!(
        "HTTP/1.1 403 Forbidden\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        html.len(),
        html
    );
    tls.write_all(response.as_bytes()).await?;
    tls.shutdown().await?;

    // Same reason, after the fact: let the browser close its side first
    // (or give up after a moment), so nothing it sends late turns our
    // close into a reset.
    let mut sink = [0u8; 1024];
    let _ = tokio::time::timeout(BLOCK_PAGE_READ_TIMEOUT, async {
        while matches!(tls.read(&mut sink).await, Ok(n) if n > 0) {}
    })
    .await;
    Ok(page_request)
}

/// Whether a request head is someone opening a page, as opposed to a page
/// fetching one of its parts. A blocked host is refused either way; only
/// this decides whether it is worth an event. Without it, one page that
/// embeds Stripe or an analytics script logged "Web request: r.stripe.com"
/// dozens of times for a site the person never opened.
///
/// Browsers say which it is in Sec-Fetch-Mode / Sec-Fetch-Dest. A client
/// that sends neither is not a browser (a desktop app, a script) and its
/// connection is recorded as before. No request at all — a socket the
/// browser opened speculatively and never used — is not recorded.
pub fn is_page_request(head: &[u8]) -> bool {
    if head.is_empty() {
        return false;
    }
    let text = String::from_utf8_lossy(head).to_ascii_lowercase();
    let header = |name: &str| {
        text.lines().skip(1).find_map(|l| l.strip_prefix(name).map(|v| v.trim_start_matches(':').trim().to_string()))
    };
    // Dest is the precise answer: an embedded frame also navigates
    // (mode "navigate") but its dest is "iframe".
    match (header("sec-fetch-dest"), header("sec-fetch-mode")) {
        (Some(dest), _) => dest == "document",
        (None, Some(mode)) => mode == "navigate",
        (None, None) => true,
    }
}

const BLOCK_PAGE_READ_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(3);

/// Reads up to the end of an HTTP/1.1 request head (or 16 KiB, or EOF) and
/// returns what it read.
async fn read_request_head<T: AsyncRead + Unpin>(io: &mut T) -> Vec<u8> {
    let mut buf = Vec::with_capacity(2048);
    let mut chunk = [0u8; 2048];
    while buf.len() < 16 * 1024 {
        match io.read(&mut chunk).await {
            Ok(0) | Err(_) => return buf,
            Ok(n) => {
                buf.extend_from_slice(&chunk[..n]);
                if buf.windows(4).any(|w| w == b"\r\n\r\n") {
                    return buf;
                }
            }
        }
    }
    buf
}

/// Opens a blind (unintercepted) tunnel to `host:port` and relays bytes
/// in both directions.
pub async fn blind_tunnel<T>(mut client: T, host: &str, port: u16) -> std::io::Result<()>
where
    T: AsyncRead + AsyncWrite + Unpin,
{
    let mut upstream = TcpStream::connect((host, port)).await?;
    tokio::io::copy_bidirectional(&mut client, &mut upstream).await?;
    Ok(())
}

/// Terminates TLS with the client using `leaf`, opens a fully-verified TLS
/// connection to the real upstream, and relays HTTP/1.1 request/response
/// pairs between them across the connection's keep-alive lifetime —
/// paying one double-handshake for the whole page load instead of one per
/// resource, same as the Python original's `_serve_over_tls`.
pub async fn serve_mitm<T>(io: T, host: String, port: u16, leaf: Leaf, deps: Arc<Deps>) -> std::io::Result<()>
where
    T: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let server_cfg = server_tls_config(&leaf)?;
    let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(server_cfg));
    let client_tls = match acceptor.accept(io).await {
        Ok(tls) => tls,
        Err(e) => {
            // An explicit refusal (a TLS alert about our certificate, or no
            // protocol in common because the client speaks only HTTP/2) is
            // learned at once; a handshake that just stopped counts as one
            // request-less connection.
            let refused = client_refused(&e);
            let learned = if refused { deps.mitm.learn_refused(&host, "refused_certificate") } else { deps.mitm.note_connection(&host, false) };
            if learned {
                tracing::warn!(%host, error = %e, "this app does not accept SSL inspection — passing its traffic through uninspected for 24 hours");
            }
            return Err(e);
        }
    };

    // The upstream connection is opened here and reopened on demand by
    // `relay_one`: the browser keeps its side of this tunnel alive far
    // longer than most servers keep an idle connection open, and a request
    // sent down one the server already closed used to come back as a 502 —
    // GitHub after about a minute idle, reproduced exactly that way.
    // http1::SendRequest isn't Clone/Sync — a Mutex is safe and cheap here
    // since HTTP/1.1 keep-alive on one connection is inherently one
    // request in flight at a time anyway.
    // If we cannot reach the real server the way the client would (it
    // wants a client certificate, its certificate chains to a CA only the
    // client trusts, it speaks only HTTP/2), the fault is ours, not the
    // server's: pass this host through from now on, so the client's next
    // attempt talks to the server directly and decides for itself.
    let first = match connect_upstream(&host, port).await {
        Ok(sender) => sender,
        Err(e) => {
            if deps.mitm.learn_refused(&host, "upstream_unreachable") {
                tracing::warn!(%host, error = %e, "could not inspect this server's TLS — passing its traffic through uninspected for 24 hours");
            }
            return Err(e);
        }
    };
    let sender = Arc::new(Mutex::new(Some(first)));

    let served = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let deps_for_svc = deps.clone();
    let host_for_svc = host.clone();
    let served_for_svc = served.clone();
    let service = service_fn(move |req: Request<Incoming>| {
        served_for_svc.store(true, std::sync::atomic::Ordering::Relaxed);
        let sender = sender.clone();
        let deps = deps_for_svc.clone();
        let host = host_for_svc.clone();
        async move { relay_one(req, sender, deps, host, port).await }
    });

    // with_upgrades: WebSocket connections (Teams, Outlook, Slack, ChatGPT,
    // many sign-in pages) switch protocols mid-connection; without it the
    // 101 response was never completed and every one of them failed.
    let result = server_http1::Builder::new().serve_connection(TokioIo::new(client_tls), service).with_upgrades().await.map_err(std::io::Error::other);
    if deps.mitm.note_connection(&host, served.load(std::sync::atomic::Ordering::Relaxed)) {
        tracing::warn!(%host, "this app closes inspected connections without using them — passing its traffic through uninspected for 24 hours");
    }
    result
}

/// Whether a failed handshake was the client saying no to us, rather than
/// the connection just going away.
fn client_refused(e: &std::io::Error) -> bool {
    use rustls::{AlertDescription as A, Error as R};
    match e.get_ref().and_then(|inner| inner.downcast_ref::<R>()) {
        Some(R::AlertReceived(alert)) => matches!(
            alert,
            A::BadCertificate | A::UnsupportedCertificate | A::CertificateRevoked | A::CertificateExpired | A::CertificateUnknown | A::UnknownCA | A::AccessDenied | A::NoApplicationProtocol | A::HandshakeFailure
        ),
        Some(R::NoApplicationProtocol) => true,
        _ => false,
    }
}

/// Relays a WebSocket (or any HTTP/1.1 Upgrade) through the inspected
/// connection: the request goes upstream on a connection of its own, and
/// once both sides have switched protocols the two streams are joined.
/// Frames are not inspected — WebSocket messages are not uploads.
async fn relay_upgrade(mut req: Request<Incoming>, host: &str, port: u16) -> Response<BoxBody> {
    let client_upgrade = hyper::upgrade::on(&mut req);
    let (parts, _body) = req.into_parts();
    let path_and_query = parts.uri.path_and_query().map(|pq| pq.as_str().to_string()).unwrap_or_else(|| "/".into());

    let connect = async {
        let tcp = TcpStream::connect((host, port)).await?;
        let connector = tokio_rustls::TlsConnector::from(upstream_tls_config());
        let name = rustls_pki_types::ServerName::try_from(host.to_string()).map_err(std::io::Error::other)?;
        let tls = connector.connect(name, tcp).await?;
        let (mut sender, conn) = hyper::client::conn::http1::handshake::<_, BoxBody>(TokioIo::new(tls)).await.map_err(std::io::Error::other)?;
        tokio::spawn(conn.with_upgrades());
        let mut b = Request::builder().method(parts.method.clone()).uri(&path_and_query);
        for (name, value) in parts.headers.iter() {
            b = b.header(name, value);
        }
        let upstream_req = b.body(full_body(Bytes::new())).map_err(std::io::Error::other)?;
        sender.send_request(upstream_req).await.map_err(std::io::Error::other)
    };
    let mut upstream_resp = match connect.await {
        Ok(r) => r,
        Err(e) => {
            tracing::debug!(error = %e, %host, "upgrade request failed upstream");
            return crate::proxy::status_response(StatusCode::BAD_GATEWAY);
        }
    };

    if upstream_resp.status() != StatusCode::SWITCHING_PROTOCOLS {
        // Refused upstream: hand its answer back as an ordinary response.
        let (resp_parts, body) = upstream_resp.into_parts();
        let body = body.map_err(Into::into).boxed();
        return crate::proxy::relayed_response(&resp_parts, body);
    }

    let upstream_upgrade = hyper::upgrade::on(&mut upstream_resp);
    let mut builder = Response::builder().status(StatusCode::SWITCHING_PROTOCOLS);
    for (name, value) in upstream_resp.headers().iter() {
        builder = builder.header(name, value);
    }
    let host = host.to_string();
    tokio::spawn(async move {
        match (client_upgrade.await, upstream_upgrade.await) {
            (Ok(client), Ok(upstream)) => {
                let (mut a, mut b) = (TokioIo::new(client), TokioIo::new(upstream));
                if let Err(e) = tokio::io::copy_bidirectional(&mut a, &mut b).await {
                    tracing::debug!(error = %e, %host, "upgraded connection ended");
                }
            }
            (Err(e), _) | (_, Err(e)) => tracing::debug!(error = %e, %host, "protocol switch failed"),
        }
    });
    builder.body(full_body(Bytes::new())).unwrap_or_else(|_| crate::proxy::status_response(StatusCode::BAD_GATEWAY))
}

type UpstreamSender = hyper::client::conn::http1::SendRequest<BoxBody>;

/// A verified TLS connection to the real `host:port`, ready for requests.
async fn connect_upstream(host: &str, port: u16) -> std::io::Result<UpstreamSender> {
    let upstream_tcp = TcpStream::connect((host, port)).await?;
    let connector = tokio_rustls::TlsConnector::from(upstream_tls_config());
    let server_name = rustls_pki_types::ServerName::try_from(host.to_string()).map_err(std::io::Error::other)?;
    let upstream_tls = connector.connect(server_name, upstream_tcp).await?;
    let (sender, conn) = hyper::client::conn::http1::handshake(TokioIo::new(upstream_tls)).await.map_err(std::io::Error::other)?;
    tokio::spawn(async move {
        if let Err(e) = conn.await {
            tracing::debug!(error = %e, "upstream connection closed");
        }
    });
    Ok(sender)
}

/// A request that may be sent a second time after its connection failed
/// underneath it — the methods HTTP defines as idempotent.
fn is_idempotent(method: &hyper::Method) -> bool {
    use hyper::Method;
    [Method::GET, Method::HEAD, Method::OPTIONS, Method::PUT, Method::DELETE, Method::TRACE].contains(method)
}

/// Sends one request upstream, reopening the connection when the server
/// has closed it. A connection already known to be closed is replaced
/// before sending, for any method. One that fails *while* sending is
/// retried once on a fresh connection, but only for an idempotent method,
/// or when hyper reports the request was never written — a POST that may
/// have reached the server is never sent twice.
async fn send_upstream(
    sender: &Mutex<Option<UpstreamSender>>,
    host: &str,
    port: u16,
    build: impl Fn() -> Request<BoxBody>,
    method: &hyper::Method,
) -> Result<Response<Incoming>, String> {
    let mut guard = sender.lock().await;
    for attempt in 0..2 {
        let live = match guard.as_mut() {
            Some(s) => s.ready().await.is_ok(),
            None => false,
        };
        if !live {
            *guard = Some(connect_upstream(host, port).await.map_err(|e| e.to_string())?);
        }
        let s = guard.as_mut().expect("connected just above");
        match s.send_request(build()).await {
            Ok(resp) => return Ok(resp),
            Err(e) => {
                *guard = None;
                let retry = attempt == 0 && (is_idempotent(method) || e.is_canceled());
                if !retry {
                    return Err(e.to_string());
                }
                tracing::debug!(error = %e, %host, "upstream connection failed mid-request — retrying on a new one");
            }
        }
    }
    Err("upstream request failed twice".to_string())
}

async fn relay_one(
    req: Request<Incoming>,
    sender: Arc<Mutex<Option<UpstreamSender>>>,
    deps: Arc<Deps>,
    host: String,
    port: u16,
) -> Result<Response<BoxBody>, hyper::Error> {
    if req.headers().contains_key(hyper::header::UPGRADE) {
        return Ok(relay_upgrade(req, &host, port).await);
    }
    let (parts, body) = req.into_parts();
    let method = parts.method.clone();
    let path = parts.uri.path().to_string();
    // What goes upstream is the path *and* query. Only the path used to be
    // sent, so every `?…` was silently dropped — search, pagination and
    // filters on every inspected site ("/get?foo=bar" arrived as "/get").
    let path_and_query = parts.uri.path_and_query().map(|pq| pq.as_str().to_string()).unwrap_or_else(|| path.clone());

    // Upload scanning (CASB app-control, then DLP content): buffer the body
    // (bounded — see MAX_SCAN_BODY) and scan it. The verdict is recorded,
    // never acted on: DLP is monitor-only, so the request always continues
    // to its upstream. A body over the cap relays unscanned — fail-open.
    let body_bytes = match body.collect().await {
        Ok(collected) => collected.to_bytes(),
        Err(e) => {
            tracing::debug!(error = %e, %host, "failed reading request body");
            return Ok(crate::proxy::status_response(StatusCode::BAD_GATEWAY));
        }
    };

    // Spawned, not awaited — see scan::spawn_upload_verdict's doc comment.
    // The verdict is recorded, never acted on, so nothing here can justify
    // making this upload wait for an admin-api round trip that may now
    // include a real LLM call (ai_text/ai_visual/ai_audio).
    if matches!(method.as_str(), "POST" | "PUT" | "PATCH") && body_bytes.len() <= MAX_SCAN_BODY {
        crate::scan::spawn_upload_verdict(
            deps.clone(),
            crate::scan::UploadMeta::from_request(&host, &method, &path_and_query, &parts.headers),
            body_bytes.clone(),
        );
    }

    let mut probe = Request::builder().method(method.clone()).uri(&path_and_query);
    for (name, value) in parts.headers.iter() {
        probe = probe.header(name, value);
    }
    if let Err(e) = probe.body(full_body(Bytes::new())) {
        tracing::debug!(error = %e, %host, "failed building upstream request");
        return Ok(crate::proxy::status_response(StatusCode::BAD_GATEWAY));
    }
    // Rebuilt per attempt: a request is consumed by sending it. Validity was
    // just checked above, and `Bytes` clones are a refcount, not a copy.
    let build = || {
        let mut b = Request::builder().method(method.clone()).uri(&path_and_query);
        for (name, value) in parts.headers.iter() {
            b = b.header(name, value);
        }
        b.body(full_body(body_bytes.clone())).expect("validated above")
    };

    let resp = match send_upstream(&sender, &host, port, build, &method).await {
        Ok(r) => r,
        Err(e) => {
            tracing::debug!(error = %e, %host, "upstream request failed");
            return Ok(crate::proxy::status_response(StatusCode::BAD_GATEWAY));
        }
    };

    // Downloads stream to the browser while they are scanned — see
    // scan::screen_download.
    let (resp_parts, resp_body) = resp.into_parts();
    let body = match crate::scan::screen_download(&deps, &host, &path, &parts, &resp_parts, resp_body).await {
        Screened::Relay(body) => body,
        Screened::Block(verdict) => {
            return Ok(crate::proxy::html_response(StatusCode::FORBIDDEN, &block_page_html(&deps, &host, &verdict.reason, &verdict.category)));
        }
    };
    Ok(crate::proxy::relayed_response(&resp_parts, body))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_opening_a_page_counts() {
        let nav = b"GET / HTTP/1.1\r\nHost: x\r\nSec-Fetch-Mode: navigate\r\nSec-Fetch-Dest: document\r\n\r\n";
        let beacon = b"POST /b HTTP/1.1\r\nHost: r.stripe.com\r\nsec-fetch-mode: no-cors\r\nsec-fetch-dest: empty\r\n\r\n";
        let script = b"GET /v3 HTTP/1.1\r\nHost: js.stripe.com\r\nSec-Fetch-Mode: no-cors\r\nSec-Fetch-Dest: script\r\n\r\n";
        let iframe = b"GET /f HTTP/1.1\r\nHost: m.stripe.network\r\nSec-Fetch-Mode: navigate\r\nSec-Fetch-Dest: iframe\r\n\r\n";
        let app = b"POST /api HTTP/1.1\r\nHost: x\r\nUser-Agent: Slack/4.41\r\n\r\n";
        assert!(is_page_request(nav));
        assert!(!is_page_request(beacon));
        assert!(!is_page_request(script));
        assert!(is_page_request(app), "a non-browser client is recorded as before");
        assert!(!is_page_request(b""), "a speculative socket with no request is not");
        // An embedded frame navigates, but it's the page's part, not the
        // person opening a site.
        assert!(!is_page_request(iframe));
    }
}
