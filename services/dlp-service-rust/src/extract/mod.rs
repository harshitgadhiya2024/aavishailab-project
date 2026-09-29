//! Deep content extraction: turns an uploaded file — CSV, Excel, JSON,
//! DOCX, PDF, ZIP/TAR/GZ/7z, images, RTF, legacy .doc/.xls/.ppt, Outlook
//! .msg, .eml, multipart form uploads, plain text — into the text segments
//! and images the detectors and AI classifiers actually look at. A card
//! number inside a .docx is invisible to a raw-byte scan: the document is a
//! zip of XML. This unpacks it, recursively, through nested archives and
//! email attachments.
//!
//! Ported from the retired Python extract-service with the same behaviour
//! and the same `unscannable` reasons, so a policy's `on_unscannable`
//! settings mean exactly what they meant before.
//!
//! There is no file-size limit. What is bounded — so a hostile file cannot
//! exhaust CPU or memory — is archive nesting depth, entry count, total
//! decompressed bytes, expansion ratio and a wall-clock deadline. Hitting
//! one yields an explicit `Unscannable` item, never a silent skip.
//!
//! Archive entries are never written to disk under their own name, so a
//! zip-slip entry like "../../etc/passwd" is only ever a display string.

pub mod archive;
pub mod email;
pub mod images;
pub mod ole;
pub mod ooxml;
pub mod pdf;
pub mod rtf;
pub mod sniff;
pub mod text;

use std::time::{Duration, Instant};

/// One thing found inside the content.
#[derive(Debug, Clone)]
pub enum Item {
    /// Text ready for the detectors.
    Segment(Segment),
    /// An image worth classifying (OCR already done, in `ocr_text`).
    Image(ImageItem),
    /// A part that could not be fully inspected, and why.
    Unscannable(Unscannable),
}

#[derive(Debug, Clone)]
pub struct Segment {
    /// Where it came from, e.g. "q3.zip!hr/salary.xlsx!sheet1".
    pub part: String,
    /// The innermost part's own file name — not the outer request's.
    pub filename: String,
    pub mime: String,
    /// "text" | "csv" | "json" | "xlsx" | "docx" | "pdf" | "ocr" | …
    pub source: &'static str,
    pub text: String,
}

#[derive(Debug, Clone)]
pub struct ImageItem {
    pub part: String,
    pub sha256: String,
    /// A vision-model-sized JPEG of the image.
    pub jpeg: Vec<u8>,
    pub w: u32,
    pub h: u32,
    pub ocr_text: String,
}

#[derive(Debug, Clone)]
pub struct Unscannable {
    pub part: String,
    /// encrypted_archive | encrypted_document | extraction_timeout |
    /// unsupported_format | unsupported_archive | too_deep |
    /// too_many_entries | expansion_ratio_exceeded | total_bytes_exceeded |
    /// corrupt
    pub reason: &'static str,
    pub detail: String,
}

impl Item {
    fn unscannable(part: &str, reason: &'static str, detail: impl Into<String>) -> Item {
        Item::Unscannable(Unscannable { part: part.to_string(), reason, detail: detail.into() })
    }

    fn segment(part: &str, filename: &str, mime: &str, source: &'static str, text: String) -> Item {
        Item::Segment(Segment { part: part.to_string(), filename: filename.to_string(), mime: mime.to_string(), source, text })
    }
}

/// Resource bounds for one extraction. Env names match the retired
/// extract-service, so existing deployment settings keep their meaning.
#[derive(Debug, Clone)]
pub struct Limits {
    pub max_depth: usize,
    pub max_entries: usize,
    pub max_expansion_ratio: u64,
    pub max_total_bytes: u64,
    pub deadline: Duration,
    pub ocr_enabled: bool,
    pub ocr_langs: String,
    pub ocr_dpi: u32,
    /// A PDF page with fewer text-layer characters than this is treated as
    /// scanned and OCR'd.
    pub ocr_text_threshold: usize,
    pub ocr_max_pages: usize,
    pub ocr_max_images: usize,
    pub ocr_timeout: Duration,
    pub max_images_returned: usize,
    pub min_image_dimension: u32,
}

