//! Weighted DLP scoring + decision banding — a faithful port of
//! app/scoring.py.
//!
//! Detector hits are aggregated into a single 0-100 sensitivity score; the
//! score maps to a band (block / alert / allow) via per-org thresholds
//! (defaults 80 / 50); the band is combined with the policy's own action so
//! that an *alert-only* policy never blocks even on a score of 95.
//!
//! Aggregation is deliberately non-linear: the strongest signal counts
//! fully and each additional hit contributes at a discount, so a bulk leak
//! (many cards) scores higher than a single one without any single
//! detector being able to trivially max the score alone.

use crate::config::Config;
use crate::detectors as d;
use std::collections::HashMap;
use std::collections::HashSet;

/// Extra points when a structured identifier/credential co-occurs with a
/// sensitive keyword — "account number: ... salary" is more clearly a real
/// leak than either signal alone.
const CONTEXT_BONUS: i64 = 10;

/// Fraction each non-dominant match contributes to the aggregate score.
const SECONDARY_WEIGHT: f64 = 0.4;

fn band_severity(band: &str) -> i64 {
    match band {
        "block" => 3,
        "alert" => 2,
        _ => 0,
    }
}
fn action_severity(action: &str) -> i64 {
    match action {
        "block" => 3,
        "alert" => 2,
        "log" => 1,
        _ => 0,
    }
}
fn severity_action(sev: i64) -> &'static str {
    match sev {
        3 => "block",
        2 => "alert",
        1 => "log",
        _ => "allow",
    }
}

#[derive(Clone, Debug, Default)]
pub struct Policy {
    pub name: String,
    /// block | alert | log | allow — the policy's enforcement ceiling.
    pub action: String,
    pub detectors: Vec<String>,
    pub keywords: Vec<String>,
    pub custom_patterns: Vec<d::CustomPattern>,
    pub bypass_file_types: Vec<String>,
    pub detector_weights: HashMap<String, i64>,
    pub block_threshold: Option<i64>,
    pub alert_threshold: Option<i64>,
    pub priority: i64,
}

impl Policy {
    pub fn weight_for(&self, detector: &str) -> i64 {
        self.detector_weights
            .get(detector)
            .copied()
            .unwrap_or_else(|| d::default_weight(detector))
    }

    /// Guards against a mis-configured policy where alert >= block.
    pub fn thresholds(&self, cfg: &Config) -> (i64, i64) {
        let block = self.block_threshold.unwrap_or(cfg.default_block_threshold);
        let mut alert = self.alert_threshold.unwrap_or(cfg.default_alert_threshold);
        if alert >= block {
            alert = (block - 1).max(0);
        }
        (block, alert)
    }
}

#[derive(Clone, Debug)]
pub struct PolicyResult {
    pub matched: bool,
    pub score: i64,
    pub band: String,
    pub action: String,
    pub policy_name: String,
    pub matches: Vec<d::Match>,
    pub block_threshold: i64,
    pub alert_threshold: i64,
}

impl PolicyResult {
    fn empty(name: &str, block_t: i64, alert_t: i64) -> Self {
        PolicyResult {
            matched: false,
            score: 0,
            band: "allow".to_string(),
            action: "allow".to_string(),
            policy_name: name.to_string(),
            matches: Vec::new(),
            block_threshold: block_t,
            alert_threshold: alert_t,
        }
    }
}

pub fn band_for(score: i64, block_t: i64, alert_t: i64) -> &'static str {
    if score >= block_t {
        "block"
    } else if score >= alert_t {
        "alert"
    } else {
        "allow"
    }
}

pub fn aggregate(weights: &[i64], context_combo: bool) -> i64 {
    if weights.is_empty() {
        return 0;
    }
    let mut ordered = weights.to_vec();
    ordered.sort_unstable_by(|a, b| b.cmp(a));
    let mut score = ordered[0] as f64 + SECONDARY_WEIGHT * ordered[1..].iter().sum::<i64>() as f64;
    if context_combo {
        score += CONTEXT_BONUS as f64;
    }
    (score.round() as i64).min(100)
}

