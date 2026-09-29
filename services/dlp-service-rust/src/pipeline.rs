//! One intercepted upload, end to end: is it something a person sent
//! (inspect.rs)? If so, what does it contain (extract/ — documents,
//! archives, PDFs, OCR), what do the detectors and the AI classifiers say
//! about each piece (scoring.rs, ai.rs), and what is the single verdict?
//!
//! admin-api only loads the org's policies before this and records the
//! event after it.
//!
//! Extraction is CPU-bound and runs on a blocking thread, streaming items
//! over a bounded channel while this side scores them (and awaits AI calls).
//! A blocking verdict closes the channel, which stops the walk — there is no
//! reason to keep unpacking gigabytes once the answer can't get stronger.

use crate::ai::Ai;
use crate::config::Config;
use crate::extract::{self, Item, Limits};
use crate::inspect::{self, Inspection, Kind, RequestMeta};
use crate::scoring::{self, ExternalMatch, Policy, PolicyResult};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;

/// Labels incidents produced by an `on_unscannable` rule — the same name
/// admin-api gives its built-in automatic policy.
const DEFAULT_POLICY_NAME: &str = "Automatic DLP (default)";

/// A detector window, and how much of the previous window it re-reads so a
/// value straddling the boundary still matches.
const WINDOW: usize = 4 * 1024 * 1024;
const WINDOW_OVERLAP: usize = 64 * 1024;

#[derive(Debug, Clone, Default, Serialize)]
pub struct Verdict {
    pub matched: bool,
    pub score: i64,
    pub band: String,
    pub action: String,
    pub policy_name: String,
    pub detectors: Vec<String>,
    /// "Label: masked preview" per finding — never a raw sensitive value.
    pub previews: Vec<String>,
    pub reason: String,
}

impl Verdict {
    fn from_result(r: PolicyResult) -> Self {
        if !r.matched {
            return Verdict { band: "allow".into(), action: "allow".into(), ..Default::default() };
        }
        let mut detectors: Vec<String> = r.matches.iter().map(|m| m.detector.clone()).collect();
        detectors.sort();
        detectors.dedup();
        let reason = r.matches.first().map(|m| format!("Sensitive company data detected: {}", m.label)).unwrap_or_default();
        Verdict {
            matched: true,
            score: r.score,
            band: r.band,
            action: r.action,
            policy_name: r.policy_name,
            detectors,
            previews: r.matches.iter().map(|m| format!("{}: {}", m.label, m.preview)).collect(),
            reason,
        }
    }

    fn rank(&self) -> i64 {
        match self.action.as_str() {
            "block" => 3,
            "alert" => 2,
            "log" => 1,
            _ => 0,
        }
    }

    /// The stronger of two verdicts: action first, then score; a match
    /// always beats no match.
    fn max(self, other: Verdict) -> Verdict {
        if !other.matched {
            return self;
        }
        if !self.matched || other.rank() > self.rank() || (other.rank() == self.rank() && other.score > self.score) {
            return other;
        }
        self
    }

    fn is_block(&self) -> bool {
        self.action == "block"
    }
}

/// What the caller gets back.
#[derive(Debug, Serialize)]
pub struct Outcome {
    pub inspection: Inspection,
    /// None when the request was not a user action (nothing was scanned).
    pub verdict: Option<Verdict>,
}

pub struct Scanner<'a> {
    pub org_id: &'a str,
    pub policies: &'a [Policy],
    /// Per policy name: `on_unscannable` reason → action.
    pub on_unscannable: &'a HashMap<String, HashMap<String, String>>,
    pub cfg: &'a Config,
    pub ai: Option<&'a Ai>,
}