impl Default for Limits {
    fn default() -> Self {
        Limits {
            max_depth: 5,
            max_entries: 10_000,
            max_expansion_ratio: 200,
            max_total_bytes: 1024 * 1024 * 1024,
            deadline: Duration::from_secs(120),
            ocr_enabled: true,
            ocr_langs: "eng".to_string(),
            ocr_dpi: 200,
            ocr_text_threshold: 100,
            ocr_max_pages: 200,
            ocr_max_images: 50,
            ocr_timeout: Duration::from_secs(20),
            max_images_returned: 20,
            min_image_dimension: 64,
        }
    }
}

impl Limits {
    pub fn from_env() -> Self {
        let d = Limits::default();
        let n = |k: &str, v: u64| std::env::var(k).ok().and_then(|s| s.parse().ok()).unwrap_or(v);
        Limits {
            max_depth: n("EXTRACT_MAX_DEPTH", d.max_depth as u64) as usize,
            max_entries: n("EXTRACT_MAX_ENTRIES", d.max_entries as u64) as usize,
            max_expansion_ratio: n("EXTRACT_MAX_EXPANSION_RATIO", d.max_expansion_ratio),
            max_total_bytes: n("EXTRACT_MAX_TOTAL_BYTES", d.max_total_bytes),
            deadline: Duration::from_millis(n("EXTRACT_DEFAULT_DEADLINE_MS", 120_000)),
            ocr_enabled: std::env::var("EXTRACT_OCR_DEFAULT")
                .map(|v| !matches!(v.trim().to_ascii_lowercase().as_str(), "0" | "false" | "no" | "off"))
                .unwrap_or(true),
            ocr_langs: std::env::var("EXTRACT_OCR_LANGS").ok().filter(|v| !v.is_empty()).unwrap_or(d.ocr_langs),
            ocr_dpi: n("EXTRACT_OCR_DPI", d.ocr_dpi as u64) as u32,
            ocr_text_threshold: n("EXTRACT_OCR_TEXT_THRESHOLD", d.ocr_text_threshold as u64) as usize,
            ocr_max_pages: n("EXTRACT_OCR_MAX_PAGES", d.ocr_max_pages as u64) as usize,
            ocr_max_images: n("EXTRACT_OCR_MAX_IMAGES", d.ocr_max_images as u64) as usize,
            ocr_timeout: Duration::from_secs(n("EXTRACT_OCR_PER_IMAGE_TIMEOUT_S", 20)),
            max_images_returned: n("EXTRACT_MAX_IMAGES_RETURNED", d.max_images_returned as u64) as usize,
            min_image_dimension: n("EXTRACT_MIN_IMAGE_DIMENSION", d.min_image_dimension as u64) as u32,
        }
    }
}

/// A safety bound was hit; becomes an `Unscannable` for the part in
/// progress.
#[derive(Debug)]
pub struct BudgetExceeded {
    pub reason: &'static str,
    pub detail: String,
}

/// Mutable state for one top-level extraction, shared by every nested
/// extractor so one ceiling covers the whole walk.
pub struct Ctx<'a> {
    pub limits: &'a Limits,
    input_bytes: u64,
    total_decompressed: u64,
    entries_seen: usize,
    pub images_emitted: usize,
    pub ocr_pages: usize,
    pub ocr_images: usize,
    depth: usize,
    deadline_at: Instant,
    /// Receives each item; returns false once the caller wants no more
    /// (a blocking verdict), which stops the walk.
    emit: &'a mut dyn FnMut(Item) -> bool,
    stopped: bool,
}

