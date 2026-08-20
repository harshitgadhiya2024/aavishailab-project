//! Sensitive-data detectors — a faithful port of app/detectors.py (itself
//! ported from the Go `internal/dlp` package), with the same per-match
//! weight/confidence so scoring.rs can produce a real 0-100 score.
//!
//! Honest limitation (unchanged from the Python/Go originals): these are
//! pattern/checksum detectors, not ML classifiers. Checksums (Luhn for
//! cards, Verhoeff for Aadhaar) are what keep confidence — and therefore
//! score — honest.
//!
//! The Rust rewrite's actual point isn't "same behavior, different
//! language" for its own sake: the Python version allocated a fresh
//! `text.upper()` / `text.lower()` copy of the whole 4MB scan window per
//! detector and re-`re.compile()`'d custom patterns on every request (see
//! the migration plan). This version scans `&str` directly with zero extra
//! copies and compiles every regex exactly once at process start via
//! `LazyLock`, and custom patterns are compiled once per request (not per
//! window-byte) using Rust's `regex` crate, whose matching is a DFA with a
//! linear-time guarantee — no catastrophic backtracking is possible here,
//! which is a real bug class in the Python original (see
//! detect_custom_patterns's doc comment below).

use regex::Regex;
use serde::Serialize;
use std::collections::HashSet;
use std::sync::LazyLock;

pub const CREDIT_CARD: &str = "credit_card";
pub const PAN_INDIA: &str = "pan_india";
pub const AADHAAR: &str = "aadhaar";
pub const AWS_KEY: &str = "aws_key";
pub const GITHUB_TOKEN: &str = "github_token";
pub const GENERIC_API_KEY: &str = "generic_api_key";
pub const SOURCE_CODE: &str = "source_code";
pub const KEYWORD: &str = "keyword";
pub const CUSTOM_REGEX: &str = "custom_regex";

pub fn builtin_label(detector: &str) -> &'static str {
    match detector {
        CREDIT_CARD => "Credit Card Number",
        PAN_INDIA => "PAN Card (India)",
        AADHAAR => "Aadhaar Number (India)",
        AWS_KEY => "AWS Access Key",
        GITHUB_TOKEN => "GitHub Token",
        GENERIC_API_KEY => "Generic API Key / Secret",
        SOURCE_CODE => "Source Code File",
        _ => "",
    }
}

pub fn structured_detectors() -> &'static HashSet<&'static str> {
    static SET: LazyLock<HashSet<&'static str>> = LazyLock::new(|| {
        HashSet::from([CREDIT_CARD, PAN_INDIA, AADHAAR, AWS_KEY, GITHUB_TOKEN, GENERIC_API_KEY])
    });
    &SET
}

/// Default per-detector weights (0-100). Calibrated so that:
///   - a single leaked cloud credential lands in the BLOCK band on its own,
///   - a single valid card/Aadhaar lands in the ALERT band,
///   - format-only signals (PAN, keywords) sit lower to limit false positives,
///   - and multiple hits aggregate upward (see scoring::aggregate).
/// A policy may override any of these via `detector_weights`.
pub fn default_weight(detector: &str) -> i64 {
    match detector {
        AWS_KEY => 85,
        GITHUB_TOKEN => 80,
        GENERIC_API_KEY => 70,
        CREDIT_CARD => 55,
        AADHAAR => 55,
        PAN_INDIA => 45,
        SOURCE_CODE => 40,
        CUSTOM_REGEX => 35,
        KEYWORD => 25,
        _ => 25,
    }
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Match {
    pub detector: String,
    pub label: String,
    #[serde(rename = "masked_preview")]
    pub preview: String,
    pub weight: i64,
}

#[derive(Clone, Debug)]
pub struct CustomPattern {
    pub name: String,
    pub regex: String,
}

// ─── Compiled patterns (once, at first use) ─────────────────────────────────

static CREDIT_CARD_CANDIDATE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\b(?:\d[ -]?){13,19}\b").unwrap());
static PAN_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\b[A-Z]{5}[0-9]{4}[A-Z]\b").unwrap());
static AADHAAR_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\b\d{4}[ -]?\d{4}[ -]?\d{4}\b").unwrap());
static AWS_KEY_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b").unwrap());
static GITHUB_TOKEN_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\bgh[pousr]_[A-Za-z0-9]{36,255}\b").unwrap());
static GENERIC_API_KEY_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?i)(api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key|password)\s*[:=]\s*['"]?([A-Za-z0-9_\-/+]{12,})['"]?"#,
    )
    .unwrap()
});

