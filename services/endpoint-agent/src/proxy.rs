//! The local forward proxy — a port of Python's `ProxyConnection`, using
//! `hyper` for HTTP/1.1 parsing (Content-Length/chunked/keep-alive
//! handling) instead of the hand-rolled text parsing the Python original
//! used. That's a deliberate, additional correctness win beyond
//! performance: the migration plan that motivated this rewrite
//! specifically calls out `buf += chunk` (O(n²), unbounded for requests)
//! and hand-parsed chunked re-framing as real bug classes in the
//! original. Delegating to hyper — the same HTTP engine every other Rust
//! service in this repo already trusts — removes that class of bug by
//! construction rather than by care.
//!
//! Structure mirrors hyper's own documented CONNECT-proxy pattern: the
//! outer listener serves each connection through `hyper::server::conn`,
//! whose service closure special-cases `Method::CONNECT` (send 200, then
//! take the upgraded raw duplex stream) from everything else (forward via
//! a client connection, one-transaction-per-request — matching
//! `_handle_http`'s model).

use crate::deps::Deps;
use crate::rules::effective_rule;
use bytes::Bytes;
use http_body_util::{BodyExt, Empty, Full};
use hyper::body::Incoming;
use hyper::server::conn::http1 as server_http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;

pub type BoxBody = http_body_util::combinators::BoxBody<Bytes, hyper::Error>;

fn empty_body() -> BoxBody {
    Empty::<Bytes>::new().map_err(|never| match never {}).boxed()
}
pub(crate) fn full_body(data: impl Into<Bytes>) -> BoxBody {
    Full::new(data.into()).map_err(|never| match never {}).boxed()
}

pub async fn run(addr: SocketAddr, deps: Arc<Deps>) -> std::io::Result<()> {
    let listener = TcpListener::bind(addr).await?;
    tracing::info!(%addr, "local proxy listening");
    loop {
        let (stream, peer) = listener.accept().await?;
        let deps = deps.clone();
        tokio::spawn(async move {
            let io = TokioIo::new(stream);
            let service = service_fn(move |req| handle(req, deps.clone()));
            if let Err(e) = server_http1::Builder::new().serve_connection(io, service).with_upgrades().await {
                tracing::debug!(error = %e, %peer, "connection error");
            }
        });
    }
}

async fn handle(req: Request<Incoming>, deps: Arc<Deps>) -> Result<Response<BoxBody>, hyper::Error> {
    if req.method() == Method::CONNECT {
        Ok(handle_connect(req, deps).await)
    } else {
        Ok(handle_plain_http(req, deps).await)
    }
}

pub fn split_host_port(authority: &str, default_port: u16) -> (String, u16) {
    if let Some((h, p)) = authority.rsplit_once(':') {
        if let Ok(port) = p.parse::<u16>() {
            return (h.to_string(), port);
        }
    }
    (authority.to_string(), default_port)
}