impl Scanner<'_> {
    fn enabled(&self, detector: &str) -> bool {
        self.policies.iter().any(|p| p.detectors.iter().any(|d| d == detector))
    }

    fn ai_for(&self, detector: &str) -> Option<&Ai> {
        self.ai.filter(|_| self.enabled(detector))
    }

    fn detect(&self, text: &str, filename: &str, mime: &str, external: &[ExternalMatch]) -> Verdict {
        Verdict::from_result(scoring::scan_ext(self.policies, text, filename, mime, self.cfg, external))
    }

    /// Pattern detectors over text of any length, window by window. A block
    /// ends the walk early.
    fn detect_windowed(&self, text: &str, filename: &str, mime: &str) -> Verdict {
        if text.len() <= WINDOW {
            return self.detect(text, filename, mime, &[]);
        }
        let mut worst = Verdict::default();
        let mut start = 0;
        while start < text.len() {
            let mut end = (start + WINDOW).min(text.len());
            while !text.is_char_boundary(end) {
                end -= 1;
            }
            let v = self.detect(&text[start..end], filename, mime, &[]);
            worst = worst.max(v);
            if worst.is_block() || end == text.len() {
                break;
            }
            let mut next = end - WINDOW_OVERLAP.min(end - start);
            while !text.is_char_boundary(next) {
                next -= 1;
            }
            start = next.max(start + 1);
        }
        worst
    }

    /// One piece of text: pattern detectors, then — unless they already
    /// blocked — the AI classifier for the leaks no pattern describes.
    pub async fn scan_text(&self, text: &str, filename: &str, mime: &str) -> Verdict {
        let t1 = self.detect_windowed(text, filename, mime);
        if t1.is_block() || text.trim().is_empty() {
            return t1;
        }
        let Some(ai) = self.ai_for("ai_text") else { return t1 };
        let v = ai.classify_text(self.org_id, text).await;
        if !v.sensitive {
            return t1;
        }
        let label = format!("AI Content Classification: {}", v.categories.join(", "));
        let external = [ExternalMatch { detector: "ai_text".into(), label, confidence: v.confidence, preview: v.evidence }];
        let window = &text[..floor_boundary(text, WINDOW)];
        t1.max(self.detect(window, filename, mime, &external))
    }

    async fn scan_image(&self, img: &extract::ImageItem) -> Verdict {
        let Some(ai) = self.ai_for("ai_visual") else { return Verdict::default() };
        let v = ai.classify_image(self.org_id, &img.jpeg).await;
        if !v.sensitive {
            return Verdict::default();
        }
        let external = [ExternalMatch {
            detector: "ai_visual".into(),
            label: format!("AI Image Classification: {}", v.doc_type),
            confidence: v.confidence,
            preview: v.doc_type.clone(),
        }];
        self.detect("", &img.part, "image/jpeg", &external)
    }

    /// A part that couldn't be inspected counts only if a policy says it
    /// should (`on_unscannable`); the strictest applicable setting wins.
    fn scan_unscannable(&self, u: &extract::Unscannable) -> Verdict {
        let severity = |a: &str| match a {
            "block" => 2,
            "alert" => 1,
            _ => 0,
        };
        let mut action = "allow";
        for p in self.policies {
            if let Some(a) = self.on_unscannable.get(&p.name).and_then(|m| m.get(u.reason)) {
                if severity(a) > severity(action) {
                    action = if a == "block" { "block" } else { "alert" };
                }
            }
        }
        if action == "allow" {
            return Verdict::default();
        }
        Verdict {
            matched: true,
            score: 0,
            band: action.into(),
            action: action.into(),
            policy_name: DEFAULT_POLICY_NAME.into(),
            detectors: vec![format!("unscannable:{}", u.reason)],
            previews: vec![format!("{}: {}", u.part, u.detail)],
            reason: format!(
                "Content at {:?} could not be fully inspected ({}) — organization policy requires {:?} for this content",
                u.part, u.reason, action
            ),
        }
    }

    /// Audio/video: the transcript goes through the same detectors, and the
    /// AI's reading of it counts as `ai_audio`. None when the AI tier or
    /// `ai_audio` is off — the caller then extracts it like any file.
    async fn scan_media(&self, data: &[u8], filename: &str, mime: &str) -> Option<Verdict> {
        let ai = self.ai_for("ai_audio")?;
        let unscannable = |reason: &'static str, detail: String| extract::Unscannable { part: filename.to_string(), reason, detail };
        if data.len() > ai.cfg.audio_max_bytes {
            return Some(self.scan_unscannable(&unscannable("media_too_large", format!("{} bytes exceeds DLP_AUDIO_MAX_BYTES", data.len()))));
        }
        let Some(transcript) = ai.transcribe(self.org_id, data, mime).await else {
            return Some(self.scan_unscannable(&unscannable("media_no_transcript", "speech-to-text produced no usable transcript".into())));
        };
        let t1 = self.detect_windowed(&transcript, filename, "text/plain");
        if t1.is_block() {
            return Some(t1);
        }
        let v = ai.classify_text(self.org_id, &transcript).await;
        if !v.sensitive {
            return Some(t1);
        }
        let label = format!("AI Audio Classification: {}", v.categories.join(", "));
        let external = [ExternalMatch { detector: "ai_audio".into(), label, confidence: v.confidence, preview: v.evidence }];
        let window = &transcript[..floor_boundary(&transcript, WINDOW)];
        Some(t1.max(self.detect(window, filename, "text/plain", &external)))
    }

    /// Everything inside an uploaded file.
    pub async fn scan_file(&self, data: Arc<dyn AsRef<[u8]> + Send + Sync>, filename: &str, content_type: &str, limits: &Limits) -> Verdict {
        if looks_like_media(filename, content_type) {
            if let Some(v) = self.scan_media((*data).as_ref(), filename, content_type).await {
                return v;
            }
        }

        let (tx, mut rx) = tokio::sync::mpsc::channel::<Item>(16);
        let limits = limits.clone();
        let (name, ct) = (filename.to_string(), content_type.to_string());
        let worker = tokio::task::spawn_blocking(move || {
            let bytes: &[u8] = (*data).as_ref();
            let mut emit = |item: Item| tx.blocking_send(item).is_ok();
            let mut ctx = extract::Ctx::new(&limits, bytes.len() as u64, &mut emit);
            extract::extract(bytes, &name, &ct, &mut ctx);
        });

        let mut worst = Verdict::default();
        while let Some(item) = rx.recv().await {
            let v = match &item {
                Item::Segment(s) => self.scan_text(&s.text, &s.filename, &s.mime).await,
                Item::Image(img) => self.scan_image(img).await,
                Item::Unscannable(u) => {
                    tracing::info!(part = %u.part, reason = u.reason, detail = %u.detail, "unscannable part");
                    self.scan_unscannable(u)
                }
            };
            worst = worst.max(v);
            if worst.is_block() {
                break;
            }
        }
        drop(rx);
        let _ = worker.await;
        worst
    }
}

