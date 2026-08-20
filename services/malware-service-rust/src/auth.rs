//! Service-to-service authentication — a faithful port of app/auth.py.
//!
//! admin-api mints a short-TTL, org-bound HMAC token and sends it as
//! `Authorization: Bearer <token>`. This service verifies the signature and
//! expiry and confirms the token's org matches the org the request claims
//! to act for — so a token minted for org A can never be replayed to scan
//! for org B.
//!
//! Token format (all base64url, no padding): v1.<payload>.<sig>
//!   payload = json({"iss":"admin-api","org_id":"<uuid>","exp":<unix_seconds>})
//!   sig     = HMAC_SHA256(payload_bytes, service_secret)

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::time::{SystemTime, UNIX_EPOCH};
use subtle::ConstantTimeEq;

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, PartialEq, Eq)]
pub enum AuthError {
    Missing,
    Malformed,
    Undecodable,
    BadSignature,
    BadPayload,
    Expired,
    OrgMismatch,
}

impl AuthError {
    pub fn message(&self) -> &'static str {
        match self {
            AuthError::Missing => "missing bearer token",
            AuthError::Malformed => "malformed token",
            AuthError::Undecodable => "undecodable token",
            AuthError::BadSignature => "bad signature",
            AuthError::BadPayload => "bad payload",
            AuthError::Expired => "token expired",
            AuthError::OrgMismatch => "token org mismatch",
        }
    }
}

#[derive(Serialize, Deserialize)]
struct TokenPayload {
    iss: String,
    org_id: String,
    exp: i64,
}

fn now_unix() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64
}

/// Test/helper mirror of admin-api's minting — kept here so the test suite
/// can generate valid tokens without standing up the Go service.
pub fn mint_token(org_id: &str, ttl_seconds: i64, secret: &str) -> String {
    let payload = TokenPayload {
        iss: "admin-api".to_string(),
        org_id: org_id.to_string(),
        exp: now_unix() + ttl_seconds,
    };
    // serde_json's default map/struct output is deterministic field order
    // (declaration order) with no extra whitespace, matching Python's
    // json.dumps(..., separators=(",", ":")) byte-for-byte for this shape.
    let payload_bytes = serde_json::to_vec(&payload).unwrap();
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
    mac.update(&payload_bytes);
    let sig = mac.finalize().into_bytes();
    format!(
        "v1.{}.{}",
        URL_SAFE_NO_PAD.encode(&payload_bytes),
        URL_SAFE_NO_PAD.encode(sig)
    )
}

/// Returns Ok(()) unless the bearer token is valid AND bound to
/// expected_org_id.
pub fn verify_token(authorization_header: Option<&str>, expected_org_id: &str, secret: &str, require_auth: bool) -> Result<(), AuthError> {
    if !require_auth {
        return Ok(());
    }

    let header = authorization_header.ok_or(AuthError::Missing)?;
    let token = header.strip_prefix("Bearer ").ok_or(AuthError::Missing)?.trim();

    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 || parts[0] != "v1" {
        return Err(AuthError::Malformed);
    }

    let payload_bytes = URL_SAFE_NO_PAD.decode(parts[1]).map_err(|_| AuthError::Undecodable)?;
    let provided_sig = URL_SAFE_NO_PAD.decode(parts[2]).map_err(|_| AuthError::Undecodable)?;

    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).map_err(|_| AuthError::BadSignature)?;
    mac.update(&payload_bytes);
    let expected_sig = mac.finalize().into_bytes();

    // Constant-time compare — a timing side-channel here would leak how
    // many leading signature bytes an attacker guessed correctly.
    if provided_sig.len() != expected_sig.len() || provided_sig.ct_eq(&expected_sig).unwrap_u8() != 1 {
        return Err(AuthError::BadSignature);
    }

    let payload: TokenPayload = serde_json::from_slice(&payload_bytes).map_err(|_| AuthError::BadPayload)?;

    if payload.exp < now_unix() {
        return Err(AuthError::Expired);
    }
    if payload.org_id != expected_org_id {
        return Err(AuthError::OrgMismatch);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECRET: &str = "test-secret-123";
    const ORG_A: &str = "11111111-1111-1111-1111-111111111111";
    const ORG_B: &str = "22222222-2222-2222-2222-222222222222";

    #[test]
    fn test_valid_token_round_trips() {
        let tok = mint_token(ORG_A, 300, SECRET);
        let header = format!("Bearer {tok}");
        assert!(verify_token(Some(&header), ORG_A, SECRET, true).is_ok());
    }

    #[test]
    fn test_missing_header_rejected() {
        assert_eq!(verify_token(None, ORG_A, SECRET, true), Err(AuthError::Missing));
    }

    #[test]
    fn test_wrong_org_rejected() {
        let tok = mint_token(ORG_B, 300, SECRET);
        let header = format!("Bearer {tok}");
        assert_eq!(verify_token(Some(&header), ORG_A, SECRET, true), Err(AuthError::OrgMismatch));
    }

    #[test]
    fn test_expired_token_rejected() {
        let tok = mint_token(ORG_A, -10, SECRET);
        let header = format!("Bearer {tok}");
        assert_eq!(verify_token(Some(&header), ORG_A, SECRET, true), Err(AuthError::Expired));
    }

    #[test]
    fn test_tampered_signature_rejected() {
        let forged = mint_token(ORG_A, 300, "attacker-guess");
        let header = format!("Bearer {forged}");
        assert_eq!(verify_token(Some(&header), ORG_A, SECRET, true), Err(AuthError::BadSignature));
    }

    #[test]
    fn test_malformed_token_rejected() {
        assert_eq!(verify_token(Some("Bearer not.a.valid.token.shape"), ORG_A, SECRET, true), Err(AuthError::Malformed));
    }

    #[test]
    fn test_auth_disabled_always_passes() {
        assert!(verify_token(None, ORG_A, SECRET, false).is_ok());
    }
}
