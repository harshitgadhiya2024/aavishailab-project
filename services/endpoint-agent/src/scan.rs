//! DLP/malware/CASB scan integration — proxies intercepted upload/download
//! bodies to admin-api's `/internal/agent/scan-dlp`, `/internal/agent/scan-file`,
//! and `/internal/agent/casb/app-control` endpoints, the same contract the
//! Python agent's `_scan_upload_spooled`/`_relay_scanned_spool`/
//! `_casb_upload_verdict` used.
//!
//! Called from both proxy.rs (plain HTTP) and tls_proxy.rs (MITM'd HTTPS)
//! so the two code paths can't drift — see `upload_verdict`/`download_verdict`
//! below, which is the shared decision both callers act on.

use crate::casb_cache::CASBControlCache;
use crate::deps::Deps;
use crate::enforcement::EnforcementGate;
use crate::http_client::AgentClient;
use bytes::Bytes;
use serde::Deserialize;
use std::sync::Arc;

/// Maximum request/response body either scan path will buffer for
/// inspection. A body over this relays directly, unscanned — fail-open,
/// same philosophy as everywhere else in this codebase (a scanner that
/// can't see a body must never mean the body is blocked). Chosen to match
/// dlp-service's own default MAX_SCAN_SIZE.
pub const MAX_SCAN_BODY: usize = 20 * 1024 * 1024;

#[derive(Debug, Deserialize)]
pub struct DlpVerdict {
    #[serde(default)]
    pub action: String,
    #[serde(default)]
    pub reason: String,
}

/// What a caller should do about an in-flight upload or download, and why
/// — normalizes CASB/DLP/malware verdicts into one shape so proxy.rs and
/// tls_proxy.rs render the exact same block page for any of the three.
pub struct ScanVerdict {
    pub blocked: bool,
    pub reason: String,
    /// Which protection stopped it, shown on the block page. Empty when not
    /// blocked; the caller substitutes a default only if it ever needs one.
    pub category: String,
}

impl ScanVerdict {
    fn allow() -> Self {
        ScanVerdict { blocked: false, reason: String::new(), category: String::new() }
    }
}

/// Best-effort filename extraction — a port of `_upload_filename`. Real
/// multipart/form-data carries the true filename *inside* the body (in a
/// per-part Content-Disposition header), which neither this port nor the
/// Python original parses; both fall back to the last URL path segment.
/// This is a known, pre-existing limitation of the whole design, not a
/// regression — and it doesn't weaken pattern-based DLP detection, which
/// scans the raw body bytes regardless of what filename/content-type is
/// reported.
pub fn upload_filename(content_disposition: Option<&str>, path: &str) -> String {
    if let Some(cd) = content_disposition {
        if let Some(idx) = cd.find("filename=") {
            let rest = &cd[idx + "filename=".len()..];
            let name = rest.trim().trim_matches('"').trim_matches('\'');
            if !name.is_empty() {
                return name.to_string();
            }
        }
    }
    path.rsplit('/').next().unwrap_or("").to_string()
}

/// What the proxy knows about one outbound upload, forwarded with its body so
/// the server can tell a person sending something from background traffic.
#[derive(Clone, Debug, Default)]
pub struct UploadMeta {
    pub host: String,
    /// Path *and* query: several send endpoints are only recognisable by
    /// their query (Gmail's `?act=sm`).
    pub path: String,
    pub method: String,
    pub content_type: String,
    pub filename: String,
    pub user_agent: String,
    /// `Sec-Fetch-Mode` / `Sec-Fetch-Dest`: "navigate"/"document" is a form
    /// the person submitted; a script's background POST says "cors"/"empty".
    pub sec_fetch_mode: String,
    pub sec_fetch_dest: String,
}

impl UploadMeta {
    /// Reads everything but the host from the request's own line and headers.
    pub fn from_request(host: &str, method: &hyper::Method, path_and_query: &str, headers: &hyper::HeaderMap) -> Self {
        let header = |name: &str| headers.get(name).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
        let path = path_and_query.split('?').next().unwrap_or("");
        let content_disposition = headers.get(hyper::header::CONTENT_DISPOSITION).and_then(|v| v.to_str().ok());
        UploadMeta {
            host: host.to_string(),
            path: path_and_query.to_string(),
            method: method.as_str().to_string(),
            content_type: header("content-type"),
            filename: upload_filename(content_disposition, path),
            user_agent: header("user-agent"),
            sec_fetch_mode: header("sec-fetch-mode"),
            sec_fetch_dest: header("sec-fetch-dest"),
        }
    }
}

