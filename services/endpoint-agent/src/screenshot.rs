//! Drives screenshot capture — a port of Python's `ScreenshotCapturer` and
//! `_capture_screen`.
//!
//! Every layer of gating is respected: nothing is captured unless the org
//! enabled screenshots AND the enforcement gate says full protection, so a
//! personal laptop outside working hours — or any device while paused —
//! produces nothing. That check happens on every iteration of the loop
//! below, not once at startup, so a mid-session gate change (working hours
//! ending, an admin flipping the org setting) takes effect within seconds.

use crate::enforcement::EnforcementGate;
use crate::http_client::AgentClient;
use crate::screenshot_config::ScreenshotConfig;
use image::codecs::webp::WebPEncoder;
use image::{DynamicImage, ImageEncoder};
use rand::Rng;
use serde::Serialize;
use serde_json::json;
use std::time::{Duration, SystemTime};

/// Cap on the long edge so a Retina/4K desktop doesn't produce a huge file —
/// the detail needed to see what someone was doing survives 1600px
/// comfortably, matching the Python original's `max_edge`.
const MAX_EDGE: u32 = 1600;

/// How often the loop rechecks the gate while waiting out its randomized
/// interval — frequent enough to notice a mid-wait pause without spinning.
const POLL_INTERVAL: Duration = Duration::from_secs(5);

pub struct ScreenshotCapturer {
    client: AgentClient,
    config: ScreenshotConfig,
    gate: std::sync::Arc<EnforcementGate>,
    activity: crate::activity_monitor::ActivityMonitor,
    session_id: tokio::sync::Mutex<Option<String>>,
    last_capture: tokio::sync::Mutex<SystemTime>,
}

impl ScreenshotCapturer {
    pub fn new(client: AgentClient, config: ScreenshotConfig, gate: std::sync::Arc<EnforcementGate>, activity: crate::activity_monitor::ActivityMonitor) -> Self {
        ScreenshotCapturer { client, config, gate, activity, session_id: tokio::sync::Mutex::new(None), last_capture: tokio::sync::Mutex::new(SystemTime::now()) }
    }

    fn live(&self) -> bool {
        self.config.snapshot().enabled && self.gate.captures_screenshots()
    }

    pub async fn run(self: std::sync::Arc<Self>) {
        loop {
            if !self.live() {
                // Monitoring is off (disabled, paused, or off-hours). Close
                // any open session so the dashboard shows a clean "ended",
                // and idle.
                self.end_session().await;
                tokio::time::sleep(Duration::from_secs(10)).await;
                continue;
            }

            self.start_session().await;

            let cfg = self.config.snapshot();
            let wait_secs = {
                let mut rng = rand::thread_rng();
                rng.gen_range(cfg.min_interval_secs..=cfg.max_interval_secs)
            };
            let mut waited = Duration::ZERO;
            let target = Duration::from_secs(wait_secs);
            let mut broke_early = false;
            while waited < target {
                let step = POLL_INTERVAL.min(target - waited);
                tokio::time::sleep(step).await;
                waited += step;
                if !self.live() {
                    broke_early = true;
                    break;
                }
            }
            if !broke_early {
                self.capture(cfg.blur).await;
            }
        }
    }

    async fn capture(&self, blur: bool) {
        let Some((data, width, height)) = capture_screen(blur) else { return };
        let now = SystemTime::now();
        let mut last = self.last_capture.lock().await;
        let stats = self.activity.snapshot(*last, now);
        *last = now;
        drop(last);

        let session_id = self.session_id.lock().await.clone().unwrap_or_default();
        let interval_start = subtract(now, stats.interval_seconds);

        let mut query = vec![
            ("session_id", session_id),
            ("captured_at", rfc3339(now)),
            ("interval_start", rfc3339(interval_start)),
            ("interval_end", rfc3339(now)),
            ("width", width.to_string()),
            ("height", height.to_string()),
            ("content_type", "image/webp".to_string()),
            ("active_seconds", stats.active_seconds.to_string()),
            ("interval_seconds", stats.interval_seconds.to_string()),
            ("activity_percent", stats.activity_percent.to_string()),
            ("keyboard", stats.keyboard.to_string()),
            ("mouse", stats.mouse.to_string()),
            ("scroll", stats.scroll.to_string()),
        ];
        // What was open at the moment of capture — sent as a query param
        // alongside the rest of the metadata so the body stays exactly the
        // image bytes, the same convention every other agent upload uses.
        let apps = crate::open_apps::names(12);
        if !apps.is_empty() {
            query.push(("open_apps", apps.join(",")));
        }
        let qs = build_query(&query);

        if let Err(e) = self.client.post_bytes(&format!("/internal/agent/screenshot?{qs}"), "application/octet-stream", data).await {
            tracing::debug!(error = %e, "screenshot upload failed");
        }
    }

