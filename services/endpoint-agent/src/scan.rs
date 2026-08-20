//! DLP/malware scan integration — proxies intercepted upload/download
//! bodies to admin-api's `/internal/agent/scan-dlp` and `/v1/scan-file`
//! style relay endpoints, the same contract the Python agent's
//! `_scan_dlp`/`_scan_download` used.

use crate::http_client::AgentClient;
use serde::Deserialize;

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

/// POSTs the upload body to `/internal/agent/scan-dlp?filename=&content_type=&destination=&path=&method=`.
/// Fail-open: any transport/parse error is treated as "no verdict" —
/// callers must let the upload proceed rather than block on a scanner
/// hiccup, exactly as the server side (admin-api/dlp-service) also
/// fails open on its own errors.
pub async fn scan_dlp(client: &AgentClient, destination: &str, path: &str, method: &str, body: &[u8]) -> Option<DlpVerdict> {
    let query = format!("destination={}&path={}&method={}", urlencode(destination), urlencode(path), urlencode(method));
    let resp = client.post_bytes(&format!("/internal/agent/scan-dlp?{query}"), "application/octet-stream", body.to_vec()).await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    resp.json().await.ok()
}

pub async fn scan_malware(client: &AgentClient, destination: &str, path: &str, body: &[u8]) -> Option<MalwareVerdict> {
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

    #[test]
    fn test_urlencode_leaves_safe_chars_alone() {
        assert_eq!(urlencode("abc123-_.~"), "abc123-_.~");
    }

    #[test]
    fn test_urlencode_escapes_special_chars() {
        assert_eq!(urlencode("a b/c"), "a%20b%2Fc");
    }
}
