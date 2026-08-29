//! Request/response models for the scan API — a faithful port of
//! app/schemas.py, including the null-tolerant list/map deserialization.
//!
//! A client that leaves a list empty may serialize it as JSON `null` (Go
//! marshals a nil slice that way). Rejecting that with a 422 is technically
//! correct and practically awful: the caller reads the failure as "service
//! unavailable" and silently downgrades to its fallback scanner, so DLP
//! keeps "working" while quietly doing less. `#[serde(default)]` alone only
//! covers a *missing* field, not a field present with an explicit `null` —
//! `null_as_default` below covers both.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

fn null_as_default<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Default + Deserialize<'de>,
{
    let opt = Option::<T>::deserialize(deserializer)?;
    Ok(opt.unwrap_or_default())
}

#[derive(Debug, Deserialize)]
pub struct CustomPatternIn {
    #[serde(default)]
    pub name: String,
    pub regex: String,
}

fn default_action() -> String {
    "block".to_string()
}
fn default_priority() -> i64 {
    100
}

#[derive(Debug, Deserialize)]
pub struct PolicyIn {
    #[serde(default)]
    pub name: String,
    #[serde(default = "default_action")]
    pub action: String,
    #[serde(default, deserialize_with = "null_as_default")]
    pub detectors: Vec<String>,
    #[serde(default, deserialize_with = "null_as_default")]
    pub keywords: Vec<String>,
    #[serde(default, deserialize_with = "null_as_default")]
    pub custom_patterns: Vec<CustomPatternIn>,
    #[serde(default, deserialize_with = "null_as_default")]
    pub bypass_file_types: Vec<String>,
    #[serde(default, deserialize_with = "null_as_default")]
    pub detector_weights: HashMap<String, i64>,
    #[serde(default)]
    pub block_threshold: Option<i64>,
    #[serde(default)]
    pub alert_threshold: Option<i64>,
    #[serde(default = "default_priority")]
    pub priority: i64,
}

#[derive(Debug, Deserialize)]
pub struct ScanRequest {
    pub org_id: String,
    #[serde(default)]
    pub filename: String,
    #[serde(default)]
    pub content_type: String,
    #[serde(default)]
    pub destination: String,
    /// Exactly one of content_b64 / text is used. content_b64 is what
    /// admin-api forwards (raw upload bytes, base64); text is the inline
    /// path the dashboard "test a sample" tool uses.
    #[serde(default)]
    pub content_b64: Option<String>,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default, deserialize_with = "null_as_default")]
    pub policies: Vec<PolicyIn>,
    /// Detector hits computed outside this service — currently just
    /// ai-service's vision classification of an image extract-service
    /// pulled out of the upload. Each one only counts toward a policy that
    /// has explicitly enabled its `detector` name (ai_visual), exactly
    /// like every built-in detector — see scoring::run_detectors.
    #[serde(default, deserialize_with = "null_as_default")]
    pub external_matches: Vec<ExternalMatchIn>,
}

#[derive(Debug, Deserialize)]
pub struct ExternalMatchIn {
    pub detector: String,
    #[serde(default)]
    pub label: String,
    /// 0-100. The final weight applied is this service's own
    /// policy.weight_for(detector) scaled by confidence/100 — the caller
    /// supplies confidence, not a raw weight, so the policy's configured
    /// weight (and any per-policy override) stays the single source of
    /// truth for "how much does this detector matter" the same way it is
    /// for every regex detector.
    #[serde(default)]
    pub confidence: i64,
    #[serde(default)]
    pub preview: String,
}

#[derive(Debug, Serialize)]
pub struct MatchOut {
    pub detector: String,
    pub label: String,
    pub masked_preview: String,
    pub weight: i64,
}

#[derive(Debug, Serialize)]
pub struct ScanResponse {
    pub scanned: bool,
    pub matched: bool,
    pub score: i64,
    pub band: String,
    pub action: String,
    pub policy_name: String,
    pub reason: String,
    pub detectors: Vec<String>,
    pub matches: Vec<MatchOut>,
    pub thresholds: HashMap<String, i64>,
}

#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub error: String,
}
