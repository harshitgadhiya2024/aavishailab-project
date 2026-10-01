//! Aavishield brand artwork, embedded in the binary.
//!
//! Both PNGs are generated from the brand files in the repo-root `logos/`
//! folder by `packaging/make-icons.py` — regenerate them there rather than
//! editing these by hand. Embedding (instead of reading from disk at
//! runtime) means the tray, window icon and window header can never go
//! missing on a half-finished install or a moved binary.

/// The Aavishield shield mark (the favicon artwork) on a transparent square.
pub const MARK_PNG: &[u8] = include_bytes!("../assets/mark-256.png");

/// The full Aavishield logo with tagline, white wordmark, for the dark window.
pub const LOGO_PNG: &[u8] = include_bytes!("../assets/logo-tagline-dark.png");

/// Decodes `png` to straight RGBA8, optionally resized to `size`x`size`.
/// Returns (pixels, width, height), or None if the bytes don't decode —
/// callers treat branding as optional and carry on without it.
pub fn rgba(png: &[u8], size: Option<u32>) -> Option<(Vec<u8>, u32, u32)> {
    let mut img = image::load_from_memory_with_format(png, image::ImageFormat::Png).ok()?;
    if let Some(s) = size {
        img = img.resize_exact(s, s, image::imageops::FilterType::Lanczos3);
    }
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    Some((rgba.into_raw(), w, h))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_artwork_decodes() {
        let (px, w, h) = rgba(MARK_PNG, None).expect("mark decodes");
        assert_eq!((w, h), (256, 256));
        assert_eq!(px.len(), (w * h * 4) as usize);

        let (_, w, h) = rgba(LOGO_PNG, None).expect("logo decodes");
        // The brand lockup's own canvas is 3:1, margin included (see
        // scripts/brand/sync-logos.py); it must not be cropped or stretched.
        assert_eq!((w, h), (840, 280));

        let (px, w, h) = rgba(MARK_PNG, Some(64)).expect("mark resizes");
        assert_eq!((w, h, px.len()), (64, 64, 64 * 64 * 4));
    }
}