/// Records an outbound upload. **Always returns allow.**
///
/// Data-loss protection here is visibility, not interception: the company
/// sees that an employee sent something sensitive, and the employee's work
/// is never interrupted. Both halves below — the CASB app-control gate and
/// the DLP content scan — still run, because running them is what produces
/// the incident the company reads; neither one's verdict can stop the
/// upload any more.
///
/// The return type stays `ScanVerdict` rather than becoming `()` so the two
/// proxy paths keep one shared shape with `download_verdict`, which *does*
/// still block — malware is a threat to the machine, sensitive data leaving
/// is a thing to know about. Those are different decisions and only one of
/// them was reversed.
/// Fires `upload_verdict` in the background instead of making the actual
/// upload wait for it — the caller relays the upload upstream immediately,
/// on its own task, while this one runs to completion independently.
///
/// This exists because the wait stopped being cheap. `upload_verdict`'s
/// result was always discarded — DLP is monitor-only, so there is nothing
/// for a caller to branch on — but every upload still sat blocked on the
/// full admin-api round trip before either proxy path would relay a single
/// byte onward, because both called it with a plain `.await`.
///
/// That round trip used to be cheap: a regex/checksum pass, effectively
/// free. It stopped being cheap the moment the ai_text/ai_visual/ai_audio
/// tiers actually started firing on the default policy (see
/// `effectiveDLPPolicies` on the server) — those are real calls to an
/// external LLM (admin-api's aiclient carries a 30s timeout to ai-service
/// alone, before whatever the upstream model provider itself takes), and
/// this agent's own HTTP client has no timeout on top of that at all. An
/// employee uploading a photo or a voice note would have had the browser's
/// upload visibly stall for however long that classification took —
/// seconds, or the full 30s on a slow day — for a scan whose answer was
/// never going to change whether the upload happened.
///
/// `body` is `Bytes` rather than `&[u8]` specifically so this can be called
/// with a cheap clone of the buffer the caller is about to move into the
/// actual upstream request: `Bytes::clone` bumps a refcount, it does not
/// copy the data, so scanning in the background costs no extra allocation
/// on the hot path it no longer blocks.
pub fn spawn_upload_verdict(deps: Arc<Deps>, meta: UploadMeta, body: Bytes) {
    tokio::spawn(async move {
        upload_verdict(&deps.client, &deps.casb, &deps.gate, &meta, &body).await;
    });
}

pub async fn upload_verdict(
    client: &AgentClient,
    casb: &CASBControlCache,
    gate: &EnforcementGate,
    meta: &UploadMeta,
    body: &[u8],
) -> ScanVerdict {
    let host = meta.host.as_str();
    let path = meta.path.as_str();
    if !gate.enforces_dlp() {
        return ScanVerdict::allow();
    }

    if let Some(casb_verdict) = casb.check(host, "upload").await {
        if casb_verdict.action == "block" || casb_verdict.action == "alert" {
            tracing::info!(%host, %path, reason = %casb_verdict.reason, "CASB recorded — allowed through");
        }
    }

    if body.is_empty() {
        return ScanVerdict::allow();
    }
    if let Some(verdict) = scan_dlp(client, meta, body).await {
        if verdict.action == "block" || verdict.action == "alert" {
            let reason = if verdict.reason.is_empty() { "Sensitive company data detected".to_string() } else { verdict.reason };
            tracing::info!(%host, %path, %reason, "DLP recorded — allowed through");
        }
    }
    ScanVerdict::allow()
}

/// What the proxy sends back for one upstream response.
pub enum Screened {
    /// Relay this body to the browser.
    Relay(crate::proxy::BoxBody),
    /// Show the block page instead.
    Block(ScanVerdict),
}

/// Download screening — whole files, of any size, without making the
/// browser wait for the whole file first.
///
/// Every response used to be read completely into memory before the
/// browser got its first byte, and only the first 20 MB of a file could be
/// scanned at all. A 250 MB installer sat in the agent for minutes while
/// the browser showed nothing — 4 MB from GitHub's CDN took 103 s to start
/// through the agent against 0.2 s direct — and once it arrived it had not
/// been scanned anyway.
///
/// Now a file download streams to the browser as it arrives, the way inline
/// gateways (Palo Alto's stream scanning, Zscaler) handle it: everything
/// but the final chunk is passed on immediately, while the agent hashes the
/// bytes and keeps a copy on disk. When the download ends, the final chunk
/// is held until there is a verdict (see `resolve_download`), so the browser
/// cannot finish — and the file cannot be opened — before it is known to be
/// safe. A block aborts the transfer and the browser marks it failed.
///
/// Page parts, non-2xx responses and devices not scanning downloads stream
/// straight through untouched.
pub async fn screen_download(
    deps: &Deps,
    host: &str,
    path: &str,
    request: &hyper::http::request::Parts,
    parts: &hyper::http::response::Parts,
    body: hyper::body::Incoming,
) -> Screened {
    use http_body_util::BodyExt;

    let header = |name| parts.headers.get(name).and_then(|v: &hyper::header::HeaderValue| v.to_str().ok()).unwrap_or("");
    let content_type = header(hyper::header::CONTENT_TYPE);
    let content_disposition = header(hyper::header::CONTENT_DISPOSITION);
    let sec_fetch_mode = request.headers.get("sec-fetch-mode").and_then(|v| v.to_str().ok()).unwrap_or("");
    if !parts.status.is_success()
        || !deps.gate.scans_downloads()
        || !is_file_download(request.method.as_str(), sec_fetch_mode, content_type, content_disposition, path)
    {
        return Screened::Relay(body.map_err(Into::into).boxed());
    }

    // A VPN client being downloaded is stopped before it ever lands, the
    // same as an installed one is stopped from running (app_control.rs):
    // letting the installer download and only killing it after it runs
    // leaves a window, and on a locked-down device there is no legitimate
    // reason to pull one down. Recognised by the download's own file name,
    // so it is caught even from a mirror or file-share the domain block
    // (the vpn_proxy category) never sees. Needs no body, so it is decided
    // before a byte is relayed.
    let filename = upload_filename(Some(content_disposition), path);
    if let Some(product) = vpn_installer(&filename) {
        let reason = format!("{product} is blocked on this device. Contact your IT administrator if you need access.");
        tracing::info!(%host, %path, %product, "VPN download blocked");
        return Screened::Block(ScanVerdict { blocked: true, reason, category: "Application Control".to_string() });
    }

    let file = DownloadFile { host: host.to_string(), path: path.to_string(), filename, content_type: content_type.to_string() };
    let client = deps.client.clone();
    let resolve: Resolver = Box::new(move |done| Box::pin(resolve_download(client, file, done)));
    Screened::Relay(ScannedDownload::new(body, Spool::create(), resolve).boxed())
}

/// The largest download kept for scanning — clamd's own StreamMaxLength in
/// production. Past it the file is still hashed (a known-bad hash still
/// blocks) and reported as unscanned.
const MAX_SPOOL: u64 = 4000 << 20;