fn floor_boundary(s: &str, max: usize) -> usize {
    let mut i = max.min(s.len());
    while !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

const MEDIA_EXTS: &[&str] = &[
    ".mp3", ".m4a", ".aac", ".wav", ".flac", ".ogg", ".opus", ".oga", ".wma", ".mp4", ".m4v", ".mov", ".webm", ".mkv",
    ".avi", ".flv", ".3gp",
];

pub fn looks_like_media(filename: &str, content_type: &str) -> bool {
    let ct = inspect::mime_of(content_type);
    ct.starts_with("audio/") || ct.starts_with("video/") || {
        let name = filename.to_ascii_lowercase();
        MEDIA_EXTS.iter().any(|e| name.ends_with(e))
    }
}

/// The whole pipeline for one intercepted request.
pub async fn scan_upload(
    meta: &RequestMeta,
    body: Arc<dyn AsRef<[u8]> + Send + Sync>,
    scanner: &Scanner<'_>,
    limits: &Limits,
) -> Outcome {
    let inspection = inspect::inspect(meta, (*body).as_ref());
    if !inspection.relevant {
        return Outcome { inspection, verdict: None };
    }
    let verdict = match inspection.kind {
        Some(Kind::Text) => scanner.scan_text(&inspection.user_text, "", "text/plain").await,
        Some(Kind::File) => {
            // The name a multipart part carries is found by extraction
            // itself; for a raw body, inspect's name (if any) is the file's.
            let name = if inspect::mime_of(&meta.content_type).starts_with("multipart/") { "" } else { inspection.filename.as_str() };
            scanner.scan_file(body.clone(), name, &meta.content_type, limits).await
        }
        None => Verdict::default(),
    };
    Outcome { inspection, verdict: Some(verdict) }
}
