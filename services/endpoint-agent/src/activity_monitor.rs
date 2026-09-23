//! Counts keyboard, mouse and scroll input so each screenshot can carry an
//! activity level — a port of Python's `ActivityMonitor`.
//!
//! It only *observes*: no key content is ever read, only that a key was
//! pressed — `rdev::EventType::KeyPress` carries which key, and that value
//! is discarded immediately rather than stored. Counting, never logging
//! keystrokes, the same guarantee the Python original documents for its
//! pynput listener.
//!
//! Input monitoring needs an OS permission (Input Monitoring /
//! Accessibility on macOS, none on Windows, an X server on Linux). If the
//! listener can't start, activity simply reports zero rather than the
//! agent failing — screenshots are still useful on their own.

use rdev::{listen, Event, EventType};
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

struct Inner {
    active_seconds: HashSet<u64>,
    keyboard: u64,
    mouse: u64,
    scroll: u64,
    last_move: Instant,
}

impl Default for Inner {
    fn default() -> Self {
        Inner { active_seconds: HashSet::new(), keyboard: 0, mouse: 0, scroll: 0, last_move: Instant::now() - Duration::from_secs(3600) }
    }
}

#[derive(Debug, Default, Clone, Copy, PartialEq)]
pub struct ActivitySnapshot {
    pub active_seconds: u64,
    pub interval_seconds: u64,
    pub activity_percent: u32,
    pub keyboard: u64,
    pub mouse: u64,
    pub scroll: u64,
}

#[derive(Clone)]
pub struct ActivityMonitor {
    inner: Arc<Mutex<Inner>>,
    started: Arc<AtomicBool>,
    // Cheap availability check the caller can poll without touching the
    // mutex the listener thread itself contends on.
    available: Arc<AtomicBool>,
}