/// How long a finished download may wait at its final chunk for a verdict.
/// Past it the download is released — fail-open, like every scan path here
/// — and the scan carries on; a late block becomes an alert instead.
const VERDICT_WAIT: std::time::Duration = std::time::Duration::from_secs(60);

pub enum Decision {
    Allow,
    Block(String),
}

/// What is known about a download once its last byte has arrived.
pub struct Finished {
    sha256: String,
    size: u64,
    /// The bytes on disk, or why there are none.
    spool: Result<Spool, &'static str>,
}

type Resolver = Box<dyn FnOnce(Finished) -> std::pin::Pin<Box<dyn std::future::Future<Output = Decision> + Send>> + Send + Sync>;

/// A download's copy on disk, deleted when dropped — whether the scan used
/// it, the browser cancelled, or the scan was never needed.
pub struct Spool {
    path: std::path::PathBuf,
    file: Option<std::fs::File>,
}

impl Spool {
    fn create() -> Result<Spool, &'static str> {
        let dir = std::env::temp_dir().join("aavishield-downloads");
        std::fs::create_dir_all(&dir).map_err(|_| "spool_failed")?;
        let path = dir.join(format!("{:032x}", rand::random::<u128>()));
        let file = std::fs::File::create(&path).map_err(|_| "spool_failed")?;
        Ok(Spool { path, file: Some(file) })
    }
}

impl Drop for Spool {
    fn drop(&mut self) {
        self.file.take();
        let _ = std::fs::remove_file(&self.path);
    }
}

/// A download body that relays all but its final chunk as it arrives,
/// hashing and spooling every byte, and releases that chunk only once the
/// resolver has decided.
pub struct ScannedDownload<B> {
    inner: B,
    held: Option<Bytes>,
    hasher: sha2::Sha256,
    size: u64,
    spool: Result<Spool, &'static str>,
    resolve: Option<Resolver>,
    verdict: Option<tokio::sync::oneshot::Receiver<Decision>>,
    done: bool,
}

impl<B> ScannedDownload<B> {
    fn new(inner: B, spool: Result<Spool, &'static str>, resolve: Resolver) -> Self {
        use sha2::Digest;
        ScannedDownload { inner, held: None, hasher: sha2::Sha256::new(), size: 0, spool, resolve: Some(resolve), verdict: None, done: false }
    }

    /// Hash and spool one chunk. Writes are synchronous: they are chunk-sized
    /// appends to a local file, far quicker than the network delivering them.
    fn record(&mut self, data: &[u8]) {
        use sha2::Digest;
        use std::io::Write;
        self.hasher.update(data);
        self.size += data.len() as u64;
        if let Ok(spool) = &mut self.spool {
            let written = if self.size > MAX_SPOOL {
                Err("too_large")
            } else {
                spool.file.as_mut().expect("open while spooling").write_all(data).map_err(|_| "spool_failed")
            };
            if let Err(why) = written {
                self.spool = Err(why); // dropping the Spool deletes the partial copy
            }
        }
    }
}

/// Aborts the browser's transfer; the message ends up only in hyper's log.
#[derive(Debug)]
struct DownloadBlocked;

impl std::fmt::Display for DownloadBlocked {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("download blocked by malware scan")
    }
}

impl std::error::Error for DownloadBlocked {}