fn effective_action(band: &str, policy_action: &str) -> &'static str {
    let band_sev = band_severity(band);
    // An unrecognized policy action defaults to the strictest ceiling
    // (block), matching Python's `_ACTION_SEVERITY.get(policy_action, 3)`.
    let policy_sev = match policy_action {
        "block" => 3,
        "alert" => 2,
        "log" => 1,
        "allow" => 0,
        _ => 3,
    };
    severity_action(band_sev.min(policy_sev))
}

/// A detector hit computed outside this service (currently only
/// ai-service's vision classification). `confidence` (0-100) scales the
/// policy's own weight for `detector` — see ExternalMatchIn's doc comment.
#[derive(Clone, Debug)]
pub struct ExternalMatch {
    pub detector: String,
    pub label: String,
    pub confidence: i64,
    pub preview: String,
}

fn run_detectors(policy: &Policy, text: &str, filename: &str, external: &[ExternalMatch]) -> Vec<d::Match> {
    let mut matches = Vec::new();
    for det in &policy.detectors {
        let w = policy.weight_for(det);
        match det.as_str() {
            d::CREDIT_CARD => matches.extend(d::detect_credit_card(text, w)),
            d::PAN_INDIA => matches.extend(d::detect_pan(text, w)),
            d::AADHAAR => matches.extend(d::detect_aadhaar(text, w)),
            d::AWS_KEY => matches.extend(d::detect_aws_key(text, w)),
            d::GITHUB_TOKEN => matches.extend(d::detect_github_token(text, w)),
            d::GENERIC_API_KEY => matches.extend(d::detect_generic_api_key(text, w)),
            d::SOURCE_CODE => matches.extend(d::detect_source_code(filename, w)),
            _ => {}
        }
    }
    matches.extend(d::detect_keywords(text, &policy.keywords, policy.weight_for(d::KEYWORD)));
    matches.extend(d::detect_custom_patterns(text, &policy.custom_patterns, policy.weight_for(d::CUSTOM_REGEX)));

    for em in external {
        // Only counts toward a policy that has explicitly enabled this
        // detector name — an org that never turned on ai_visual gets no
        // effect from vision calls at all, same as any other detector.
        if !policy.detectors.iter().any(|pd| pd == &em.detector) {
            continue;
        }
        let base_weight = policy.weight_for(&em.detector);
        let confidence = em.confidence.clamp(0, 100);
        let scaled = ((base_weight as f64) * (confidence as f64 / 100.0)).round() as i64;
        if scaled <= 0 {
            continue;
        }
        let label = if em.label.is_empty() { d::builtin_label(&em.detector).to_string() } else { em.label.clone() };
        matches.push(d::Match { detector: em.detector.clone(), label, preview: em.preview.clone(), weight: scaled });
    }

    matches
}

pub fn score_policy(policy: &Policy, text: &str, filename: &str, content_type: &str, cfg: &Config) -> PolicyResult {
    score_policy_ext(policy, text, filename, content_type, cfg, &[])
}

pub fn score_policy_ext(policy: &Policy, text: &str, filename: &str, content_type: &str, cfg: &Config,
                         external: &[ExternalMatch]) -> PolicyResult {
    let (block_t, alert_t) = policy.thresholds(cfg);

    let category = d::file_category(filename, content_type);
    if policy.bypass_file_types.iter().any(|ft| ft.to_lowercase() == category) {
        return PolicyResult::empty(&policy.name, block_t, alert_t);
    }

    let matches = run_detectors(policy, text, filename, external);
    if matches.is_empty() {
        return PolicyResult::empty(&policy.name, block_t, alert_t);
    }

    let detector_kinds: HashSet<&str> = matches.iter().map(|m| m.detector.as_str()).collect();
    let has_structured = detector_kinds.iter().any(|k| d::structured_detectors().contains(k));
    let has_keyword = detector_kinds.contains(d::KEYWORD) || detector_kinds.contains(d::CUSTOM_REGEX);
    let context_combo = has_structured && has_keyword;

    let weights: Vec<i64> = matches.iter().map(|m| m.weight).collect();
    let score = aggregate(&weights, context_combo);
    let band = band_for(score, block_t, alert_t).to_string();
    let action = effective_action(&band, &policy.action).to_string();

    PolicyResult {
        matched: true,
        score,
        band,
        action,
        policy_name: policy.name.clone(),
        matches,
        block_threshold: block_t,
        alert_threshold: alert_t,
    }
}

