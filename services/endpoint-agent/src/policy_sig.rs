//! Verifies the Ed25519 signature admin-api attaches to every policy bundle
//! (`X-Policy-Signature` / `X-Policy-Key-Id` on `GET /internal/agent/rules`)
//! before `policy_cache.rs` applies it — the agent's half of the contract
//! `services/admin-api/internal/policysig` implements. A bundle that
//! arrived over an authenticated connection has proven who sent it, not
//! that the bytes weren't altered somewhere between the database and this
//! device; the signature is what proves the latter.
//!
//! Trust-on-first-use, deliberately: the public key is fetched once and
//! pinned to disk, the same posture `mitm.rs`'s CA-cert fetch already
//! uses. Re-fetching on every restart would let whoever controls the
//! network path at that exact moment hand a fresh device a different key,
//! silently defeating the point of signing anything at all.

use crate::http_client::AgentClient;
use base64::Engine;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::Deserialize;
use std::path::PathBuf;
use std::sync::RwLock;

const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;

#[derive(Deserialize)]
struct PublicKeyResponse {
    key_id: String,
    public_key: String,
}

pub struct PolicySigVerifier {
    client: AgentClient,
    pinned_path: PathBuf,
    key: RwLock<Option<(String, VerifyingKey)>>,
}

impl PolicySigVerifier {
    pub fn new(client: AgentClient) -> Self {
        let pinned_path = crate::config::state_dir().join("policy-signing-key.pub");
        PolicySigVerifier { client, pinned_path, key: RwLock::new(None) }
    }

    /// A no-op once a key is loaded (from disk or already fetched this
    /// process). Call before every `verify` — cheap when already loaded,
    /// and self-healing if the pinned file is ever missing or corrupt.
    pub async fn ensure_key(&self) {
        if self.key.read().unwrap().is_some() {
            return;
        }
        if let Some(pinned) = self.load_pinned() {
            tracing::info!(key_id = %pinned.0, "loaded pinned policy signing key");
            *self.key.write().unwrap() = Some(pinned);
            return;
        }
        if let Some(fetched) = self.fetch_and_pin().await {
            *self.key.write().unwrap() = Some(fetched);
        }
    }

    fn load_pinned(&self) -> Option<(String, VerifyingKey)> {
        let content = std::fs::read_to_string(&self.pinned_path).ok()?;
        let mut lines = content.lines();
        let key_id = lines.next()?.trim().to_string();
        let pubkey_b64 = lines.next()?.trim();
        parse_key(&key_id, pubkey_b64)
    }

    async fn fetch_and_pin(&self) -> Option<(String, VerifyingKey)> {
        let resp = self.client.get("/internal/agent/policy-public-key").await.ok()?;
        let body: PublicKeyResponse = resp.json().await.ok()?;
        let parsed = parse_key(&body.key_id, &body.public_key)?;

        if let Some(parent) = self.pinned_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Err(e) = std::fs::write(&self.pinned_path, format!("{}\n{}\n", body.key_id, body.public_key)) {
            tracing::warn!(error = %e, "could not persist pinned policy signing key — will re-fetch next restart");
        } else {
            tracing::info!(key_id = %body.key_id, "pinned policy signing public key");
        }
        Some(parsed)
    }

    /// Verifies `body` against the response's signature headers. Every
    /// failure mode — missing headers, an unrecognized key_id, a bad
    /// signature, or no pinned key yet at all — is a hard reject. The
    /// caller (`policy_cache.rs`) must keep whatever rules it already has
    /// cached rather than ever apply an unverified body; fail-closed here,
    /// not fail-open, since this is the integrity check standing between
    /// a compromised transport and a device silently running tampered policy.
    pub fn verify(&self, body: &[u8], sig_b64: Option<&str>, key_id: Option<&str>) -> bool {
        let (Some(sig_b64), Some(key_id)) = (sig_b64, key_id) else {
            tracing::warn!("policy bundle missing signature headers — rejecting");
            return false;
        };
        let guard = self.key.read().unwrap();
        let Some((pinned_id, key)) = guard.as_ref() else {
            tracing::warn!("no pinned policy signing key available yet — rejecting");
            return false;
        };
        if pinned_id != key_id {
            tracing::warn!(pinned = %pinned_id, got = %key_id, "policy signature key_id does not match the pinned key — rejecting");
            return false;
        }
        let Ok(raw_sig) = B64.decode(sig_b64) else {
            tracing::warn!("policy signature is not valid base64 — rejecting");
            return false;
        };
        let Ok(sig_bytes) = <[u8; 64]>::try_from(raw_sig.as_slice()) else {
            tracing::warn!("policy signature is the wrong length — rejecting");
            return false;
        };
        let sig = Signature::from_bytes(&sig_bytes);
        match key.verify(body, &sig) {
            Ok(()) => true,
            Err(_) => {
                tracing::warn!("policy bundle signature does not verify — rejecting (possible tampering)");
                false
            }
        }
    }
}