impl<B> hyper::body::Body for ScannedDownload<B>
where
    B: hyper::body::Body<Data = Bytes> + Unpin,
    B::Error: Into<crate::proxy::BodyError>,
{
    type Data = Bytes;
    type Error = crate::proxy::BodyError;

    fn poll_frame(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<Result<hyper::body::Frame<Bytes>, Self::Error>>> {
        use hyper::body::Frame;
        use std::future::Future;
        use std::task::Poll;

        let this = &mut *self;
        loop {
            if let Some(rx) = this.verdict.as_mut() {
                let decision = std::task::ready!(std::pin::Pin::new(rx).poll(cx));
                this.verdict = None;
                this.done = true;
                return match decision {
                    Ok(Decision::Block(_)) => Poll::Ready(Some(Err(Box::new(DownloadBlocked)))),
                    // A resolver that died without answering fails open.
                    Ok(Decision::Allow) | Err(_) => Poll::Ready(this.held.take().map(|b| Ok(Frame::data(b)))),
                };
            }
            if this.done {
                return Poll::Ready(None);
            }
            match std::task::ready!(std::pin::Pin::new(&mut this.inner).poll_frame(cx)) {
                Some(Err(e)) => {
                    this.done = true;
                    return Poll::Ready(Some(Err(e.into())));
                }
                Some(Ok(frame)) => {
                    let Ok(data) = frame.into_data() else { continue }; // trailers are not relayed
                    if data.is_empty() {
                        continue;
                    }
                    this.record(&data);
                    if let Some(previous) = this.held.replace(data) {
                        return Poll::Ready(Some(Ok(Frame::data(previous))));
                    }
                }
                None => {
                    use sha2::Digest;
                    let hasher = std::mem::replace(&mut this.hasher, sha2::Sha256::new());
                    let spool = std::mem::replace(&mut this.spool, Err("taken"));
                    let finished = Finished { sha256: hex::encode(hasher.finalize()), size: this.size, spool };
                    let resolve = this.resolve.take().expect("resolved once");
                    let (tx, rx) = tokio::sync::oneshot::channel();
                    tokio::spawn(async move {
                        let _ = tx.send(resolve(finished).await);
                    });
                    this.verdict = Some(rx);
                }
            }
        }
    }
}

#[derive(Clone)]
struct DownloadFile {
    host: String,
    path: String,
    filename: String,
    content_type: String,
}

impl DownloadFile {
    fn query(&self) -> String {
        format!(
            "filename={}&destination={}&content_type={}",
            urlencode(&self.filename),
            urlencode(&self.host),
            urlencode(&self.content_type)
        )
    }
}

/// The verdict for a finished download: hash reputation first, then the
/// bytes themselves through a background scan job (see admin-api's
/// download_scan.go), waiting at most `VERDICT_WAIT`. Fails open on every
/// error, and never leaves a late malicious verdict unreported.
async fn resolve_download(client: AgentClient, file: DownloadFile, done: Finished) -> Decision {
    if done.size == 0 {
        return Decision::Allow; // nothing to scan
    }
    let unscanned = done.spool.as_ref().err().copied();
    match scan_hash(&client, &file, &done, unscanned).await {
        Some(HashAnswer::Known(decision)) => return notify_decision(&file, decision).await,
        Some(HashAnswer::Unknown) => {}
        None => {
            tracing::warn!(host = %file.host, path = %file.path, "download scan unavailable — allowing");
            return Decision::Allow;
        }
    }
    let Ok(spool) = done.spool else { return Decision::Allow };

    let (tx, rx) = tokio::sync::oneshot::channel();
    let size = done.size;
    let sha256 = done.sha256.clone();
    let late_client = client.clone();
    let late_file = file.clone();
    tokio::spawn(async move {
        let result = upload_and_scan(&late_client, &late_file, spool, size).await;
        let decision = match result {
            Some(decision) => decision,
            None => {
                tracing::warn!(host = %late_file.host, path = %late_file.path, "download could not be scanned — allowing");
                let unscanned = Finished { sha256, size, spool: Err("scan_failed") };
                let _ = scan_hash(&late_client, &late_file, &unscanned, Some("scan_failed")).await;
                Decision::Allow
            }
        };
        // Nobody is waiting any more: the download was already released.
        if let Err(Decision::Block(reason)) = tx.send(decision) {
            tracing::warn!(host = %late_file.host, path = %late_file.path, %reason, "malware found after the download was released");
            crate::app_control::notify(
                "Delete this download",
                &notice_text(&format!("{} was found to be malicious after it finished downloading: {reason}", late_file.filename)),
            )
            .await;
        }
    });

    match tokio::time::timeout(VERDICT_WAIT, rx).await {
        Ok(Ok(decision)) => notify_decision(&file, decision).await,
        _ => {
            tracing::info!(host = %file.host, path = %file.path, "verdict still pending — releasing the download, scan continues");
            Decision::Allow
        }
    }
}

async fn notify_decision(file: &DownloadFile, decision: Decision) -> Decision {
    if let Decision::Block(reason) = &decision {
        tracing::info!(host = %file.host, path = %file.path, %reason, "malware block");
        crate::app_control::notify("Download blocked", &notice_text(&format!("{}: {reason}", file.filename))).await;
    }
    decision
}

/// Text safe to put inside the notification helper's script literal.
fn notice_text(s: &str) -> String {
    s.chars().filter(|c| !matches!(c, '"' | '\\' | '\'' | '\n' | '\r')).take(200).collect()
}

enum HashAnswer {
    Known(Decision),
    Unknown,
}

#[derive(Deserialize)]
struct HashReply {
    known: bool,
    #[serde(default)]
    action: String,
    #[serde(default)]
    reason: String,
}

fn decision_for(action: &str, reason: String) -> Decision {
    if action == "block" {
        Decision::Block(if reason.is_empty() { "Malicious file detected".to_string() } else { reason })
    } else {
        Decision::Allow
    }
}

async fn scan_hash(client: &AgentClient, file: &DownloadFile, done: &Finished, unscanned: Option<&str>) -> Option<HashAnswer> {
    let mut query = format!("sha256={}&size={}&{}", done.sha256, done.size, file.query());
    if let Some(why) = unscanned {
        query.push_str(&format!("&unscanned={why}"));
    }
    let resp = client.post_bytes(&format!("/internal/agent/scan-hash?{query}"), "application/octet-stream", Vec::new()).await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let reply: HashReply = resp.json().await.ok()?;
    Some(if reply.known { HashAnswer::Known(decision_for(&reply.action, reply.reason)) } else { HashAnswer::Unknown })
}

#[derive(Deserialize)]
struct JobCreated {
    id: String,
    part_bytes: u64,
}

#[derive(Deserialize)]
struct JobState {
    #[serde(default)]
    state: String,
    #[serde(default)]
    received: u64,
    #[serde(default)]
    action: String,
    #[serde(default)]
    reason: String,
}

/// Uploads the spooled file as a scan job and waits for its verdict.
/// `None` means it could not be scanned.
async fn upload_and_scan(client: &AgentClient, file: &DownloadFile, spool: Spool, size: u64) -> Option<Decision> {
    use tokio::io::{AsyncReadExt, AsyncSeekExt};

    let resp = client.post_bytes(&format!("/internal/agent/scan-jobs?size={size}&{}", file.query()), "application/octet-stream", Vec::new()).await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let job: JobCreated = resp.json().await.ok()?;
    let base = format!("/internal/agent/scan-jobs/{}", job.id);

    let mut reader = tokio::fs::File::open(&spool.path).await.ok()?;
    let mut offset = 0u64;
    let mut failures = 0;
    while offset < size {
        let len = job.part_bytes.min(size - offset) as usize;
        let mut part = vec![0u8; len];
        reader.seek(std::io::SeekFrom::Start(offset)).await.ok()?;
        reader.read_exact(&mut part).await.ok()?;
        let answer = client.put_bytes(&format!("{base}/parts?offset={offset}"), part).await;
        match answer {
            // 200 is the new offset; 409 is the offset the server is really
            // at — either way, carry on from there.
            Ok(r) if r.status().is_success() || r.status() == reqwest::StatusCode::CONFLICT => {
                let state: JobState = r.json().await.ok()?;
                offset = state.received;
            }
            _ => {
                failures += 1;
                if failures > 3 {
                    return None;
                }
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            }
        }
    }
    drop(reader);
    drop(spool);

    let r = client.post_bytes(&format!("{base}/complete"), "application/octet-stream", Vec::new()).await.ok()?;
    if !r.status().is_success() {
        return None;
    }
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(20 * 60);
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        let state: JobState = client.get(&base).await.ok()?.json().await.ok()?;
        if state.state == "done" {
            return Some(decision_for(&state.action, state.reason));
        }
        if tokio::time::Instant::now() > deadline {
            return None;
        }
    }
}