async fn handle_connect(mut req: Request<Incoming>, deps: Arc<Deps>) -> Response<BoxBody> {
    let authority = match req.uri().authority() {
        Some(a) => a.to_string(),
        None => return status_response(StatusCode::BAD_REQUEST),
    };
    let (host, port) = split_host_port(&authority, 443);
    let er = effective_rule(&deps, &host).await;

    if er.action == "block" {
        tracing::info!(%host, reason = %er.reason, "BLOCK https");
        let kind = if er.category == "threat_intelligence" { "security" } else { "activity" };
        deps.reporter.record(&format!("https://{host}"), &host, "blocked", er.as_rule_like(), "web_request", kind);

        // A bare non-200 response to CONNECT can't carry a page — the
        // browser treats it as "the tunnel itself failed", not content.
        // The only way to show our own block page for an HTTPS site is to
        // terminate TLS and serve it as that site's "response", which
        // needs SSL Inspection on and a leaf for this host.
        let can_show_block_page = deps.gate.intercepts() && deps.mitm.should_intercept(&host).await;
        let leaf = if can_show_block_page { deps.mitm.get_leaf(&host).await } else { None };

        if let Some(leaf) = leaf {
            let upgrade_fut = hyper::upgrade::on(&mut req);
            let (host2, reason, category) = (host.clone(), er.reason.clone(), er.category.clone());
            tokio::spawn(async move {
                match upgrade_fut.await {
                    Ok(upgraded) => {
                        if let Err(e) = crate::tls_proxy::serve_block_page(TokioIo::new(upgraded), &host2, &leaf, &reason, &category).await {
                            tracing::debug!(error = %e, host = %host2, "block-page MITM failed");
                        }
                    }
                    Err(e) => tracing::debug!(error = %e, "CONNECT upgrade failed"),
                }
            });
            return status_response(StatusCode::OK);
        }
        return status_response(StatusCode::FORBIDDEN);
    }

    let report_action = if er.action == "alert" { "alerted" } else { "allowed" };
    deps.reporter.record(&format!("https://{host}"), &host, report_action, er.as_rule_like(), "web_request", "activity");

    let should_mitm = deps.gate.intercepts() && deps.mitm.should_intercept(&host).await;
    let leaf = if should_mitm { deps.mitm.get_leaf(&host).await } else { None };

    let upgrade_fut = hyper::upgrade::on(&mut req);
    let host2 = host.clone();
    tokio::spawn(async move {
        match upgrade_fut.await {
            Ok(upgraded) => {
                let io = TokioIo::new(upgraded);
                let result = if let Some(leaf) = leaf {
                    crate::tls_proxy::serve_mitm(io, host2.clone(), port, leaf, deps).await
                } else {
                    crate::tls_proxy::blind_tunnel(io, &host2, port).await
                };
                if let Err(e) = result {
                    tracing::debug!(error = %e, host = %host2, "tunnel ended");
                }
            }
            Err(e) => tracing::debug!(error = %e, "CONNECT upgrade failed"),
        }
    });

    status_response(StatusCode::OK)
}

/// Plain (non-TLS) HTTP: one request/response transaction per connection —
/// same model as CONNECT's MITM loop, just without the double TLS legs. A
/// browser reusing the underlying TCP connection for more requests just
/// opens a fresh one transparently; that's normal HTTP/1.1 behavior, not
/// an error.
async fn handle_plain_http(req: Request<Incoming>, deps: Arc<Deps>) -> Response<BoxBody> {
    let host = req.uri().host().unwrap_or("").to_string();
    if host.is_empty() {
        return status_response(StatusCode::BAD_REQUEST);
    }
    let port = req.uri().port_u16().unwrap_or(80);
    let path_and_query = req.uri().path_and_query().map(|pq| pq.as_str().to_string()).unwrap_or_else(|| "/".to_string());

    let er = effective_rule(&deps, &host).await;
    if er.action == "block" {
        tracing::info!(%host, reason = %er.reason, "BLOCK http");
        let kind = if er.category == "threat_intelligence" { "security" } else { "activity" };
        deps.reporter.record(&req.uri().to_string(), &host, "blocked", er.as_rule_like(), "web_request", kind);
        return html_response(StatusCode::FORBIDDEN, &block_page_html(&host, &er.reason, &er.category));
    }
    let report_action = if er.action == "alert" { "alerted" } else { "allowed" };
    deps.reporter.record(&req.uri().to_string(), &host, report_action, er.as_rule_like(), "web_request", "activity");

    match forward_plain_http(req, &host, port, &path_and_query, &deps).await {
        Ok(resp) => resp,
        Err(e) => {
            tracing::warn!(error = %e, %host, "upstream connect failed");
            status_response(StatusCode::BAD_GATEWAY)
        }
    }
}