    async fn start_session(&self) {
        let mut sid = self.session_id.lock().await;
        if sid.is_some() {
            return;
        }
        #[derive(Serialize)]
        struct Req {
            hostname: String,
            started_at: String,
        }
        let body = Req { hostname: self.client.config().hostname.clone(), started_at: rfc3339(SystemTime::now()) };
        match self.client.post_json("/internal/agent/session/start", &body).await {
            Ok(resp) => match resp.json::<serde_json::Value>().await {
                Ok(v) => {
                    *sid = v.get("session_id").and_then(|s| s.as_str()).map(|s| s.to_string());
                    *self.last_capture.lock().await = SystemTime::now();
                    tracing::info!("work session started");
                }
                Err(e) => tracing::debug!(error = %e, "could not parse session/start response"),
            },
            Err(e) => tracing::debug!(error = %e, "could not start session"),
        }
    }

    async fn end_session(&self) {
        let mut sid = self.session_id.lock().await;
        let Some(id) = sid.take() else { return };
        let body = json!({ "session_id": id, "ended_at": rfc3339(SystemTime::now()) });
        if self.client.post_json("/internal/agent/session/end", &body).await.is_ok() {
            tracing::info!("work session ended");
        }
    }
}

/// Percent-encodes and joins query params — reqwest's own URL type would
/// do this, but everything else in this module already builds paths as
/// plain strings for `AgentClient::post_bytes`, so this stays consistent
/// with that rather than pulling in a URL-building step for one call site.
fn build_query(params: &[(&str, String)]) -> String {
    params.iter().map(|(k, v)| format!("{k}={}", percent_encode(v))).collect::<Vec<_>>().join("&")
}

fn percent_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn rfc3339(t: SystemTime) -> String {
    let dt: time::OffsetDateTime = t.into();
    dt.format(&time::format_description::well_known::Rfc3339).unwrap_or_default()
}

fn subtract(t: SystemTime, secs: u64) -> SystemTime {
    t.checked_sub(Duration::from_secs(secs)).unwrap_or(t)
}

/// macOS's real Screen Recording permission API.
///
/// Worth its own module because the obvious alternative — "just try to
/// capture and see what happens" — silently does not work, and shipped
/// for long enough to fill a fleet's screenshot history with wallpaper.
/// Without the permission, macOS does not fail a capture. It returns a
/// picture: the desktop image and the menu bar, with every window
/// belonging to every other app composited out. `capture_image()` returns
/// `Ok`, the encoder encodes it, the upload succeeds, and the dashboard
/// shows a tidy screenshot of a lake at Tahoe taken while the person was
/// in VS Code.
///
/// These two calls are the only way to know the difference.
/// `CGPreflightScreenCaptureAccess` answers without prompting;
/// `CGRequestScreenCaptureAccess` raises the system prompt, once, and is
/// what actually creates the TCC entry — capturing does not, which is why
/// the device that hit this had no TCC record for the agent at all.
#[cfg(target_os = "macos")]
mod screen_permission {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGPreflightScreenCaptureAccess() -> bool;
        fn CGRequestScreenCaptureAccess() -> bool;
    }

    /// Whether the agent may capture other apps' windows. Does not prompt.
    pub fn granted() -> bool {
        // SAFETY: a nullary CoreGraphics predicate returning a C99 _Bool,
        // callable from any thread.
        unsafe { CGPreflightScreenCaptureAccess() }
    }

    /// Raises the system prompt if the answer is not already recorded.
    /// macOS shows it once per app; afterwards this reports the stored
    /// answer without showing anything.
    pub fn request() -> bool {
        // SAFETY: as above.
        unsafe { CGRequestScreenCaptureAccess() }
    }
}