/// Evaluate content against all enabled DLP policies and return the single
/// most-severe outcome (block beats alert beats log beats allow; ties break
/// on higher score, then lower priority number = higher precedence).
///
/// Unlike naive first-match, this guarantees that if ANY policy would
/// block, the upload is blocked — a stricter, safer default for data loss.
pub fn scan(policies: &[Policy], text: &str, filename: &str, content_type: &str, cfg: &Config) -> PolicyResult {
    scan_ext(policies, text, filename, content_type, cfg, &[])
}

pub fn scan_ext(policies: &[Policy], text: &str, filename: &str, content_type: &str, cfg: &Config,
                 external: &[ExternalMatch]) -> PolicyResult {
    let mut best: Option<PolicyResult> = None;
    let mut best_key: Option<(i64, i64, i64)> = None;

    for policy in policies {
        let result = score_policy_ext(policy, text, filename, content_type, cfg, external);
        if !result.matched {
            continue;
        }
        // Higher action severity wins; then higher score; then lower
        // priority number (negated so "smaller priority = stronger" sorts
        // as larger).
        let key = (action_severity(&result.action), result.score, -policy.priority);
        if best_key.is_none() || Some(key) > best_key {
            best_key = Some(key);
            best = Some(result);
        }
    }

    best.unwrap_or_else(|| PolicyResult::empty("", cfg.default_block_threshold, cfg.default_alert_threshold))
}