/// Names the VPN product a download is an installer for, if it is one.
///
/// Distinctive product names (nordvpn, expressvpn, wireguard…) match on
/// their own — those are never anything but the VPN. The bare word "vpn"
/// matches only together with an executable/installer extension, so a
/// document like "vpn-setup-guide.pdf" is left alone while "AnyConnectVPN
/// .exe" or "vpn.dmg" is caught. Purely name-based and best-effort: it is
/// the download-time layer of VPN control, backed by the domain block
/// (vpn_proxy) on the vendors' own sites and the running-process block
/// (app_control) for anything that still gets installed.
fn vpn_installer(filename: &str) -> Option<&'static str> {
    let f = filename.to_lowercase();

    // (token in the file name, name shown to the person)
    const NAMED: &[(&str, &str)] = &[
        ("nordvpn", "NordVPN"), ("expressvpn", "ExpressVPN"), ("surfshark", "Surfshark"),
        ("cyberghost", "CyberGhost VPN"), ("tunnelbear", "TunnelBear"), ("windscribe", "Windscribe"),
        ("hotspotshield", "Hotspot Shield"), ("hotspot-shield", "Hotspot Shield"),
        ("protonvpn", "Proton VPN"), ("proton-vpn", "Proton VPN"), ("mullvad", "Mullvad VPN"),
        ("ipvanish", "IPVanish"), ("purevpn", "PureVPN"), ("wireguard", "WireGuard"),
        ("openvpn", "OpenVPN"), ("hidemyass", "HideMyAss VPN"), ("privateinternetaccess", "Private Internet Access"),
        ("private-internet-access", "Private Internet Access"), ("vyprvpn", "VyprVPN"),
        ("atlasvpn", "Atlas VPN"), ("privadovpn", "PrivadoVPN"), ("torguard", "TorGuard"),
        ("strongvpn", "StrongVPN"), ("zenmate", "ZenMate"), ("psiphon", "Psiphon"),
        ("ultrasurf", "Ultrasurf"), ("softether", "SoftEther VPN"), ("forticlient", "FortiClient VPN"),
    ];
    for (token, name) in NAMED {
        if f.contains(token) {
            return Some(name);
        }
    }

    // Generic: any installer whose name contains "vpn".
    const INSTALLER_EXT: &[&str] =
        &[".exe", ".msi", ".msix", ".appx", ".dmg", ".pkg", ".mpkg", ".deb", ".rpm", ".appimage", ".apk"];
    if f.contains("vpn") && INSTALLER_EXT.iter().any(|e| f.ends_with(e)) {
        return Some("VPN software");
    }
    None
}

/// Whether a response is a file someone is downloading, rather than part of
/// a web page or an app's API traffic. Only files are scanned.
///
/// Every successful response used to be: each page's HTML, stylesheets,
/// scripts, images and API responses were uploaded to admin-api and the
/// browser was made to wait for each verdict before receiving any of it. A
/// GitHub page — dozens of those — took 10–12s to load or timed out, and
/// under a busy scanner every open tab stalled together (found with 50
/// connections stuck at once). It also meant every page anyone viewed was
/// copied to the server.
///
/// It then went wrong the other way: "anything that is not a page part"
/// counted as a file, so apps' binary RPCs — Cursor's api2.cursor.sh
/// (Connect, `application/proto`), Chrome's Safe Browsing and Optimization
/// Guide updates — were all scanned. Since 2.9.6 holds a download's last
/// chunk until its verdict, every one of those calls stalled behind a scan
/// (up to `VERDICT_WAIT`), the device ran into the server's concurrent-scan
/// limit, and the dashboard filled with "Download not scanned" for traffic
/// nobody downloaded.
///
/// So a file now needs positive evidence, the way a browser decides to save
/// rather than render:
/// - an `attachment` disposition, whatever the method (a form POST can
///   export a file);
/// - otherwise only a GET, with a file-type extension or a content type
///   that is itself a file format;
/// - a bare `application/octet-stream` — what most APIs answer with too —
///   only when the browser navigated to it (`Sec-Fetch-Mode: navigate`):
///   the person clicked a download link.
pub fn is_file_download(method: &str, sec_fetch_mode: &str, content_type: &str, content_disposition: &str, path: &str) -> bool {
    if content_disposition.trim_start().to_ascii_lowercase().starts_with("attachment") {
        return true;
    }
    if !method.eq_ignore_ascii_case("GET") {
        return false;
    }

    const FILE_EXTENSIONS: &[&str] = &[
        "exe", "msi", "msix", "appx", "dmg", "pkg", "mpkg", "deb", "rpm", "appimage", "apk", "ipa", "jar",
        "zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz", "zst", "cab", "iso", "img",
        "bat", "cmd", "ps1", "vbs", "sh", "scr", "com", "dll", "so", "dylib", "hta", "lnk",
        "pdf", "doc", "docx", "docm", "xls", "xlsx", "xlsm", "ppt", "pptx", "pptm", "rtf", "one",
    ];
    let ext = path
        .rsplit('/')
        .next()
        .and_then(|name| name.rsplit_once('.'))
        .map(|(_, ext)| ext.to_ascii_lowercase())
        .unwrap_or_default();
    if FILE_EXTENSIONS.contains(&ext.as_str()) {
        return true;
    }

    let mime = content_type.split(';').next().unwrap_or("").trim().to_ascii_lowercase();
    const FILE_MIMES: &[&str] = &[
        "application/zip", "application/x-zip-compressed", "application/x-7z-compressed", "application/x-rar-compressed",
        "application/vnd.rar", "application/x-tar", "application/gzip", "application/x-gzip", "application/x-bzip2",
        "application/x-xz", "application/zstd", "application/vnd.ms-cab-compressed", "application/x-iso9660-image",
        "application/x-msdownload", "application/x-msdos-program", "application/x-ms-installer", "application/x-msi",
        "application/vnd.microsoft.portable-executable", "application/x-dosexec", "application/x-executable",
        "application/x-mach-binary", "application/x-apple-diskimage", "application/vnd.apple.installer+xml",
        "application/x-debian-package", "application/vnd.debian.binary-package", "application/x-rpm",
        "application/x-redhat-package-manager", "application/vnd.android.package-archive", "application/java-archive",
        "application/x-sh", "application/x-shellscript", "application/pdf", "application/msword", "application/rtf",
        "application/vnd.ms-excel", "application/vnd.ms-powerpoint", "application/onenote",
    ];
    if FILE_MIMES.contains(&mime.as_str()) || mime.starts_with("application/vnd.openxmlformats-officedocument.") || mime.starts_with("application/vnd.ms-") {
        return true;
    }
    matches!(mime.as_str(), "application/octet-stream" | "binary/octet-stream" | "application/x-download" | "application/force-download")
        && sec_fetch_mode.eq_ignore_ascii_case("navigate")
}