fn parse_key(key_id: &str, pubkey_b64: &str) -> Option<(String, VerifyingKey)> {
    if key_id.is_empty() {
        return None;
    }
    let raw = B64.decode(pubkey_b64).ok()?;
    let arr = <[u8; 32]>::try_from(raw.as_slice()).ok()?;
    let key = VerifyingKey::from_bytes(&arr).ok()?;
    Some((key_id.to_string(), key))
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    fn verifier_with_key(client: AgentClient, key_id: &str, verifying: VerifyingKey) -> PolicySigVerifier {
        let v = PolicySigVerifier::new(client);
        *v.key.write().unwrap() = Some((key_id.to_string(), verifying));
        v
    }

    fn test_client() -> AgentClient {
        AgentClient::new(crate::config::test_config(), Default::default())
    }

    // ed25519-dalek's `SigningKey::generate` needs a `rand_core`-compatible
    // RNG, and this workspace's `rand = "0.8"` doesn't line up with the
    // version ed25519-dalek pulls in by default — going via raw bytes from
    // `rand::random` sidesteps the trait-version mismatch entirely, and is
    // just as good a source of randomness for test keypairs.
    fn random_signing_key() -> SigningKey {
        SigningKey::from_bytes(&rand::random::<[u8; 32]>())
    }

    #[test]
    fn test_verify_accepts_a_genuine_signature() {
        let signing = random_signing_key();
        let verifying = signing.verifying_key();
        let body = b"{\"rules\":[]}";
        let sig = signing.sign(body);
        let sig_b64 = B64.encode(sig.to_bytes());

        let v = verifier_with_key(test_client(), "kid-1", verifying);
        assert!(v.verify(body, Some(&sig_b64), Some("kid-1")));
    }

    #[test]
    fn test_verify_rejects_tampered_body() {
        let signing = random_signing_key();
        let verifying = signing.verifying_key();
        let sig = signing.sign(b"{\"rules\":[{\"domain\":\"a.com\",\"action\":\"allow\"}]}");
        let sig_b64 = B64.encode(sig.to_bytes());

        let v = verifier_with_key(test_client(), "kid-1", verifying);
        let tampered = b"{\"rules\":[{\"domain\":\"a.com\",\"action\":\"block\"}]}";
        assert!(!v.verify(tampered, Some(&sig_b64), Some("kid-1")));
    }

    #[test]
    fn test_verify_rejects_key_id_mismatch() {
        let signing = random_signing_key();
        let verifying = signing.verifying_key();
        let body = b"{\"rules\":[]}";
        let sig_b64 = B64.encode(signing.sign(body).to_bytes());

        let v = verifier_with_key(test_client(), "kid-1", verifying);
        // A signature genuinely valid under the pinned key, but claiming a
        // different key_id, must still be rejected — this is what protects
        // against a compromised server presenting a *different* key later.
        assert!(!v.verify(body, Some(&sig_b64), Some("kid-DIFFERENT")));
    }

    #[test]
    fn test_verify_rejects_missing_headers() {
        let signing = random_signing_key();
        let v = verifier_with_key(test_client(), "kid-1", signing.verifying_key());
        assert!(!v.verify(b"{}", None, Some("kid-1")));
        assert!(!v.verify(b"{}", Some("sig"), None));
    }

    #[test]
    fn test_verify_rejects_when_no_key_pinned_yet() {
        let v = PolicySigVerifier::new(test_client());
        assert!(!v.verify(b"{}", Some("anything"), Some("kid-1")));
    }

    #[test]
    fn test_verify_rejects_malformed_signature() {
        let signing = random_signing_key();
        let v = verifier_with_key(test_client(), "kid-1", signing.verifying_key());
        assert!(!v.verify(b"{}", Some("not-valid-base64!!!"), Some("kid-1")));
        assert!(!v.verify(b"{}", Some(&B64.encode(b"too-short")), Some("kid-1")));
    }

    #[test]
    fn test_parse_key_rejects_empty_key_id() {
        let signing = random_signing_key();
        let pub_b64 = B64.encode(signing.verifying_key().to_bytes());
        assert!(parse_key("", &pub_b64).is_none());
    }

    #[test]
    fn test_parse_key_roundtrips_a_real_key() {
        let signing = random_signing_key();
        let pub_b64 = B64.encode(signing.verifying_key().to_bytes());
        let (id, key) = parse_key("kid-42", &pub_b64).expect("valid key must parse");
        assert_eq!(id, "kid-42");
        assert_eq!(key, signing.verifying_key());
    }
}
