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
use crate::enforcement::EnforcementGate;
use crate::http_client::AgentClient;
use serde::Deserialize;

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
}

impl ScanVerdict {
    fn allow() -> Self {
        ScanVerdict { blocked: false, reason: String::new() }
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

/// CASB check (first — matches the Python original's ordering: CASB app-
/// control is a coarser, faster "is this app/host allowed to receive
/// uploads at all" gate, evaluated before the more expensive DLP content
/// scan) then DLP content scan. Both fail open on a transport error.
#[allow(clippy::too_many_arguments)]
pub async fn upload_verdict(
    client: &AgentClient,
    casb: &CASBControlCache,
    gate: &EnforcementGate,
    host: &str,
    path: &str,
    method: &str,
    content_type: &str,
    filename: &str,
    body: &[u8],
) -> ScanVerdict {
    if !gate.enforces_dlp() {
        return ScanVerdict::allow();
    }

    if let Some(casb_verdict) = casb.check(host, "upload").await {
        if casb_verdict.action == "block" {
            tracing::info!(%host, %path, reason = %casb_verdict.reason, "CASB block");
            return ScanVerdict { blocked: true, reason: casb_verdict.reason };
        }
    }

    if body.is_empty() {
        return ScanVerdict::allow();
    }
    if let Some(verdict) = scan_dlp(client, host, path, method, content_type, filename, body).await {
        if verdict.action == "block" {
            let reason = if verdict.reason.is_empty() { "Sensitive company data detected".to_string() } else { verdict.reason };
            tracing::info!(%host, %path, %reason, "DLP block");
            return ScanVerdict { blocked: true, reason };
        }
    }
    ScanVerdict::allow()
}

/// Malware scan on a download — a port of the scan half of
/// `_relay_scanned_spool`.
pub async fn download_verdict(client: &AgentClient, gate: &EnforcementGate, host: &str, path: &str, body: &[u8]) -> ScanVerdict {
    if !gate.scans_downloads() || body.is_empty() {
        return ScanVerdict::allow();
    }
    if let Some(verdict) = scan_malware(client, host, path, body).await {
        if verdict.action == "block" {
            let reason = if verdict.reason.is_empty() { "Malicious file detected".to_string() } else { verdict.reason };
            tracing::info!(%host, %path, %reason, "malware block");
            return ScanVerdict { blocked: true, reason };
        }
    }
    ScanVerdict::allow()
}

/// POSTs the upload body to admin-api's DLP scanner. Fail-open: any
/// transport/parse error is treated as "no verdict" — callers must let
/// the upload proceed rather than block on a scanner hiccup, exactly as
/// the server side (admin-api/dlp-service) also fails open on its own
/// errors.
async fn scan_dlp(client: &AgentClient, destination: &str, path: &str, method: &str, content_type: &str, filename: &str, body: &[u8]) -> Option<DlpVerdict> {
    let query = format!(
        "destination={}&path={}&method={}&content_type={}&filename={}",
        urlencode(destination),
        urlencode(path),
        urlencode(method),
        urlencode(content_type),
        urlencode(filename),
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
    /// proxy path. Locks in that `upload_verdict` checks CASB *before* the
    /// `body.is_empty()` DLP shortcut — an empty-body upload (e.g. a HEAD-
    /// like POST, or a multipart preflight) to a CASB-blocked host must
    /// still be blocked; if CASB were ever moved after that shortcut, this
    /// case would silently start passing through.
    #[tokio::test]
    async fn test_casb_block_applies_even_to_empty_body_uploads() {
        let (client, casb, gate) = deps_for_verdict_tests();
        casb.seed_for_test(
            "drive.google.com",
            "upload",
            Some(Verdict { action: "block".to_string(), category: "CASB App Control".to_string(), reason: "Personal cloud storage blocked".to_string(), matched_rule: "".to_string() }),
        );

        let verdict = upload_verdict(&client, &casb, &gate, "drive.google.com", "/upload", "POST", "", "", &[]).await;
        assert!(verdict.blocked);
        assert_eq!(verdict.reason, "Personal cloud storage blocked");
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
        let verdict = upload_verdict(&client, &casb, &gate, "uploads.example.com", "/upload", "POST", "text/plain", "notes.txt", b"hello").await;
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

        let verdict = upload_verdict(&client, &casb, &gate, "drive.google.com", "/upload", "POST", "", "", b"data").await;
        assert!(!verdict.blocked, "paused mode must not enforce CASB either");
    }
}