/// POSTs the upload body to admin-api's DLP scanner. Fail-open: any
/// transport/parse error is treated as "no verdict" — callers must let
/// the upload proceed rather than block on a scanner hiccup, exactly as
/// the server side (admin-api/dlp-service) also fails open on its own
/// errors.
async fn scan_dlp(client: &AgentClient, meta: &UploadMeta, body: &[u8]) -> Option<DlpVerdict> {
    let query = format!(
        "destination={}&path={}&method={}&content_type={}&filename={}&user_agent={}&sec_fetch_mode={}&sec_fetch_dest={}",
        urlencode(&meta.host),
        urlencode(&meta.path),
        urlencode(&meta.method),
        urlencode(&meta.content_type),
        urlencode(&meta.filename),
        // Lets the server label the incident "app" or "browser" — the
        // requesting client's own User-Agent is the only signal at this
        // layer that separates a native app's upload from a browser tab's.
        urlencode(&meta.user_agent),
        urlencode(&meta.sec_fetch_mode),
        urlencode(&meta.sec_fetch_dest),
    );
    let resp = client.post_bytes(&format!("/internal/agent/scan-dlp?{query}"), "application/octet-stream", body.to_vec()).await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    resp.json().await.ok()
}

fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::casb_cache::Verdict;
    use http_body_util::BodyExt;

    /// An upstream body that arrives in the given chunks.
    struct Chunks(std::collections::VecDeque<&'static [u8]>);

    impl hyper::body::Body for Chunks {
        type Data = Bytes;
        type Error = std::convert::Infallible;
        fn poll_frame(
            mut self: std::pin::Pin<&mut Self>,
            _: &mut std::task::Context<'_>,
        ) -> std::task::Poll<Option<Result<hyper::body::Frame<Bytes>, Self::Error>>> {
            std::task::Poll::Ready(self.0.pop_front().map(|c| Ok(hyper::body::Frame::data(Bytes::from_static(c)))))
        }
    }

    fn download(chunks: &[&'static [u8]], resolve: Resolver) -> ScannedDownload<Chunks> {
        ScannedDownload::new(Chunks(chunks.iter().copied().collect()), Spool::create(), resolve)
    }

    fn deciding(decision: fn() -> Decision) -> Resolver {
        Box::new(move |_| Box::pin(async move { decision() }))
    }

    async fn next(body: &mut ScannedDownload<Chunks>) -> Option<Result<Bytes, String>> {
        body.frame().await.map(|f| f.map(|f| f.into_data().unwrap()).map_err(|e| e.to_string()))
    }

    #[tokio::test]
    async fn test_scanned_download_sees_every_byte_and_relays_them_on_allow() {
        let resolve: Resolver = Box::new(|done: Finished| {
            Box::pin(async move {
                use sha2::Digest;
                assert_eq!(done.size, 9);
                assert_eq!(done.sha256, hex::encode(sha2::Sha256::digest(b"abcdefghi")));
                let spool = done.spool.expect("spooled");
                assert_eq!(std::fs::read(&spool.path).unwrap(), b"abcdefghi");
                Decision::Allow
            })
        });
        let body = download(&[b"abc", b"def", b"ghi"], resolve);
        assert_eq!(&body.collect().await.unwrap().to_bytes()[..], b"abcdefghi");
    }

    #[tokio::test]
    async fn test_scanned_download_streams_early_chunks_and_holds_the_last() {
        let (release, wait) = tokio::sync::oneshot::channel::<()>();
        let wait = std::sync::Mutex::new(Some(wait));
        let resolve: Resolver = Box::new(move |_| {
            let wait = wait.lock().unwrap().take().unwrap();
            Box::pin(async move {
                let _ = wait.await;
                Decision::Allow
            })
        });
        let mut body = download(&[b"one", b"two", b"three"], resolve);
        assert_eq!(next(&mut body).await, Some(Ok(Bytes::from_static(b"one"))));
        assert_eq!(next(&mut body).await, Some(Ok(Bytes::from_static(b"two"))));
        let held = tokio::time::timeout(std::time::Duration::from_millis(200), next(&mut body)).await;
        assert!(held.is_err(), "the final chunk must wait for the verdict");
        release.send(()).unwrap();
        assert_eq!(next(&mut body).await, Some(Ok(Bytes::from_static(b"three"))));
        assert_eq!(next(&mut body).await, None);
    }

    #[tokio::test]
    async fn test_scanned_download_aborts_on_block() {
        let mut body = download(&[b"evil", b"payload"], deciding(|| Decision::Block("Eicar".into())));
        assert_eq!(next(&mut body).await, Some(Ok(Bytes::from_static(b"evil"))));
        assert!(matches!(next(&mut body).await, Some(Err(_))), "a block must end the transfer in an error, never a clean finish");
    }

    #[tokio::test]
    async fn test_spool_is_deleted_once_the_scan_is_done_with_it() {
        let seen = std::sync::Arc::new(std::sync::Mutex::new(None));
        let seen2 = seen.clone();
        let resolve: Resolver = Box::new(move |done: Finished| {
            *seen2.lock().unwrap() = Some(done.spool.as_ref().unwrap().path.clone());
            Box::pin(async move {
                drop(done);
                Decision::Allow
            })
        });
        download(&[b"x"], resolve).collect().await.unwrap();
        let path = seen.lock().unwrap().clone().unwrap();
        assert!(!path.exists(), "spooled copy left behind at {}", path.display());
    }

    #[test]
    fn test_notice_text_cannot_break_out_of_the_script_literal() {
        assert_eq!(notice_text("a\"b\\c'd\ne"), "abcde");
    }

    /// The parts of an ordinary page are never uploaded for scanning.
    #[test]
    fn test_page_parts_are_not_file_downloads() {
        for (ct, path) in [
            ("text/html; charset=utf-8", "/Delphic-Services/delphic-secure"),
            ("text/css", "/assets/app.css"),
            ("application/javascript", "/assets/app.js"),
            ("application/json", "/api/v1/user"),
            ("image/png", "/avatar.png"),
            ("font/woff2", "/f.woff2"),
            ("application/manifest+json", "/manifest.json"),
            ("", "/"),
        ] {
            assert!(!is_file_download("GET", "no-cors", ct, "", path), "{ct} {path} should not be scanned");
        }
    }

    /// The traffic that filled the dashboard with "Download not scanned"
    /// and stalled Cursor once 2.9.6 held responses for a verdict.
    #[test]
    fn test_app_api_traffic_is_not_a_download() {
        for (method, mode, ct, path) in [
            ("POST", "", "application/proto", "/aiserver.v1.AiService/ServerTime"),
            ("POST", "", "application/connect+proto", "/aiserver.v1.ChatService/StreamChat"),
            ("POST", "", "application/octet-stream", "/v4/threatListUpdates:fetch"),
            ("POST", "", "application/x-protobuf", "/v1:GetHints"),
            ("GET", "", "application/octet-stream", "/v1/blob/abc123"),
            ("GET", "cors", "application/octet-stream", "/api/export"),
            ("GET", "", "application/grpc", "/svc/Method"),
        ] {
            assert!(!is_file_download(method, mode, ct, "", path), "{method} {ct} {path} must not be scanned");
        }
    }

    #[test]
    fn test_files_are_file_downloads() {
        assert!(is_file_download("GET", "", "text/plain", "attachment; filename=\"notes.txt\"", "/dl"));
        assert!(is_file_download("POST", "", "text/csv", "attachment; filename=\"statement.csv\"", "/export"));
        assert!(is_file_download("GET", "", "", "", "/releases/setup.EXE"));
        assert!(is_file_download("GET", "", "text/html", "", "/files/report.pdf"));
        assert!(is_file_download("GET", "navigate", "application/octet-stream", "", "/download"));
        assert!(is_file_download("GET", "", "application/zip", "", "/archive"));
        assert!(is_file_download("GET", "", "application/x-apple-diskimage", "", "/get"));
        assert!(is_file_download("GET", "", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "", "/d"));
    }

    #[test]
    fn test_vpn_installers_are_recognised_by_name() {
        assert_eq!(vpn_installer("NordVPN.pkg"), Some("NordVPN"));
        assert_eq!(vpn_installer("ExpressVPN_installer.exe"), Some("ExpressVPN"));
        assert_eq!(vpn_installer("wireguard-installer.msi"), Some("WireGuard"));
        assert_eq!(vpn_installer("proton-vpn-stable.deb"), Some("Proton VPN"));
        // A distinctive product name is caught whatever the extension.
        assert_eq!(vpn_installer("surfshark-portable.zip"), Some("Surfshark"));
        // Generic "vpn" only with an installer extension.
        assert_eq!(vpn_installer("SomeCorpVPN.dmg"), Some("VPN software"));
        assert_eq!(vpn_installer("vpn-setup.exe"), Some("VPN software"));
    }

    #[test]
    fn test_non_vpn_downloads_are_left_alone() {
        assert_eq!(vpn_installer("vpn-setup-guide.pdf"), None); // a document, not an installer
        assert_eq!(vpn_installer("company-handbook.pdf"), None);
        assert_eq!(vpn_installer("slack-desktop.dmg"), None);
        assert_eq!(vpn_installer("report.xlsx"), None);
        assert_eq!(vpn_installer("photo.png"), None);
    }

    #[test]
    fn test_urlencode_leaves_safe_chars_alone() {
        assert_eq!(urlencode("abc123-_.~"), "abc123-_.~");
    }

    #[test]
    fn test_urlencode_escapes_special_chars() {
        assert_eq!(urlencode("a b/c"), "a%20b%2Fc");
    }

    #[test]
    fn test_upload_filename_from_content_disposition() {
        assert_eq!(upload_filename(Some(r#"attachment; filename="report.pdf""#), "/upload"), "report.pdf");
    }

    #[test]
    fn test_upload_filename_falls_back_to_url_path() {
        assert_eq!(upload_filename(None, "/api/upload/report.pdf"), "report.pdf");
        assert_eq!(upload_filename(Some("form-data; name=\"file\""), "/upload"), "upload");
    }

    #[test]
    fn test_upload_filename_handles_single_quotes() {
        assert_eq!(upload_filename(Some("attachment; filename='data.xlsx'"), "/x"), "data.xlsx");
    }

    fn deps_for_verdict_tests() -> (AgentClient, CASBControlCache, EnforcementGate) {
        // admin.invalid is unreachable, so any DLP/malware network call made
        // during these tests fails fast and fails open (None) — exactly
        // what lets these tests isolate CASB's in-memory-cached decision
        // without a real admin-api.
        let client = AgentClient::new(crate::config::test_config(), Default::default());
        let casb = CASBControlCache::new(client.clone());
        (client, casb, EnforcementGate::default())
    }

    /// Regression test for the gap this session found and fixed: CASB
    /// app-control was defined but never actually invoked from either
    /// DLP is monitor-only: even the strongest possible verdict — a CASB
    /// "block" on a known personal-cloud-storage host — must let the upload
    /// through. This is the regression guard on that guarantee, and it is
    /// deliberately the *most* severe input available, because if anything
    /// could still block an upload it would be this.
    #[tokio::test]
    async fn test_casb_block_never_blocks_the_upload() {
        let (client, casb, gate) = deps_for_verdict_tests();
        casb.seed_for_test(
            "drive.google.com",
            "upload",
            Some(Verdict { action: "block".to_string(), category: "CASB App Control".to_string(), reason: "Personal cloud storage blocked".to_string(), matched_rule: "".to_string() }),
        );

        let verdict = upload_verdict(&client, &casb, &gate, &UploadMeta { host: "drive.google.com".into(), path: "/upload".into(), method: "POST".into(), content_type: "".into(), filename: "".into(), user_agent: "".into(), ..Default::default() }, &[]).await;
        assert!(!verdict.blocked, "DLP/CASB must record an upload, never stop it");
        assert!(verdict.reason.is_empty());
    }

    /// CASB's own "allow" (no verdict cached) must not short-circuit the
    /// DLP scan that follows it — the two are sequential gates, not a
    /// choice of one or the other.
    #[tokio::test]
    async fn test_casb_allow_falls_through_to_dlp_scan_attempt() {
        let (client, casb, gate) = deps_for_verdict_tests();
        casb.seed_for_test("uploads.example.com", "upload", None);

        // admin.invalid can't be reached, so the DLP call fails open —
        // this proves the code path *reached* the DLP scan (didn't block
        // or short-circuit on CASB alone) rather than proving a real DLP
        // verdict, which is covered end-to-end by live_integration_test.sh.
        let verdict = upload_verdict(&client, &casb, &gate, &UploadMeta { host: "uploads.example.com".into(), path: "/upload".into(), method: "POST".into(), content_type: "text/plain".into(), filename: "notes.txt".into(), user_agent: "Mozilla/5.0".into(), ..Default::default() }, b"hello").await;
        assert!(!verdict.blocked);
    }

    /// Off-hours (security_only/paused) must skip both CASB and DLP
    /// entirely, not just DLP — app-control is monitoring-adjacent policy,
    /// same enforcement tier as content scanning.
    #[tokio::test]
    async fn test_disabled_enforcement_skips_casb_check_too() {
        let (client, casb, gate) = deps_for_verdict_tests();
        gate.apply(&crate::enforcement::EnforcementPayload { mode: Some("paused".to_string()), active: None, reason: None, until: None, source: None }, None);
        casb.seed_for_test(
            "drive.google.com",
            "upload",
            Some(Verdict { action: "block".to_string(), category: "CASB App Control".to_string(), reason: "Personal cloud storage blocked".to_string(), matched_rule: "".to_string() }),
        );

        let verdict = upload_verdict(&client, &casb, &gate, &UploadMeta { host: "drive.google.com".into(), path: "/upload".into(), method: "POST".into(), content_type: "".into(), filename: "".into(), user_agent: "".into(), ..Default::default() }, b"data").await;
        assert!(!verdict.blocked, "paused mode must not enforce CASB either");
    }
}

#[cfg(test)]
mod upload_meta_tests {
    use super::*;

    #[test]
    fn upload_meta_keeps_query_and_fetch_metadata() {
        let mut h = hyper::HeaderMap::new();
        h.insert("content-type", "application/x-www-form-urlencoded".parse().unwrap());
        h.insert("sec-fetch-mode", "navigate".parse().unwrap());
        h.insert("sec-fetch-dest", "document".parse().unwrap());
        h.insert("user-agent", "Mozilla/5.0 Chrome/128.0".parse().unwrap());
        let m = UploadMeta::from_request("mail.google.com", &hyper::Method::POST, "/mail/u/0/?ik=x&act=sm", &h);
        assert_eq!(m.path, "/mail/u/0/?ik=x&act=sm");
        assert_eq!(m.sec_fetch_mode, "navigate");
        assert_eq!(m.sec_fetch_dest, "document");
        assert_eq!(m.content_type, "application/x-www-form-urlencoded");
        // The filename guess comes from the path, never the query.
        assert_eq!(m.filename, "");
    }
}