impl<'a> Ctx<'a> {
    pub fn new(limits: &'a Limits, input_bytes: u64, emit: &'a mut dyn FnMut(Item) -> bool) -> Self {
        Ctx {
            limits,
            input_bytes,
            total_decompressed: 0,
            entries_seen: 0,
            images_emitted: 0,
            ocr_pages: 0,
            ocr_images: 0,
            depth: 0,
            deadline_at: Instant::now() + limits.deadline,
            emit,
            stopped: false,
        }
    }

    /// Sends an item to the caller. Returns false when the walk should stop.
    pub fn emit(&mut self, item: Item) -> bool {
        if self.stopped {
            return false;
        }
        if !(self.emit)(item) {
            self.stopped = true;
        }
        !self.stopped
    }

    pub fn stopped(&self) -> bool {
        self.stopped
    }

    pub fn check_budget(&mut self, added_bytes: u64) -> Result<(), BudgetExceeded> {
        self.entries_seen += 1;
        if self.entries_seen > self.limits.max_entries {
            return Err(BudgetExceeded { reason: "too_many_entries", detail: format!("> {} entries", self.limits.max_entries) });
        }
        self.total_decompressed += added_bytes;
        let total_cap = self.limits.max_total_bytes.max(self.input_bytes.saturating_mul(self.limits.max_expansion_ratio));
        if self.total_decompressed > total_cap {
            return Err(BudgetExceeded { reason: "total_bytes_exceeded", detail: format!("> {total_cap} bytes decompressed") });
        }
        if self.input_bytes > 0 && self.total_decompressed > self.input_bytes.saturating_mul(self.limits.max_expansion_ratio) {
            return Err(BudgetExceeded {
                reason: "expansion_ratio_exceeded",
                detail: format!("> {}x expansion", self.limits.max_expansion_ratio),
            });
        }
        if Instant::now() > self.deadline_at {
            return Err(BudgetExceeded { reason: "extraction_timeout", detail: "global deadline reached".to_string() });
        }
        Ok(())
    }

    pub fn images_budget_remaining(&self) -> bool {
        self.images_emitted < self.limits.max_images_returned
    }

    /// Runs `f` one nesting level deeper, or reports `too_deep`.
    pub fn nested(&mut self, part: &str, f: impl FnOnce(&mut Ctx<'a>)) {
        if self.depth + 1 > self.limits.max_depth {
            let detail = format!("> {} levels of nesting", self.limits.max_depth);
            self.emit(Item::unscannable(part, "too_deep", detail));
            return;
        }
        self.depth += 1;
        f(self);
        self.depth -= 1;
    }
}

/// Emits an `Unscannable` for a budget error. Returns whether to go on.
fn over_budget(ctx: &mut Ctx, part: &str, e: BudgetExceeded) -> bool {
    ctx.emit(Item::unscannable(part, e.reason, e.detail))
}

/// Top-level entry point. multipart/form-data is the one format that can't
/// be sniffed from bytes: its boundary only exists in the declared header.
pub fn extract(data: &[u8], filename: &str, content_type: &str, ctx: &mut Ctx) {
    let root = if filename.is_empty() { "content" } else { filename };
    let ct = crate::inspect::mime_of(content_type);
    if ct == "multipart/form-data" {
        extract_multipart(data, root, content_type, ctx);
        return;
    }
    dispatch(data, root, filename, content_type, ctx);
}

/// Sniffs `data`'s real format and routes it to its extractor. Every
/// recursive extractor (archives, OOXML media, email attachments, multipart
/// parts) comes back through here.
pub fn dispatch(data: &[u8], part: &str, filename: &str, content_type: &str, ctx: &mut Ctx) {
    if ctx.stopped() {
        return;
    }
    if let Err(e) = ctx.check_budget(0) {
        over_budget(ctx, part, e);
        return;
    }
    let family = sniff::sniff_family(&data[..data.len().min(8192)], filename, content_type);
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| run_family(family, data, part, filename, content_type, ctx)));
    match result {
        Ok(Ok(())) => {}
        Ok(Err(e)) => {
            over_budget(ctx, part, e);
        }
        // A parser bug degrades this one part to unscannable; it never takes
        // the whole extraction (or the service) down.
        Err(_) => {
            tracing::warn!(part, family, "extractor panicked");
            ctx.emit(Item::unscannable(part, "corrupt", format!("extractor error (family={family})")));
        }
    }
}