/// Same upload (CASB + DLP) / download (malware) scanning as the MITM'd
/// HTTPS path (tls_proxy.rs's `relay_one`) — plain HTTP is a live upload
/// vector too (older APIs, internal tools, anything not on HTTPS), and it
/// would be a real gap for a DLP control to only look at encrypted
/// traffic and wave unencrypted uploads straight through.
async fn forward_plain_http(req: Request<Incoming>, host: &str, port: u16, path_and_query: &str, deps: &Arc<Deps>) -> std::io::Result<Response<BoxBody>> {
    let stream = tokio::net::TcpStream::connect((host, port)).await?;
    let (mut sender, conn) = hyper::client::conn::http1::handshake(TokioIo::new(stream)).await.map_err(std::io::Error::other)?;
    tokio::spawn(async move {
        let _ = conn.await;
    });

    let (parts, body) = req.into_parts();
    let method = parts.method.clone();
    let path = parts.uri.path().to_string();
    let content_type = parts.headers.get(hyper::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let content_disposition = parts.headers.get(hyper::header::CONTENT_DISPOSITION).and_then(|v| v.to_str().ok());
    let filename = crate::scan::upload_filename(content_disposition, &path);

    let body_bytes = body.collect().await.map_err(std::io::Error::other)?.to_bytes();

    if matches!(method.as_str(), "POST" | "PUT" | "PATCH") && body_bytes.len() <= crate::scan::MAX_SCAN_BODY {
        let verdict = crate::scan::upload_verdict(&deps.client, &deps.casb, &deps.gate, host, &path, method.as_str(), &content_type, &filename, &body_bytes).await;
        if verdict.blocked {
            return Ok(html_response(StatusCode::FORBIDDEN, &block_page_html(host, &verdict.reason, "Data Loss Prevention")));
        }
    }

    let mut upstream_req = Request::builder().method(method).uri(path_and_query);
    for (name, value) in parts.headers.iter() {
        upstream_req = upstream_req.header(name, value);
    }
    let upstream_req = upstream_req.body(full_body(body_bytes)).map_err(std::io::Error::other)?;

    let resp = sender.send_request(upstream_req).await.map_err(std::io::Error::other)?;
    let (resp_parts, resp_body) = resp.into_parts();
    let resp_bytes = resp_body.collect().await.map_err(std::io::Error::other)?.to_bytes();

    if resp_parts.status.is_success() && resp_bytes.len() <= crate::scan::MAX_SCAN_BODY {
        let verdict = crate::scan::download_verdict(&deps.client, &deps.gate, host, &path, &resp_bytes).await;
        if verdict.blocked {
            return Ok(html_response(StatusCode::FORBIDDEN, &block_page_html(host, &verdict.reason, "Malware Protection")));
        }
    }

    let mut builder = Response::builder().status(resp_parts.status);
    for (name, value) in resp_parts.headers.iter() {
        if name == hyper::header::CONTENT_LENGTH || name == hyper::header::TRANSFER_ENCODING {
            continue; // recomputed by the body we're sending (may differ post-scan)
        }
        builder = builder.header(name, value);
    }
    Ok(builder.body(full_body(resp_bytes)).unwrap())
}

pub fn status_response(status: StatusCode) -> Response<BoxBody> {
    Response::builder().status(status).body(empty_body()).unwrap()
}

pub fn html_response(status: StatusCode, html: &str) -> Response<BoxBody> {
    Response::builder().status(status).header("content-type", "text/html; charset=utf-8").body(full_body(html.to_string())).unwrap()
}

pub fn block_page_html(domain: &str, reason: &str, category: &str) -> String {
    format!(
        "<!doctype html><html><head><title>Blocked</title></head><body style=\"font-family:sans-serif;text-align:center;padding:80px\">\
        <h1>Access to this site is blocked</h1><p><strong>{domain}</strong></p>\
        <p>{reason}</p><p style=\"color:#888\">Category: {category}</p></body></html>"
    )
}
