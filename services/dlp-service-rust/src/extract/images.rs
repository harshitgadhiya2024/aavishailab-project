//! Standalone images, and the bytes → ImageItem helper embedded media and
//! rasterised PDF pages share. Every image big enough to hold a document is
//! OCR'd (within budget) and downscaled to a vision-model-sized JPEG for the
//! AI image classifier.
//!
//! OCR runs the `tesseract` binary as a subprocess with a timeout — the
//! process boundary is what keeps a pathological image from blocking or
//! crashing this service, and a missing binary degrades to "no OCR text",
//! never to a failed scan.

use super::{BudgetExceeded, Ctx, ImageItem, Item};
use image::{imageops::FilterType, DynamicImage, GenericImageView};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use wait_timeout::ChildExt;

/// The long edge most vision models tile at, and a JPEG quality that keeps
/// a document photo around 250 KB.
const VISION_LONG_EDGE: u32 = 1568;
const VISION_JPEG_QUALITY: u8 = 80;

/// Which OCR budget an image draws on: embedded/standalone images and
/// scanned PDF pages are counted separately, so one can't starve the other.
#[derive(Clone, Copy, PartialEq)]
pub enum OcrBudget {
    Image,
    Page,
}

pub fn extract(data: &[u8], part: &str, filename: &str, family: &str, ctx: &mut Ctx) -> Result<(), BudgetExceeded> {
    ctx.check_budget(data.len() as u64)?;
    if !ctx.images_budget_remaining() {
        return Ok(());
    }
    let Some(img) = to_image_item(data, part, ctx, OcrBudget::Image) else {
        ctx.emit(Item::unscannable(part, "corrupt", format!("unreadable {family} image")));
        return Ok(());
    };
    ctx.images_emitted += 1;
    let ocr = img.ocr_text.clone();
    if !ctx.emit(Item::Image(img)) {
        return Ok(());
    }
    if !ocr.is_empty() {
        // OCR text goes through the same detectors as any text — a
        // photographed Aadhaar card needs nothing special on that side.
        ctx.emit(Item::segment(part, filename, &format!("image/{family}"), "ocr", ocr));
    }
    Ok(())
}

/// Decodes and prepares one image, or None if it isn't a readable image or
/// is too small to plausibly be a document or ID card.
pub fn to_image_item(data: &[u8], part: &str, ctx: &mut Ctx, budget: OcrBudget) -> Option<ImageItem> {
    let img = image::load_from_memory(data).ok()?;
    let (w, h) = img.dimensions();
    if w < ctx.limits.min_image_dimension || h < ctx.limits.min_image_dimension {
        return None;
    }
    Some(prepare(img, part, ctx, budget))
}

/// `sha256` is of the JPEG handed to the classifier — the same key the
/// vision verdict cache has always used.
pub fn prepare(img: DynamicImage, part: &str, ctx: &mut Ctx, budget: OcrBudget) -> ImageItem {
    let (w, h) = img.dimensions();
    let mut ocr_text = String::new();
    if w >= ctx.limits.min_image_dimension && h >= ctx.limits.min_image_dimension {
        let under_budget = match budget {
            OcrBudget::Page => ctx.ocr_pages < ctx.limits.ocr_max_pages,
            OcrBudget::Image => ctx.ocr_images < ctx.limits.ocr_max_images,
        };
        if ctx.limits.ocr_enabled && under_budget {
            ocr_text = ocr(&img, &ctx.limits.ocr_langs, ctx.limits.ocr_timeout);
            match budget {
                OcrBudget::Page => ctx.ocr_pages += 1,
                OcrBudget::Image => ctx.ocr_images += 1,
            }
        }
    }
    // The vision model gets the same white-backed picture a person sees.
    let img = if img.color().has_alpha() { DynamicImage::ImageRgb8(rgb_on_white(&img)) } else { img };
    let thumb = if w > VISION_LONG_EDGE || h > VISION_LONG_EDGE {
        img.resize(VISION_LONG_EDGE, VISION_LONG_EDGE, FilterType::Lanczos3)
    } else {
        img
    };
    let mut jpeg = Vec::new();
    let _ = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, VISION_JPEG_QUALITY).encode_image(&thumb.to_rgb8());
    ImageItem { part: part.to_string(), sha256: hex::encode(Sha256::digest(&jpeg)), jpeg, w, h, ocr_text }
}