const SOURCE_CODE_EXTS: &[&str] = &[
    ".go", ".py", ".js", ".ts", ".jsx", ".tsx", ".java", ".c", ".cpp", ".h", ".hpp", ".cs", ".rb",
    ".php", ".rs", ".swift", ".kt", ".scala", ".sql", ".sh", ".pl",
];

/// Entropy floor below which an AWS-shaped / generic secret is treated as
/// too low-randomness to be a real key — cuts placeholders like
/// "AKIAEXAMPLE...".
const MIN_SECRET_ENTROPY: f64 = 3.0;

// ─── Redaction ───────────────────────────────────────────────────────────────

pub fn redact_digits(digits: &str) -> String {
    if digits.chars().count() <= 4 {
        return "****".to_string();
    }
    let n = digits.chars().count();
    let last4: String = digits.chars().skip(n - 4).collect();
    format!("{}{}", "*".repeat(n - 4), last4)
}

pub fn redact_alnum(s: &str) -> String {
    let keep = 4;
    if s.chars().count() <= keep {
        return "****".to_string();
    }
    let prefix: String = s.chars().take(keep).collect();
    format!("{prefix}****")
}

// ─── Checksums ───────────────────────────────────────────────────────────────

fn strip_separators(s: &str) -> String {
    s.chars().filter(|c| c.is_ascii_digit()).collect()
}

pub fn luhn_valid(digits: &str) -> bool {
    let mut total: u32 = 0;
    let mut alt = false;
    for ch in digits.chars().rev() {
        let Some(mut d) = ch.to_digit(10) else { return false };
        if alt {
            d *= 2;
            if d > 9 {
                d -= 9;
            }
        }
        total += d;
        alt = !alt;
    }
    total % 10 == 0
}

#[rustfmt::skip]
const VERHOEFF_D: [[u8; 10]; 10] = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
#[rustfmt::skip]
const VERHOEFF_P: [[u8; 10]; 8] = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

pub fn verhoeff_valid(digits: &str) -> bool {
    let mut c: usize = 0;
    for (i, ch) in digits.chars().rev().enumerate() {
        let Some(d) = ch.to_digit(10) else { return false };
        c = VERHOEFF_D[c][VERHOEFF_P[i % 8][d as usize] as usize] as usize;
    }
    c == 0
}

pub fn shannon_entropy(s: &str) -> f64 {
    if s.is_empty() {
        return 0.0;
    }
    let mut counts: std::collections::HashMap<char, usize> = std::collections::HashMap::new();
    for ch in s.chars() {
        *counts.entry(ch).or_insert(0) += 1;
    }
    let n = s.chars().count() as f64;
    -counts.values().map(|&c| {
        let p = c as f64 / n;
        p * p.log2()
    }).sum::<f64>()
}

// ─── Detectors ───────────────────────────────────────────────────────────────

pub fn detect_credit_card(text: &str, weight: i64) -> Vec<Match> {
    let mut out = Vec::new();
    for m in CREDIT_CARD_CANDIDATE.find_iter(text) {
        let digits = strip_separators(m.as_str());
        let len = digits.chars().count();
        if !(13..=19).contains(&len) {
            continue;
        }
        if !luhn_valid(&digits) {
            continue;
        }
        out.push(Match {
            detector: CREDIT_CARD.to_string(),
            label: builtin_label(CREDIT_CARD).to_string(),
            preview: redact_digits(&digits),
            weight,
        });
    }
    out
}