/// True if this device can actually capture its screen.
///
/// Always true off macOS, which has no equivalent gate — a capture there
/// either works or fails honestly.
pub fn screen_capture_permitted() -> bool {
    #[cfg(target_os = "macos")]
    {
        screen_permission::granted()
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

/// Asks for Screen Recording up front rather than leaving it to whenever
/// the capture loop first fires (up to `max_interval_secs` later — see
/// `run` above), so the prompt lands in the moment the person is already
/// expecting permission dialogs, next to the Input Monitoring one
/// `activity_monitor` raises, instead of minutes later and unexplained.
///
/// Safe to call on every start, not only on enrollment. macOS shows the
/// prompt once and answers from its own records after that, and a device
/// enrolled before this existed — or one where the permission was later
/// revoked — has no other moment where it would ever be asked.
pub fn warm_up_permissions() {
    #[cfg(target_os = "macos")]
    {
        if screen_permission::granted() {
            tracing::info!("screen recording permission is granted");
            return;
        }
        if screen_permission::request() {
            tracing::info!("screen recording permission granted at the prompt");
        } else {
            tracing::warn!(
                "screen recording permission is not granted — screenshots are disabled until it is. \
                 Grant it in System Settings › Privacy & Security › Screen & System Audio Recording, \
                 then restart the agent"
            );
        }
    }
}

/// Grabs the primary monitor and returns (webp_bytes, width, height), or
/// `None` if capture isn't available (no permission, headless, no monitor
/// found). The agent simply records nothing rather than crashing, same as
/// the Python original.
fn capture_screen(blur: bool) -> Option<(Vec<u8>, u32, u32)> {
    // Checked before capturing, not after, because there is nothing to
    // check afterwards: a capture taken without Screen Recording succeeds
    // and returns the desktop picture plus the menu bar, with every other
    // app's windows composited out. It is a valid image of the wrong
    // thing, indistinguishable from a real screenshot of an empty desktop,
    // and uploading it is worse than uploading nothing — it reads as
    // evidence that the person was looking at their wallpaper.
    if !screen_capture_permitted() {
        tracing::warn!("skipping screenshot: screen recording permission is not granted");
        return None;
    }
    let monitors = xcap::Monitor::all().ok()?;
    let monitor = monitors.iter().find(|m| m.is_primary().unwrap_or(false)).or_else(|| monitors.first())?;
    let image = monitor.capture_image().ok()?;
    let mut img = DynamicImage::ImageRgba8(image);

    let (width, height) = (img.width(), img.height());
    if width.max(height) > MAX_EDGE {
        let scale = MAX_EDGE as f32 / width.max(height) as f32;
        img = img.resize((width as f32 * scale) as u32, (height as f32 * scale) as u32, image::imageops::FilterType::Lanczos3);
    }
    if blur {
        img = img.blur(8.0);
    }

    let (out_w, out_h) = (img.width(), img.height());
    let rgb = img.to_rgb8();
    let mut buf = Vec::new();
    WebPEncoder::new_lossless(&mut buf).write_image(rgb.as_raw(), out_w, out_h, image::ExtendedColorType::Rgb8).ok()?;
    Some((buf, out_w, out_h))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_subtract_never_underflows_before_unix_epoch() {
        let t = std::time::UNIX_EPOCH;
        // A huge interval subtracted from the epoch must saturate rather
        // than panic — SystemTime has no representable time before it on
        // every platform this agent ships to.
        let result = subtract(t, u64::MAX / 2);
        assert!(result <= SystemTime::now());
    }

    #[test]
    fn test_rfc3339_produces_a_z_suffixed_timestamp() {
        let s = rfc3339(SystemTime::now());
        assert!(s.ends_with('Z'), "expected a Z-suffixed RFC3339 timestamp, got {s:?}");
    }

    /// Actually grabs the screen, rather than only exercising the pure
    /// helpers around it. Every other test in this module can run with no
    /// display at all; this one needs a real (or Xvfb) X server, so it
    /// skips itself — not fails — when `DISPLAY` isn't set, the same
    /// judgment call the rest of this crate makes for hardware it can't
    /// assume CI has. Run explicitly under Xvfb to get real signal:
    /// `Xvfb :99 & DISPLAY=:99 cargo test capture_screen_produces -- --nocapture`.
    #[test]
    fn test_capture_screen_produces_a_decodable_image_when_a_display_is_present() {
        if std::env::var("DISPLAY").is_err() {
            eprintln!("skipping: no DISPLAY — run under Xvfb for real coverage of this path");
            return;
        }
        let Some((data, width, height)) = capture_screen(false) else {
            panic!("DISPLAY was set but capture_screen returned None — capture is broken, not just untested");
        };
        assert!(width > 0 && height > 0, "capture reported a zero dimension: {width}x{height}");
        assert!(!data.is_empty(), "capture produced no bytes");
        // Round-trip through the image crate's own decoder: bytes that
        // merely exist aren't proof of a valid WebP payload.
        let decoded = image::load_from_memory_with_format(&data, image::ImageFormat::WebP).expect("captured bytes must decode as WebP");
        assert_eq!(decoded.width(), width);
        assert_eq!(decoded.height(), height);
    }

    /// Same capture, with blur on — the two code paths (resize threshold
    /// aside) diverge only in whether `DynamicImage::blur` runs, so this
    /// is the one behavioral difference worth its own assertion: a
    /// blurred capture must still decode and must not collapse to an
    /// empty or corrupt payload.
    #[test]
    fn test_capture_screen_with_blur_still_produces_a_decodable_image() {
        if std::env::var("DISPLAY").is_err() {
            eprintln!("skipping: no DISPLAY — run under Xvfb for real coverage of this path");
            return;
        }
        let Some((data, width, height)) = capture_screen(true) else {
            panic!("DISPLAY was set but capture_screen(blur=true) returned None");
        };
        let decoded = image::load_from_memory_with_format(&data, image::ImageFormat::WebP).expect("blurred capture must still decode as WebP");
        assert_eq!((decoded.width(), decoded.height()), (width, height));
    }
}