/// Grayscale, stretch contrast, and upscale small images — cheap steps that
/// measurably help Tesseract on phone photos of documents.
fn preprocess(img: &DynamicImage) -> image::GrayImage {
    let mut gray = flatten_on_white(img);
    let (lo, hi) = gray.pixels().fold((255u8, 0u8), |(lo, hi), p| (lo.min(p[0]), hi.max(p[0])));
    if hi > lo {
        let range = (hi - lo) as f32;
        for p in gray.pixels_mut() {
            p[0] = (((p[0] - lo) as f32 / range) * 255.0).round() as u8;
        }
    }
    let (w, h) = gray.dimensions();
    if w > 0 && w < 1000 {
        let scale = 1000.0 / w as f32;
        gray = image::imageops::resize(&gray, 1000, (h as f32 * scale) as u32, FilterType::Lanczos3);
    }
    gray
}

/// Colour with transparency composited onto white.
fn rgb_on_white(img: &DynamicImage) -> image::RgbImage {
    let rgba = img.to_rgba8();
    image::RgbImage::from_fn(rgba.width(), rgba.height(), |x, y| {
        let p = rgba.get_pixel(x, y);
        let a = p[3] as f32 / 255.0;
        let mix = |c: u8| (c as f32 * a + 255.0 * (1.0 - a)).round() as u8;
        image::Rgb([mix(p[0]), mix(p[1]), mix(p[2])])
    })
}

/// Grayscale with transparency composited onto white. Dropping alpha
/// instead turns a transparent screenshot's background black — black text on
/// black, which OCR reads as nothing.
fn flatten_on_white(img: &DynamicImage) -> image::GrayImage {
    if !img.color().has_alpha() {
        return img.to_luma8();
    }
    let rgba = img.to_rgba8();
    image::GrayImage::from_fn(rgba.width(), rgba.height(), |x, y| {
        let p = rgba.get_pixel(x, y);
        let a = p[3] as f32 / 255.0;
        let luma = 0.299 * p[0] as f32 + 0.587 * p[1] as f32 + 0.114 * p[2] as f32;
        image::Luma([(luma * a + 255.0 * (1.0 - a)).round() as u8])
    })
}

static TESSERACT_MISSING_LOGGED: AtomicBool = AtomicBool::new(false);

/// Recognised text, or "" on any failure or timeout.
pub fn ocr(img: &DynamicImage, langs: &str, timeout: Duration) -> String {
    let Ok(tmp) = tempfile::Builder::new().prefix("dlp-ocr-").suffix(".png").tempfile() else { return String::new() };
    if preprocess(img).save_with_format(tmp.path(), image::ImageFormat::Png).is_err() {
        return String::new();
    }
    let child = Command::new("tesseract")
        .arg(tmp.path())
        .arg("stdout")
        .args(["-l", langs, "--oem", "1", "--psm", "3"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .stdin(Stdio::null())
        .spawn();
    let mut child = match child {
        Ok(c) => c,
        Err(e) => {
            // An environment fault fails every OCR identically; say so once,
            // loudly, rather than letting it hide.
            if !TESSERACT_MISSING_LOGGED.swap(true, Ordering::Relaxed) {
                tracing::warn!(error = %e, "tesseract could not be started — image text detection is degraded");
            }
            return String::new();
        }
    };
    // Drain stdout on its own thread: a full pipe would otherwise block the
    // child and turn every large page into a timeout.
    let mut stdout = child.stdout.take();
    let reader = std::thread::spawn(move || {
        let mut s = String::new();
        if let Some(out) = stdout.as_mut() {
            let _ = out.read_to_string(&mut s);
        }
        s
    });
    match child.wait_timeout(timeout) {
        Ok(Some(status)) if status.success() => reader.join().unwrap_or_default().trim().to_string(),
        Ok(Some(_)) => String::new(),
        _ => {
            let _ = child.kill();
            let _ = child.wait();
            tracing::debug!("tesseract timed out after {:?}", timeout);
            String::new()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transparent_background_becomes_white_not_black() {
        let mut img = image::RgbaImage::from_pixel(4, 1, image::Rgba([0, 0, 0, 0]));
        img.put_pixel(0, 0, image::Rgba([0, 0, 0, 255]));
        let g = flatten_on_white(&DynamicImage::ImageRgba8(img));
        assert_eq!(g.get_pixel(0, 0)[0], 0, "opaque black text stays black");
        assert_eq!(g.get_pixel(1, 0)[0], 255, "transparent background becomes white");
    }
}