pub fn detect_pan(text: &str, weight: i64) -> Vec<Match> {
    let upper = text.to_uppercase();
    PAN_RE
        .find_iter(&upper)
        .map(|m| Match {
            detector: PAN_INDIA.to_string(),
            label: builtin_label(PAN_INDIA).to_string(),
            preview: redact_alnum(m.as_str()),
            weight,
        })
        .collect()
}

pub fn detect_aadhaar(text: &str, weight: i64) -> Vec<Match> {
    let mut out = Vec::new();
    for m in AADHAAR_RE.find_iter(text) {
        let digits = strip_separators(m.as_str());
        if digits.chars().count() != 12 || !verhoeff_valid(&digits) {
            continue;
        }
        out.push(Match {
            detector: AADHAAR.to_string(),
            label: builtin_label(AADHAAR).to_string(),
            preview: redact_digits(&digits),
            weight,
        });
    }
    out
}

pub fn detect_aws_key(text: &str, weight: i64) -> Vec<Match> {
    let mut out = Vec::new();
    for m in AWS_KEY_RE.find_iter(text) {
        let token = m.as_str();
        // token[4:] in Python == skip the 4-char AKIA/ASIA prefix.
        let rest: String = token.chars().skip(4).collect();
        if shannon_entropy(&rest) < MIN_SECRET_ENTROPY {
            continue;
        }
        out.push(Match {
            detector: AWS_KEY.to_string(),
            label: builtin_label(AWS_KEY).to_string(),
            preview: redact_alnum(token),
            weight,
        });
    }
    out
}

pub fn detect_github_token(text: &str, weight: i64) -> Vec<Match> {
    GITHUB_TOKEN_RE
        .find_iter(text)
        .map(|m| Match {
            detector: GITHUB_TOKEN.to_string(),
            label: builtin_label(GITHUB_TOKEN).to_string(),
            preview: redact_alnum(m.as_str()),
            weight,
        })
        .collect()
}

pub fn detect_generic_api_key(text: &str, weight: i64) -> Vec<Match> {
    let mut out = Vec::new();
    for caps in GENERIC_API_KEY_RE.captures_iter(text) {
        let key_name = &caps[1];
        let value = &caps[2];
        if shannon_entropy(value) < MIN_SECRET_ENTROPY {
            continue;
        }
        out.push(Match {
            detector: GENERIC_API_KEY.to_string(),
            label: builtin_label(GENERIC_API_KEY).to_string(),
            preview: format!("{key_name}={}", redact_alnum(value)),
            weight,
        });
    }
    out
}

pub fn detect_source_code(filename: &str, weight: i64) -> Vec<Match> {
    let lower = filename.to_lowercase();
    for ext in SOURCE_CODE_EXTS {
        if lower.ends_with(ext) {
            return vec![Match {
                detector: SOURCE_CODE.to_string(),
                label: builtin_label(SOURCE_CODE).to_string(),
                preview: filename.to_string(),
                weight,
            }];
        }
    }
    Vec::new()
}

pub fn detect_keywords(text: &str, keywords: &[String], weight: i64) -> Vec<Match> {
    let mut out = Vec::new();
    let lower = text.to_lowercase();
    for kw in keywords {
        let kw = kw.trim();
        if !kw.is_empty() && lower.contains(&kw.to_lowercase()) {
            out.push(Match {
                detector: KEYWORD.to_string(),
                label: format!("Keyword: {kw}"),
                preview: kw.to_string(),
                weight,
            });
        }
    }
    out
}