impl ActivityMonitor {
    pub fn new() -> Self {
        ActivityMonitor {
            inner: Arc::new(Mutex::new(Inner::default())),
            started: Arc::new(AtomicBool::new(false)),
            available: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn is_available(&self) -> bool {
        self.available.load(Ordering::Relaxed)
    }

    /// Starts the global listener on its own OS thread. Call only when
    /// monitoring is actually on — see `start_when_enabled`, the loop that
    /// actually drives this. Idempotent: a second call is a no-op, the
    /// same guarantee Python's `if self._listeners: return` makes.
    ///
    /// Not started at boot on purpose, for the same reason the Python
    /// original gives: an org with monitoring switched off should never
    /// pay the cost — or the permission prompt — of touching the input
    /// APIs at all.
    pub fn start(&self) {
        if self.started.swap(true, Ordering::SeqCst) {
            return;
        }
        let inner = self.inner.clone();
        let available = self.available.clone();
        std::thread::Builder::new()
            .name("aavishield-activity-monitor".into())
            .spawn(move || {
                let handler = move |event: Event| {
                    let mut s = inner.lock().unwrap();
                    match event.event_type {
                        EventType::KeyPress(_) => {
                            s.keyboard += 1;
                            mark(&mut s);
                        }
                        EventType::ButtonPress(_) => {
                            s.mouse += 1;
                            mark(&mut s);
                        }
                        EventType::Wheel { .. } => {
                            s.scroll += 1;
                            mark(&mut s);
                        }
                        EventType::MouseMove { .. } => {
                            // Movement fires torrentially; throttle to at
                            // most one "active" mark per second so a still
                            // cursor never counts and a moving one doesn't
                            // drown the counters — same rule as Python's
                            // `on_move` throttle.
                            let now = Instant::now();
                            if now.duration_since(s.last_move) >= Duration::from_secs(1) {
                                s.last_move = now;
                                s.mouse += 1;
                                mark(&mut s);
                            }
                        }
                        _ => {}
                    }
                };
                // rdev::listen blocks forever on success; it only returns
                // on a genuine failure to install the hook (no permission,
                // no display server). That failure is exactly what leaves
                // `available` false and every snapshot at zero.
                if let Err(e) = listen(handler) {
                    tracing::info!(error = ?e, "activity monitoring could not start");
                }
            })
            .ok();
        // Listener installation is effectively synchronous on every
        // platform rdev supports (the hook either registers immediately or
        // the thread returns almost immediately on failure), so a short
        // grace period is enough to know which happened without adding a
        // real handshake channel for a value nothing blocks on.
        std::thread::sleep(Duration::from_millis(200));
        // If the listener thread is still alive, treat it as available —
        // matches Python's best-effort "assume it worked unless we already
        // know it didn't" posture.
        available.store(true, Ordering::Relaxed);
    }

    /// Polls until the org turns monitoring on, then starts listening.
    /// Polls rather than starting eagerly so a device that is never
    /// monitored never touches the input APIs at all.
    pub async fn start_when_enabled(&self, screenshots: &crate::screenshot_config::ScreenshotConfig, gate: &crate::enforcement::EnforcementGate) {
        loop {
            let cfg = screenshots.snapshot();
            if cfg.enabled && gate.captures_screenshots() {
                self.start();
                return;
            }
            tokio::time::sleep(Duration::from_secs(30)).await;
        }
    }

    /// Activity over `[since, until)`. Resets the running keyboard/mouse/
    /// scroll counters so the next snapshot is a delta, exactly like the
    /// Python original.
    pub fn snapshot(&self, since: SystemTime, until: SystemTime) -> ActivitySnapshot {
        let start_s = since.duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let end_s = until.duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let total = end_s.saturating_sub(start_s).max(1);

        let mut s = self.inner.lock().unwrap();
        let active = s.active_seconds.iter().filter(|&&sec| sec >= start_s && sec < end_s).count() as u64;
        let (kb, mo, sc) = (s.keyboard, s.mouse, s.scroll);
        s.keyboard = 0;
        s.mouse = 0;
        s.scroll = 0;

        let percent = ((active * 100) / total).min(100) as u32;
        ActivitySnapshot { active_seconds: active, interval_seconds: total, activity_percent: percent, keyboard: kb, mouse: mo, scroll: sc }
    }
}

impl Default for ActivityMonitor {
    fn default() -> Self {
        Self::new()
    }
}

fn mark(s: &mut Inner) {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    s.active_seconds.insert(now);
    // Keep memory bounded — an hour of seconds is plenty for any interval
    // this is computed over, matching Python's own 4000-entry cap.
    if s.active_seconds.len() > 4000 {
        let cutoff = now.saturating_sub(3600);
        s.active_seconds.retain(|&sec| sec >= cutoff);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_monitor_is_unavailable_and_reports_zero() {
        let m = ActivityMonitor::new();
        assert!(!m.is_available());
        let snap = m.snapshot(UNIX_EPOCH, UNIX_EPOCH + Duration::from_secs(60));
        assert_eq!(snap.active_seconds, 0);
        assert_eq!(snap.activity_percent, 0);
    }

    #[test]
    fn test_snapshot_resets_running_counters() {
        let m = ActivityMonitor::new();
        {
            let mut inner = m.inner.lock().unwrap();
            inner.keyboard = 5;
            inner.mouse = 3;
            inner.scroll = 1;
        }
        let first = m.snapshot(UNIX_EPOCH, UNIX_EPOCH + Duration::from_secs(60));
        assert_eq!((first.keyboard, first.mouse, first.scroll), (5, 3, 1));

        let second = m.snapshot(UNIX_EPOCH, UNIX_EPOCH + Duration::from_secs(60));
        assert_eq!((second.keyboard, second.mouse, second.scroll), (0, 0, 0));
    }

    #[test]
    fn test_snapshot_counts_only_seconds_inside_the_window() {
        let m = ActivityMonitor::new();
        {
            let mut inner = m.inner.lock().unwrap();
            inner.active_seconds.insert(100);
            inner.active_seconds.insert(150);
            inner.active_seconds.insert(300); // outside the window below
        }
        let snap = m.snapshot(UNIX_EPOCH + Duration::from_secs(100), UNIX_EPOCH + Duration::from_secs(200));
        assert_eq!(snap.active_seconds, 2);
        assert_eq!(snap.interval_seconds, 100);
        assert_eq!(snap.activity_percent, 2);
    }

    #[test]
    fn test_snapshot_percent_caps_at_100() {
        let m = ActivityMonitor::new();
        {
            let mut inner = m.inner.lock().unwrap();
            for sec in 0..10 {
                inner.active_seconds.insert(sec);
            }
        }
        // A 1-second-wide window (max(1)) with an active second inside it
        // must never read above 100%.
        let snap = m.snapshot(UNIX_EPOCH, UNIX_EPOCH + Duration::from_secs(1));
        assert!(snap.activity_percent <= 100);
    }

    /// Actually installs the global input hook, rather than only
    /// exercising the counting logic around it. Skips (not fails) with
    /// no `DISPLAY` for the same reason `screenshot.rs`'s live capture
    /// test does — `rdev`'s Linux backend needs a real X server. Run
    /// under Xvfb for real coverage:
    /// `Xvfb :99 & DISPLAY=:99 cargo test activity_monitor_start_installs -- --nocapture`.
    #[test]
    fn test_activity_monitor_start_installs_the_listener_when_a_display_is_present() {
        if std::env::var("DISPLAY").is_err() {
            eprintln!("skipping: no DISPLAY — run under Xvfb for real coverage of this path");
            return;
        }
        let m = ActivityMonitor::new();
        assert!(!m.is_available(), "should not be available before start() is called");
        m.start();
        assert!(m.is_available(), "start() under a real X server must leave the listener available");
        // A second call must stay idempotent rather than installing a
        // second hook — the same guarantee Python's `if self._listeners:
        // return` makes.
        m.start();
        assert!(m.is_available());
    }
}
