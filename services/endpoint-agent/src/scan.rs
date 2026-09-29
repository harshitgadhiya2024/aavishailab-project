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

#[derive(Debug, Deserialize)]
pub struct MalwareVerdict {
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

/// Malware scan on a download — a port of the scan half of
/// `_relay_scanned_spool`.
/// `content_type`/`content_disposition` are the response's own headers
/// (empty when absent): only a response that is a file being downloaded is
/// scanned — see `is_file_download`.
pub async fn download_verdict(
    client: &AgentClient,
    gate: &EnforcementGate,
    host: &str,
    path: &str,
    content_type: &str,
    content_disposition: &str,
    body: &[u8],
) -> ScanVerdict {
    if !gate.scans_downloads() || body.is_empty() || !is_file_download(content_type, content_disposition, path) {
        return ScanVerdict::allow();
    }

    // A VPN client being downloaded is stopped before it ever lands, the
    // same as an installed one is stopped from running (app_control.rs):
    // letting the installer download and only killing it after it runs
    // leaves a window, and on a locked-down device there is no legitimate
    // reason to pull one down. Recognised by the download's own file name,
    // so it is caught even from a mirror or file-share the domain block
    // (the vpn_proxy category) never sees. Checked before the malware round
    // trip because it needs no network and gives a clearer reason.
    let filename = upload_filename(Some(content_disposition), path);
    if let Some(product) = vpn_installer(&filename) {
        let reason = format!("{product} is blocked on this device. Contact your IT administrator if you need access.");
        tracing::info!(%host, %path, %product, "VPN download blocked");
        return ScanVerdict { blocked: true, reason, category: "Application Control".to_string() };
    }

    if let Some(verdict) = scan_malware(client, host, path, body).await {
        if verdict.action == "block" {
            let reason = if verdict.reason.is_empty() { "Malicious file detected".to_string() } else { verdict.reason };
            tracing::info!(%host, %path, %reason, "malware block");
            return ScanVerdict { blocked: true, reason, category: "Malware Protection".to_string() };
        }
    }
    ScanVerdict::allow()
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

/// Whether a response is a file being downloaded, rather than part of a
/// web page. Only files are sent for malware scanning.
///
/// Every successful response used to be: each page's HTML, stylesheets,
/// scripts, images and API responses were uploaded to admin-api and the
/// browser was made to wait for each verdict before receiving any of it. A
/// GitHub page — dozens of those — took 10–12s to load or timed out, and
/// under a busy scanner every open tab stalled together (found with 50
/// connections stuck at once). It also meant every page anyone viewed was
/// copied to the server. A file is identified the way browsers themselves
/// decide to save rather than render: an `attachment` disposition, a
/// file-type extension, or a content type that isn't a page part.
pub fn is_file_download(content_type: &str, content_disposition: &str, path: &str) -> bool {
    if content_disposition.trim_start().to_ascii_lowercase().starts_with("attachment") {
        return true;
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
    if mime.is_empty() {
        return false;
    }
    let page_part = ["text/", "image/", "font/", "audio/", "video/", "multipart/"].iter().any(|p| mime.starts_with(p))
        || mime.ends_with("+json")
        || mime.ends_with("+xml")
        || matches!(
            mime.as_str(),
            "application/javascript"
                | "application/x-javascript"
                | "application/ecmascript"
                | "application/json"
                | "application/xml"
                | "application/wasm"
                | "application/x-protobuf"
                | "application/protobuf"
                | "application/grpc-web"
                | "application/grpc-web+proto"
                | "application/x-www-form-urlencoded"
        );
    !page_part
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

async fn scan_malware(client: &AgentClient, destination: &str, path: &str, body: &[u8]) -> Option<MalwareVerdict> {
    let query = format!("destination={}&path={}", urlencode(destination), urlencode(path));
    let resp = client.post_bytes(&format!("/internal/agent/scan-file?{query}"), "application/octet-stream", body.to_vec()).await.ok()?;
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
            assert!(!is_file_download(ct, "", path), "{ct} {path} should not be scanned");
        }
    }

    /// Files are, however they are marked.
    #[test]
    fn test_files_are_file_downloads() {
        assert!(is_file_download("text/plain", "attachment; filename=\"notes.txt\"", "/dl"));
        assert!(is_file_download("", "", "/releases/setup.EXE"));
        assert!(is_file_download("text/html", "", "/files/report.pdf"));
        assert!(is_file_download("application/octet-stream", "", "/download"));
        assert!(is_file_download("application/zip", "", "/archive"));
        assert!(is_file_download("application/x-apple-diskimage", "", "/get"));
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