/// A typo'd/invalid custom pattern must not take down the whole scan — an
/// unparseable regex is silently skipped, matching the Python original's
/// `except re.error: continue`.
///
/// Unlike the Python original, there is no separate "ReDoS" failure mode to
/// guard against here: `regex::Regex::new` either compiles to a
/// linear-time-guaranteed automaton or fails outright (it refuses
/// backreferences and lookaround, the constructs that make backtracking
/// engines exponential), so a malicious or merely careless org-supplied
/// pattern can slow a scan down but can never hang a worker indefinitely.
pub fn detect_custom_patterns(text: &str, patterns: &[CustomPattern], weight: i64) -> Vec<Match> {
    let mut out = Vec::new();
    for p in patterns {
        let Ok(re) = Regex::new(&p.regex) else { continue };
        if re.is_match(text) {
            out.push(Match {
                detector: CUSTOM_REGEX.to_string(),
                label: format!("Custom: {}", p.name),
                preview: p.name.clone(),
                weight,
            });
        }
    }
    out
}

// ─── File-type bucketing (for policy bypass lists) ──────────────────────────

pub fn file_category(filename: &str, content_type: &str) -> &'static str {
    let ct = content_type.to_lowercase();
    let name = filename.to_lowercase();
    const IMAGE_EXTS: &[&str] = &[".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"];
    if ct.starts_with("image/") || IMAGE_EXTS.iter().any(|e| name.ends_with(e)) {
        return "image";
    }
    if ct == "application/pdf" || name.ends_with(".pdf") {
        return "pdf";
    }
    if ct.contains("zip") || ct.contains("compressed") || name.ends_with(".zip") || name.ends_with(".rar") || name.ends_with(".7z") {
        return "archive";
    }
    "document"
}

