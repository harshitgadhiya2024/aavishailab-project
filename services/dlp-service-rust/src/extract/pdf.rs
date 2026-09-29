//! PDF text, and OCR of scanned pages, through pdfium (Chrome's PDF engine;
//! BSD/Apache-licensed — MuPDF is AGPL and can't ship in closed software).
//!
//! Per page: read the text layer; if it is sparse — the signature of a
//! scanned or photographed page that is just an image — render the page and
//! OCR it.
//!
//! pdfium is a shared library loaded at runtime: PDFIUM_LIB_PATH (a file or
//! the directory holding it), else next to the binary, else the system
//! library path. Without it a PDF is reported unscannable rather than
//! silently passed.

use super::{images, BudgetExceeded, Ctx, Item};
use pdfium_render::prelude::*;
use std::sync::OnceLock;

/// The process-wide pdfium binding (it can only be bound once).
pub fn pdfium() -> Option<&'static Pdfium> {
    static PDFIUM: OnceLock<Option<Pdfium>> = OnceLock::new();
    PDFIUM
        .get_or_init(|| {
            let mut candidates = Vec::new();
            if let Ok(p) = std::env::var("PDFIUM_LIB_PATH") {
                let path = std::path::PathBuf::from(&p);
                if path.is_dir() {
                    candidates.push(Pdfium::pdfium_platform_library_name_at_path(&path));
                } else {
                    candidates.push(path);
                }
            }
            if let Some(dir) = std::env::current_exe().ok().and_then(|e| e.parent().map(|p| p.to_path_buf())) {
                candidates.push(Pdfium::pdfium_platform_library_name_at_path(&dir));
            }
            for c in candidates {
                if let Ok(b) = Pdfium::bind_to_library(&c) {
                    return Some(Pdfium::new(b));
                }
            }
            match Pdfium::bind_to_system_library() {
                Ok(b) => Some(Pdfium::new(b)),
                Err(e) => {
                    tracing::warn!(error = %e, "pdfium library not found — PDFs will be reported unscannable");
                    None
                }
            }
        })
        .as_ref()
}

pub fn available() -> bool {
    pdfium().is_some()
}

pub fn extract(data: &[u8], part: &str, filename: &str, ctx: &mut Ctx) -> Result<(), BudgetExceeded> {
    ctx.check_budget(data.len() as u64)?;
    let Some(pdfium) = pdfium() else {
        ctx.emit(Item::unscannable(part, "unsupported_format", "PDF engine unavailable"));
        return Ok(());
    };
    let doc = match pdfium.load_pdf_from_byte_slice(data, None) {
        Ok(d) => d,
        Err(e) => {
            let msg = format!("{e:?}");
            if msg.contains("Password") {
                ctx.emit(Item::unscannable(part, "encrypted_document", msg));
                return Ok(());
            }
            // A PDF too broken to open still gets its readable text scanned
            // rather than becoming a blind spot.
            ctx.emit(Item::unscannable(part, "corrupt", msg));
            let runs = super::ole::printable_runs(data);
            if !runs.trim().is_empty() {
                ctx.emit(Item::segment(part, filename, "application/pdf", "pdf_raw", runs));
            }
            return Ok(());
        }
    };
    for (i, page) in doc.pages().iter().enumerate() {
        if ctx.stopped() {
            break;
        }
        ctx.check_budget(0)?;
        let page_part = format!("{part}!page{}", i + 1);
        let text = page.text().map(|t| t.all()).unwrap_or_default();
        if !text.trim().is_empty() && !ctx.emit(Item::segment(&page_part, filename, "application/pdf", "pdf", text.clone())) {
            break;
        }
        // A real text layer: not a scanned page, nothing to OCR.
        if text.trim().chars().count() >= ctx.limits.ocr_text_threshold {
            continue;
        }
        if !ctx.limits.ocr_enabled || ctx.ocr_pages >= ctx.limits.ocr_max_pages {
            continue;
        }
        let config = PdfRenderConfig::new().scale_page_by_factor(ctx.limits.ocr_dpi as f32 / 72.0);
        let rendered = match page.render_with_config(&config).and_then(|b| b.as_image()) {
            Ok(img) => img,
            Err(e) => {
                ctx.emit(Item::unscannable(&page_part, "corrupt", format!("page render failed: {e:?}")));
                continue;
            }
        };
        let img = images::prepare(rendered, &page_part, ctx, images::OcrBudget::Page);
        let ocr = img.ocr_text.clone();
        if ctx.images_budget_remaining() {
            ctx.images_emitted += 1;
            ctx.emit(Item::Image(img));
        }
        if !ocr.is_empty() {
            ctx.emit(Item::segment(&page_part, filename, "application/pdf", "ocr", ocr));
        }
    }
    Ok(())
}
