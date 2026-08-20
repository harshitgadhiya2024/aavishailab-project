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
use tokio::io::{AsyncRead, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio_rustls::rustls;

fn full_body(data: impl Into<Bytes>) -> BoxBody {
    Full::new(data.into()).map_err(|never| match never {}).boxed()
}

/// Maximum request/response body this agent will buffer for DLP/malware
/// scanning. Larger bodies relay directly, unscanned — fail-open, same
/// philosophy as everywhere else in this codebase (a scanner that can't
/// see a body must never mean the body is blocked; see admin-api's
/// scanstream.go for the server-side equivalent bound). Chosen to match
/// dlp-service's own default MAX_SCAN_SIZE.
const MAX_SCAN_BODY: usize = 20 * 1024 * 1024;

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

fn upstream_tls_config() -> Arc<rustls::ClientConfig> {
    let mut roots = rustls::RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let mut cfg = rustls::ClientConfig::builder().with_root_certificates(roots).with_no_client_auth();
    cfg.alpn_protocols = vec![b"http/1.1".to_vec()];
    Arc::new(cfg)
}

/// Terminates TLS using a leaf for `host` and serves a branded 403 page as
/// the HTTPS response — no upstream connection is ever made. Turns a
/// domain block for an HTTPS site from a generic browser connection-error
/// screen into our own page.
pub async fn serve_block_page<T>(io: T, host: &str, leaf: &Leaf, reason: &str, category: &str) -> std::io::Result<()>
where
    T: AsyncRead + AsyncWrite + Unpin,
{
    let cfg = server_tls_config(leaf)?;
    let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(cfg));
    let mut tls = acceptor.accept(io).await?;

    let html = block_page_html(host, reason, category);
    let response = format!(
        "HTTP/1.1 403 Forbidden\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        html.len(),
        html
    );
    tls.write_all(response.as_bytes()).await?;
    tls.shutdown().await?;
    Ok(())
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
    let client_tls = acceptor.accept(io).await?;

    let upstream_tcp = TcpStream::connect((host.as_str(), port)).await?;
    let connector = tokio_rustls::TlsConnector::from(upstream_tls_config());
    let server_name = rustls_pki_types::ServerName::try_from(host.clone()).map_err(std::io::Error::other)?;
    let upstream_tls = connector.connect(server_name, upstream_tcp).await?;

    let (sender, conn) = hyper::client::conn::http1::handshake(TokioIo::new(upstream_tls)).await.map_err(std::io::Error::other)?;
    tokio::spawn(async move {
        if let Err(e) = conn.await {
            tracing::debug!(error = %e, "upstream connection closed");
        }
    });
    // http1::SendRequest isn't Clone/Sync — a Mutex is safe and cheap here
    // since HTTP/1.1 keep-alive on one connection is inherently one
    // request in flight at a time anyway.
    let sender = Arc::new(Mutex::new(sender));

    let deps_for_svc = deps.clone();
    let host_for_svc = host.clone();
    let service = service_fn(move |req: Request<Incoming>| {
        let sender = sender.clone();
        let deps = deps_for_svc.clone();
        let host = host_for_svc.clone();
        async move { relay_one(req, sender, deps, host).await }
    });

    server_http1::Builder::new().serve_connection(TokioIo::new(client_tls), service).await.map_err(std::io::Error::other)?;
    Ok(())
}

async fn relay_one(
    req: Request<Incoming>,
    sender: Arc<Mutex<hyper::client::conn::http1::SendRequest<BoxBody>>>,
    deps: Arc<Deps>,
    host: String,
) -> Result<Response<BoxBody>, hyper::Error> {
    let (parts, body) = req.into_parts();
    let method = parts.method.clone();
    let path = parts.uri.path().to_string();

    // Upload scanning (DLP): buffer the body (bounded — see MAX_SCAN_BODY),
    // scan it, and block the request outright on a "block" verdict rather
    // than forwarding it. A body over the cap relays unscanned rather than
    // failing the request — fail-open.
    let body_bytes = match body.collect().await {
        Ok(collected) => collected.to_bytes(),
        Err(e) => {
            tracing::debug!(error = %e, %host, "failed reading request body");
            return Ok(crate::proxy::status_response(StatusCode::BAD_GATEWAY));
        }
    };

    if matches!(method.as_str(), "POST" | "PUT" | "PATCH") && !body_bytes.is_empty() && body_bytes.len() <= MAX_SCAN_BODY && deps.gate.enforces_dlp() {
        if let Some(verdict) = crate::scan::scan_dlp(&deps.client, &host, &path, method.as_str(), &body_bytes).await {
            if verdict.action == "block" {
                tracing::info!(%host, %path, reason = %verdict.reason, "DLP block");
                return Ok(crate::proxy::html_response(StatusCode::FORBIDDEN, &block_page_html(&host, &verdict.reason, "DLP")));
            }
        }
    }

    let mut upstream_req = Request::builder().method(method).uri(&path);
    for (name, value) in parts.headers.iter() {
        upstream_req = upstream_req.header(name, value);
    }
    let upstream_req = match upstream_req.body(full_body(body_bytes)) {
        Ok(r) => r,
        Err(e) => {
            tracing::debug!(error = %e, %host, "failed building upstream request");
            return Ok(crate::proxy::status_response(StatusCode::BAD_GATEWAY));
        }
    };

    let mut guard = sender.lock().await;
    let resp = match guard.send_request(upstream_req).await {
        Ok(r) => r,
        Err(e) => {
            tracing::debug!(error = %e, %host, "upstream request failed");
            return Ok(crate::proxy::status_response(StatusCode::BAD_GATEWAY));
        }
    };
    drop(guard);

    let (resp_parts, resp_body) = resp.into_parts();
    let resp_bytes = match resp_body.collect().await {
        Ok(c) => c.to_bytes(),
        Err(_) => Bytes::new(),
    };

    // Download scanning (malware): same bounded-buffer, fail-open pattern.
    if resp_parts.status.is_success() && !resp_bytes.is_empty() && resp_bytes.len() <= MAX_SCAN_BODY && deps.gate.scans_downloads() {
        if let Some(verdict) = crate::scan::scan_malware(&deps.client, &host, &path, &resp_bytes).await {
            if verdict.action == "block" {
                tracing::info!(%host, %path, reason = %verdict.reason, "malware block");
                return Ok(crate::proxy::html_response(StatusCode::FORBIDDEN, &block_page_html(&host, &verdict.reason, "malware")));
            }
        }
    }

    let mut builder = Response::builder().status(resp_parts.status);
    for (name, value) in resp_parts.headers.iter() {
        if name == hyper::header::CONTENT_LENGTH || name == hyper::header::TRANSFER_ENCODING {
            continue; // recomputed by the body we're sending (may differ post-scan/re-framing)
        }
        builder = builder.header(name, value);
    }
    Ok(builder.body(full_body(resp_bytes)).unwrap())
}