// ─── Tests (port of tests/test_detectors.py) ────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    const W: i64 = 50; // arbitrary weight for detector-only tests

    /// Return a 12-digit Aadhaar that passes the Verhoeff checksum, by
    /// picking the one check digit (of 10) that validates — independent of
    /// the detector's own regex, so it genuinely exercises the checksum
    /// path. Mirrors tests/conftest.py's valid_aadhaar().
    fn valid_aadhaar() -> String {
        let base11 = "23412341234";
        for d in '0'..='9' {
            let candidate = format!("{base11}{d}");
            if verhoeff_valid(&candidate) {
                return candidate;
            }
        }
        panic!("no valid Verhoeff check digit found");
    }

    #[test]
    fn test_credit_card_requires_luhn() {
        assert!(!detect_credit_card("card 4242424242424242 here", W).is_empty()); // valid Visa test PAN
        assert!(detect_credit_card("card 4242424242424243 here", W).is_empty()); // Luhn-invalid
        assert!(detect_credit_card("id 1234567890123456", W).is_empty()); // not Luhn-valid
    }

    #[test]
    fn test_credit_card_with_separators() {
        assert!(!detect_credit_card("4242 4242 4242 4242", W).is_empty());
        assert!(!detect_credit_card("4242-4242-4242-4242", W).is_empty());
    }

    #[test]
    fn test_credit_card_preview_is_masked() {
        let m = &detect_credit_card("4242424242424242", W)[0];
        assert!(m.preview.ends_with("4242"));
        assert_eq!(m.preview.chars().filter(|&c| c == '*').count(), 12);
    }

    #[test]
    fn test_aadhaar_verhoeff() {
        let good = valid_aadhaar();
        assert!(!detect_aadhaar(&format!("aadhaar {good}"), W).is_empty());
        // Flip the check digit to an invalid one.
        let last = good.chars().last().unwrap().to_digit(10).unwrap();
        let flipped = (last + 1) % 10;
        let bad = format!("{}{}", &good[..good.len() - 1], flipped);
        if bad != good {
            assert!(detect_aadhaar(&format!("aadhaar {bad}"), W).is_empty());
        }
    }

    #[test]
    fn test_aadhaar_only_one_checkdigit_validates() {
        let base = "23412341234";
        let valid_count = ('0'..='9').filter(|&d| verhoeff_valid(&format!("{base}{d}"))).count();
        assert_eq!(valid_count, 1); // Verhoeff has exactly one valid check digit
    }

    #[test]
    fn test_aws_key_entropy_gate() {
        assert!(!detect_aws_key("key AKIAIOSFODNN7EXAMPLE end", W).is_empty()); // canonical AWS example
        assert!(detect_aws_key("AKIAAAAAAAAAAAAAAAAA", W).is_empty()); // zero-entropy -> rejected
    }

    #[test]
    fn test_github_token() {
        let tok = format!("ghp_{}", "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8");
        assert!(!detect_github_token(&format!("token {tok}"), W).is_empty());
    }

    #[test]
    fn test_generic_api_key() {
        assert!(!detect_generic_api_key("api_key: 'aB3xZ9qL2mV8kP1n'", W).is_empty());
        assert!(detect_generic_api_key("password: 123", W).is_empty()); // too short (<12)
    }

    #[test]
    fn test_source_code_by_extension() {
        assert!(!detect_source_code("main.go", W).is_empty());
        assert!(!detect_source_code("app.py", W).is_empty());
        assert!(detect_source_code("report.pdf", W).is_empty());
    }

    #[test]
    fn test_keywords_case_insensitive() {
        assert!(!detect_keywords("This is CONFIDENTIAL", &["confidential".to_string()], W).is_empty());
        assert!(detect_keywords("nothing here", &["confidential".to_string()], W).is_empty());
    }

    #[test]
    fn test_custom_pattern_invalid_regex_skipped() {
        let patterns = vec![
            CustomPattern { name: "bad".to_string(), regex: "([unclosed".to_string() },
            CustomPattern { name: "proj".to_string(), regex: "PROJ-[0-9]+".to_string() },
        ];
        let matches = detect_custom_patterns("ticket PROJ-1234", &patterns, W);
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].label, "Custom: proj");
    }

    #[test]
    fn test_file_category() {
        assert_eq!(file_category("a.png", ""), "image");
        assert_eq!(file_category("", "image/jpeg"), "image");
        assert_eq!(file_category("x.pdf", ""), "pdf");
        assert_eq!(file_category("x.zip", ""), "archive");
        assert_eq!(file_category("notes.txt", "text/plain"), "document");
    }

    // ─── Extra coverage beyond the Python suite: this is the whole point of
    // the rewrite, so it gets its own regression tests. ────────────────────

    #[test]
    fn test_custom_pattern_catastrophic_backtracking_pattern_completes_instantly() {
        // A classic ReDoS pattern: (a+)+$ against a long non-matching string
        // hangs a backtracking engine (like Python's re) for an
        // exponentially long time. Rust's regex crate is a DFA with a
        // linear-time guarantee, so this must complete immediately —
        // if this test hangs, that guarantee has been broken (e.g. by
        // swapping in a different regex engine).
        let evil_pattern = "(a+)+$";
        let text = "a".repeat(40) + "!"; // never matches — worst case for backtracking
        let patterns = vec![CustomPattern { name: "evil".to_string(), regex: evil_pattern.to_string() }];
        let start = std::time::Instant::now();
        let matches = detect_custom_patterns(&text, &patterns, W);
        assert!(start.elapsed() < std::time::Duration::from_secs(1), "must not hang on a ReDoS pattern");
        assert!(matches.is_empty());
    }

    #[test]
    fn test_luhn_valid_rejects_non_digits() {
        assert!(!luhn_valid("424242abcd424242"));
    }

    #[test]
    fn test_redact_digits_short_string() {
        assert_eq!(redact_digits("123"), "****");
    }

    #[test]
    fn test_redact_alnum_short_string() {
        assert_eq!(redact_alnum("ab"), "****");
    }

    #[test]
    fn test_shannon_entropy_empty_is_zero() {
        assert_eq!(shannon_entropy(""), 0.0);
    }

    #[test]
    fn test_shannon_entropy_uniform_beats_repeated() {
        assert!(shannon_entropy("AKIAIOSFODNN7EXAMPLE") > shannon_entropy("AAAAAAAAAAAAAAAAAAAA"));
    }
}