// ─── Tests (port of tests/test_scoring.py) ──────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    const CARD: &str = "4242424242424242";
    const AWS: &str = "AKIAIOSFODNN7EXAMPLE";

    fn all_detectors() -> Vec<String> {
        vec![
            d::CREDIT_CARD.to_string(),
            d::PAN_INDIA.to_string(),
            d::AADHAAR.to_string(),
            d::AWS_KEY.to_string(),
            d::GITHUB_TOKEN.to_string(),
            d::GENERIC_API_KEY.to_string(),
            d::SOURCE_CODE.to_string(),
        ]
    }

    fn policy() -> Policy {
        Policy { name: "Default DLP".to_string(), action: "block".to_string(), detectors: all_detectors(), priority: 100, ..Default::default() }
    }

    fn cfg() -> Config {
        Config::for_test("test-secret")
    }

    fn valid_aadhaar() -> String {
        let base11 = "23412341234";
        for dg in '0'..='9' {
            let candidate = format!("{base11}{dg}");
            if d::verhoeff_valid(&candidate) {
                return candidate;
            }
        }
        panic!("no valid Verhoeff check digit found");
    }

    fn scan_text(text: &str, policies: Vec<Policy>) -> PolicyResult {
        scan(&policies, text, "upload.txt", "text/plain", &cfg())
    }

    #[test]
    fn test_clean_content_allows() {
        let r = scan_text("just a normal message with no secrets", vec![policy()]);
        assert!(!r.matched);
        assert_eq!(r.band, "allow");
        assert_eq!(r.action, "allow");
        assert_eq!(r.score, 0);
    }

    #[test]
    fn test_single_credit_card_alerts() {
        let r = scan_text(&format!("my card is {CARD}"), vec![policy()]);
        assert_eq!(r.score, 55);
        assert_eq!(r.band, "alert");
        assert_eq!(r.action, "alert");
    }

    #[test]
    fn test_single_aws_key_blocks() {
        let r = scan_text(&format!("aws secret {AWS}"), vec![policy()]);
        assert_eq!(r.score, 85);
        assert_eq!(r.band, "block");
        assert_eq!(r.action, "block");
    }

    #[test]
    fn test_single_generic_key_alerts() {
        let r = scan_text("api_key: 'aB3xZ9qL2mV8kP1nQ'", vec![policy()]);
        assert_eq!(r.score, 70);
        assert_eq!(r.band, "alert");
    }

    #[test]
    fn test_two_credit_cards_still_alert() {
        // 55 + 0.4*55 = 77 -> alert band
        let r = scan_text(&format!("{CARD} and 4000056655665556"), vec![policy()]);
        assert_eq!(r.score, 77);
        assert_eq!(r.band, "alert");
    }

    #[test]
    fn test_three_credit_cards_block() {
        // 55 + 0.4*(55+55) = 99 -> block band
        let r = scan_text(&format!("{CARD} 4000056655665556 5555555555554444"), vec![policy()]);
        assert_eq!(r.score, 99);
        assert_eq!(r.band, "block");
    }

    #[test]
    fn test_aggregate_caps_at_100() {
        let r = scan_text(&format!("{AWS} AKIA1234567890ABCDEF"), vec![policy()]); // two AWS-shaped
        assert_eq!(r.score, 100);
    }

    #[test]
    fn test_context_bonus_structured_plus_keyword() {
        // card(55) + keyword(25): 55 + 0.4*25 + 10(context) = 75 -> alert
        let mut p = policy();
        p.keywords = vec!["salary".to_string()];
        let r = scan_text(&format!("salary {CARD}"), vec![p]);
        assert_eq!(r.score, 75);
        assert_eq!(r.band, "alert");
    }

    #[test]
    fn test_aadhaar_scores_alert() {
        let r = scan_text(&format!("aadhaar {}", valid_aadhaar()), vec![policy()]);
        assert_eq!(r.score, 55);
        assert_eq!(r.band, "alert");
    }

    #[test]
    fn test_file_type_bypass_allows() {
        let mut p = policy();
        p.bypass_file_types = vec!["image".to_string()];
        let r = scan(&[p], CARD, "photo.png", "image/png", &cfg());
        assert!(!r.matched);
        assert_eq!(r.action, "allow");
    }

    #[test]
    fn test_alert_only_policy_never_blocks() {
        // AWS key scores 85 (block band) but the policy's ceiling is alert.
        let mut p = policy();
        p.action = "alert".to_string();
        let r = scan_text(AWS, vec![p]);
        assert_eq!(r.band, "block");
        assert_eq!(r.action, "alert");
    }

    #[test]
    fn test_log_only_policy_downgrades_to_log() {
        let mut p = policy();
        p.action = "log".to_string();
        let r = scan_text(AWS, vec![p]);
        assert_eq!(r.action, "log");
    }

    #[test]
    fn test_per_org_threshold_override() {
        // Lower the block threshold so a single card (55) now blocks.
        let mut p = policy();
        p.block_threshold = Some(50);
        p.alert_threshold = Some(25);
        let r = scan_text(CARD, vec![p]);
        assert_eq!(r.score, 55);
        assert_eq!(r.band, "block");
    }

    #[test]
    fn test_alert_threshold_above_block_is_clamped() {
        let mut p = policy();
        p.block_threshold = Some(60);
        p.alert_threshold = Some(90);
        let (block, alert) = p.thresholds(&cfg());
        assert!(alert < block);
    }

    #[test]
    fn test_most_severe_policy_wins() {
        let p_alert = Policy { name: "loose".to_string(), action: "alert".to_string(), detectors: vec![d::CREDIT_CARD.to_string()], priority: 100, ..Default::default() };
        let p_block = Policy { name: "strict".to_string(), action: "block".to_string(), detectors: vec![d::AWS_KEY.to_string()], priority: 100, ..Default::default() };
        let r = scan(&[p_alert, p_block], &format!("{CARD} {AWS}"), "u.txt", "text/plain", &cfg());
        assert_eq!(r.action, "block"); // the blocking policy wins over the alerting one
    }

    #[test]
    fn test_detector_weight_override() {
        // Bump keyword weight so a single keyword blocks.
        let mut p = policy();
        p.detectors = vec![];
        p.keywords = vec!["confidential".to_string()];
        p.detector_weights.insert("keyword".to_string(), 90);
        let r = scan_text("confidential", vec![p]);
        assert_eq!(r.score, 90);
        assert_eq!(r.band, "block");
    }

    // ─── external_matches (vision-AI) integration ──────────────────────

    fn vision_match(confidence: i64) -> ExternalMatch {
        ExternalMatch {
            detector: d::AI_VISUAL.to_string(),
            label: "Aadhaar Card (photo)".to_string(),
            confidence,
            preview: "aadhaar_card".to_string(),
        }
    }

    #[test]
    fn test_external_match_ignored_when_detector_not_enabled() {
        let p = policy(); // does not include ai_visual
        let r = scan_ext(&[p], "", "photo.jpg", "image/jpeg", &cfg(), &[vision_match(95)]);
        assert!(!r.matched);
    }

    #[test]
    fn test_external_match_scores_when_detector_enabled() {
        let mut p = policy();
        p.detectors.push(d::AI_VISUAL.to_string());
        let r = scan_ext(&[p], "", "photo.jpg", "image/jpeg", &cfg(), &[vision_match(100)]);
        assert!(r.matched);
        assert_eq!(r.score, 75); // full confidence -> full default AI_VISUAL weight
        assert_eq!(r.band, "alert"); // 75 is >= the 50 alert threshold but < the 80 block one
        assert_eq!(r.matches[0].detector, d::AI_VISUAL);
    }

    #[test]
    fn test_external_match_weight_scales_with_confidence() {
        let mut p = policy();
        p.detectors = vec![d::AI_VISUAL.to_string()];
        let r = scan_ext(&[p], "", "photo.jpg", "image/jpeg", &cfg(), &[vision_match(40)]);
        assert!(r.matched);
        assert_eq!(r.score, 30); // 75 * 0.40 = 30
        assert_eq!(r.band, "allow"); // below the 50 alert threshold
    }

    #[test]
    fn test_external_match_respects_per_policy_weight_override() {
        let mut p = policy();
        p.detectors = vec![d::AI_VISUAL.to_string()];
        p.detector_weights.insert(d::AI_VISUAL.to_string(), 50);
        let r = scan_ext(&[p], "", "photo.jpg", "image/jpeg", &cfg(), &[vision_match(100)]);
        assert_eq!(r.score, 50);
    }

    #[test]
    fn test_external_match_combines_with_text_detectors() {
        // A card number found by regex PLUS a vision hit on the same
        // upload must combine into one aggregate score, exactly like two
        // regex detectors would.
        let mut p = policy();
        p.detectors.push(d::AI_VISUAL.to_string());
        let r = scan_ext(&[p], CARD, "photo.jpg", "image/jpeg", &cfg(), &[vision_match(100)]);
        assert!(r.matched);
        assert!(r.matches.len() >= 2);
        // Dominant (card, 55) + discounted secondary (ai_visual, 75) beats
        // either alone.
        assert!(r.score > 55);
    }

    #[test]
    fn test_zero_confidence_external_match_contributes_nothing() {
        let mut p = policy();
        p.detectors = vec![d::AI_VISUAL.to_string()];
        let r = scan_ext(&[p], "", "photo.jpg", "image/jpeg", &cfg(), &[vision_match(0)]);
        assert!(!r.matched);
    }

    // ─── ai_text / ai_audio use the identical generic external-match path ──

    #[test]
    fn test_ai_text_external_match_scores_when_enabled() {
        let mut p = policy();
        p.detectors = vec![d::AI_TEXT.to_string()];
        let em = ExternalMatch {
            detector: d::AI_TEXT.to_string(),
            label: String::new(), // -> builtin_label
            confidence: 100,
            preview: "salary_data".to_string(),
        };
        let r = scan_ext(&[p], "quarterly compensation review", "salary.docx",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document", &cfg(), &[em]);
        assert!(r.matched);
        assert_eq!(r.score, 70); // full confidence -> full default AI_TEXT weight
        assert_eq!(r.matches[0].detector, d::AI_TEXT);
        assert_eq!(r.matches[0].label, "AI Content Classification");
    }

    #[test]
    fn test_ai_text_ignored_when_detector_not_enabled() {
        let p = policy(); // no ai_text
        let em = ExternalMatch {
            detector: d::AI_TEXT.to_string(),
            label: String::new(),
            confidence: 95,
            preview: "contract".to_string(),
        };
        let r = scan_ext(&[p], "", "x.docx", "text/plain", &cfg(), &[em]);
        assert!(!r.matched);
    }

    #[test]
    fn test_ai_audio_confidence_scales_weight() {
        let mut p = policy();
        p.detectors = vec![d::AI_AUDIO.to_string()];
        let em = ExternalMatch {
            detector: d::AI_AUDIO.to_string(),
            label: String::new(),
            confidence: 50,
            preview: "credentials".to_string(),
        };
        let r = scan_ext(&[p], "", "call.mp3", "audio/mpeg", &cfg(), &[em]);
        assert_eq!(r.score, 30); // 60 * 0.50
    }
}