fn run_family(family: &str, data: &[u8], part: &str, filename: &str, content_type: &str, ctx: &mut Ctx) -> Result<(), BudgetExceeded> {
    match family {
        "zip" => match sniff::zip_kind(data) {
            Some(kind) => ooxml::extract(data, part, filename, kind, ctx),
            None => archive::extract_zip(data, part, ctx),
        },
        "gzip" => archive::extract_gzip(data, part, filename, ctx),
        "tar" => archive::extract_tar(data, part, ctx),
        "rar" => {
            ctx.emit(Item::unscannable(part, "unsupported_archive", "RAR archives are not supported"));
            Ok(())
        }
        "7z" => archive::extract_7z(data, part, ctx),
        "pdf" => pdf::extract(data, part, filename, ctx),
        "ole" => ole::extract(data, part, filename, ctx),
        "png" | "jpeg" | "gif" | "bmp" | "webp" | "tiff" => images::extract(data, part, filename, family, ctx),
        "rtf" => rtf::extract(data, part, filename, ctx),
        "eml" | "eml_mbox" => email::extract(data, part, filename, ctx),
        "csv" => text::extract_csv(data, part, filename, content_type, ctx),
        "json" => text::extract_json(data, part, filename, content_type, ctx),
        "urlencoded" => text::extract_urlencoded(data, part, filename, ctx),
        "xml" | "html" => text::extract_xml_or_html(data, part, filename, content_type, ctx),
        "text" => text::extract_text(data, part, filename, content_type, ctx),
        other => {
            ctx.emit(Item::unscannable(part, "unsupported_format", format!("family={other}")));
            Ok(())
        }
    }
}

/// multipart/form-data — what browser upload forms, and Gmail/Slack/Teams
/// attachments, use. Each file part gets exactly the treatment a direct
/// upload of that file would, under its own real name. Plain form fields
/// are scanned only when a person could have written them — the same rule
/// the text path uses, so a csrf token next to the file is not a finding.
fn extract_multipart(data: &[u8], part: &str, content_type: &str, ctx: &mut Ctx) {
    let Some(boundary) = crate::inspect::multipart_boundary(content_type) else {
        ctx.emit(Item::unscannable(part, "corrupt", "multipart boundary missing"));
        return;
    };
    let parts = crate::inspect::multipart_parts(data, &boundary);
    if parts.is_empty() {
        ctx.emit(Item::unscannable(part, "corrupt", "multipart boundary parse failed"));
        return;
    }
    for (i, p) in parts.into_iter().enumerate() {
        if ctx.stopped() {
            return;
        }
        if let Err(e) = ctx.check_budget(p.data.len() as u64) {
            over_budget(ctx, part, e);
            return;
        }
        match p.filename.as_deref() {
            Some(name) => {
                let name = if name.is_empty() { "blob" } else { name };
                let sub_part = format!("{part}!{name}");
                let mime = crate::inspect::mime_of(&p.content_type);
                ctx.nested(&sub_part, |c| dispatch(p.data, &sub_part, name, &mime, c));
            }
            None => {
                let field = if p.name.is_empty() { format!("field{i}") } else { p.name.clone() };
                let raw = text::decode_best_effort(p.data);
                let written = crate::inspect::user_text_of_field(&field, &raw);
                if !written.trim().is_empty() {
                    ctx.emit(Item::segment(&format!("{part}!{field}"), &field, "text/plain", "multipart_field", written));
                }
            }
        }
    }
}
