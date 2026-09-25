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

// macOS listens through `mac_tap` below instead — rdev's own key handling
// aborts the process on every keystroke there.
#[cfg(not(target_os = "macos"))]
use rdev::{listen, Event, EventType};
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// macOS's Input Monitoring permission, asked properly.
///
/// The listener starting successfully does not mean it is being given
/// anything to listen to, which is what made this worth its own module.
/// `CGEventTapCreate` — what rdev is doing underneath — succeeds without
/// Input Monitoring. macOS simply withholds keyboard events from the tap
/// and keeps delivering mouse and scroll. Nothing errors, `listen` blocks
/// normally forever, and the thread stays alive.
///
/// The result is data that looks like a quiet typist rather than a broken
/// permission: measured on a real device, every screenshot row in the
/// database had `keyboard_count = 0` while `mouse_count` and
/// `scroll_count` moved — across hours of someone working in an editor.
#[cfg(target_os = "macos")]
mod input_permission {
    /// `kIOHIDRequestTypeListenEvent` — observing input, as opposed to
    /// `kIOHIDRequestTypePostEvent` (0), which is synthesising it.
    const LISTEN_EVENT: u32 = 1;
    /// `kIOHIDAccessTypeGranted`. The other two are Denied (1) and
    /// Unknown (2) — Unknown meaning nobody has been asked yet.
    const GRANTED: u32 = 0;

    #[link(name = "IOKit", kind = "framework")]
    extern "C" {
        fn IOHIDCheckAccess(request: u32) -> u32;
        fn IOHIDRequestAccess(request: u32) -> bool;
    }

    /// Whether keyboard events will actually reach an event tap. Does not
    /// prompt.
    pub fn granted() -> bool {
        // SAFETY: an IOKit predicate taking an enum value and returning
        // one, callable from any thread.
        unsafe { IOHIDCheckAccess(LISTEN_EVENT) == GRANTED }
    }

    /// Raises the system prompt if nobody has answered yet; otherwise
    /// reports the stored answer without showing anything.
    pub fn request() -> bool {
        // SAFETY: as above.
        unsafe { IOHIDRequestAccess(LISTEN_EVENT) }
    }
}

/// The macOS input listener, written here rather than taken from rdev.
///
/// rdev's tap callback crashes the process on the first keystroke, and it
/// does so while doing work this agent explicitly does not want done.
/// Every key event, it calls `TSMGetInputSourceProperty` to translate the
/// keycode into the character it would type, so it can fill in
/// `Event::name`. That API asserts it is on the main queue — the tap
/// callback runs on the listener's own thread — and macOS aborts:
///
///     dispatch_assert_queue$V2.cold.1
///     HIToolbox  TSMGetInputSourceProperty
///     rdev::macos::listen::raw_callback
///
/// EXC_BREAKPOINT, every keypress, caught only once Input Monitoring was
/// granted on a real device — before that no key events reached the tap,
/// so the agent looked stable while silently counting no keyboard at all.
/// Granting the permission turned a wrong number into a crash loop, with
/// launchd restarting the agent into a fresh window each time.
///
/// The translation is the whole problem, and this agent never wanted it:
/// the module's promise is that it counts keystrokes and never learns
/// what they were. So this tap reads the event *type* and nothing else —
/// never the keycode, never the character, never the event's contents.
/// That is both the fix and a stronger version of the guarantee, since
/// there is now no code path on which a key's identity is even available.
#[cfg(target_os = "macos")]
mod mac_tap {
    use super::{mark, Inner};
    use std::ffi::c_void;
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    // CGEventType. Only the ones counted below are named.
    const LEFT_MOUSE_DOWN: u32 = 1;
    const RIGHT_MOUSE_DOWN: u32 = 3;
    const MOUSE_MOVED: u32 = 5;
    const KEY_DOWN: u32 = 10;
    const SCROLL_WHEEL: u32 = 22;
    const OTHER_MOUSE_DOWN: u32 = 25;
    /// The system disables a tap that took too long in its callback, and
    /// says so by delivering this instead of an event. Re-enabling is the
    /// documented response; without it the tap goes quiet for good.
    const TAP_DISABLED_BY_TIMEOUT: u32 = 0xFFFF_FFFE;

    const SESSION_EVENT_TAP: u32 = 1;
    const HEAD_INSERT: u32 = 0;
    /// Listen-only: the tap may not alter or swallow events. Anything
    /// else would put this agent in the path of every keystroke on the
    /// machine, which is not a thing to be even one bug away from.
    const LISTEN_ONLY: u32 = 1;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventTapCreate(
            tap: u32,
            place: u32,
            options: u32,
            events_of_interest: u64,
            callback: extern "C" fn(*mut c_void, u32, *mut c_void, *mut c_void) -> *mut c_void,
            user_info: *mut c_void,
        ) -> *mut c_void;
        fn CGEventTapEnable(tap: *mut c_void, enable: bool);
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        static kCFRunLoopCommonModes: *const c_void;
        fn CFMachPortCreateRunLoopSource(allocator: *const c_void, port: *mut c_void, order: isize) -> *mut c_void;
        fn CFRunLoopGetCurrent() -> *mut c_void;
        fn CFRunLoopAddSource(rl: *mut c_void, source: *mut c_void, mode: *const c_void);
        fn CFRunLoopRun();
        fn CFRelease(cf: *mut c_void);
    }

    /// What the callback is handed back through `user_info`. Mouse-move
    /// throttling lives here rather than in `Inner` because it is this
    /// listener's business, not the counters'.
    struct TapState {
        inner: Arc<Mutex<Inner>>,
        tap: *mut c_void,
    }

    extern "C" fn callback(_proxy: *mut c_void, event_type: u32, event: *mut c_void, user_info: *mut c_void) -> *mut c_void {
        // SAFETY: `user_info` is the TapState leaked in `run`, which
        // outlives the tap, and the callback is only ever invoked by the
        // run loop this thread owns.
        let state = unsafe { &*(user_info as *const TapState) };

        if event_type == TAP_DISABLED_BY_TIMEOUT {
            // SAFETY: re-enabling the tap this thread created.
            unsafe { CGEventTapEnable(state.tap, true) };
            return event;
        }

        if let Ok(mut s) = state.inner.lock() {
            match event_type {
                KEY_DOWN => {
                    s.keyboard += 1;
                    mark(&mut s);
                }
                LEFT_MOUSE_DOWN | RIGHT_MOUSE_DOWN | OTHER_MOUSE_DOWN => {
                    s.mouse += 1;
                    mark(&mut s);
                }
                SCROLL_WHEEL => {
                    s.scroll += 1;
                    mark(&mut s);
                }
                MOUSE_MOVED => {
                    // Movement fires torrentially; at most one "active"
                    // mark per second, so a still cursor never counts and
                    // a moving one does not drown the counters — the same
                    // rule the Python original's `on_move` throttle used.
                    let now = Instant::now();
                    if now.duration_since(s.last_move) >= Duration::from_secs(1) {
                        s.last_move = now;
                        s.mouse += 1;
                        mark(&mut s);
                    }
                }
                _ => {}
            }
        }

        // The event, untouched, straight back to the system.
        event
    }

    /// Installs the tap and runs its run loop. Blocks forever on success,
    /// exactly like `rdev::listen`, so the caller's liveness check means
    /// the same thing as before. Returns on failure to install.
    pub fn run(inner: Arc<Mutex<Inner>>) -> Result<(), &'static str> {
        let mask: u64 = (1 << KEY_DOWN)
            | (1 << LEFT_MOUSE_DOWN)
            | (1 << RIGHT_MOUSE_DOWN)
            | (1 << OTHER_MOUSE_DOWN)
            | (1 << SCROLL_WHEEL)
            | (1 << MOUSE_MOVED);

        // Boxed and leaked: the callback holds this pointer for as long
        // as the tap lives, which is as long as the process does.
        let state = Box::into_raw(Box::new(TapState { inner, tap: std::ptr::null_mut() }));

        // SAFETY: a real event mask and a callback of the exact signature
        // CGEventTapCreate expects; `state` outlives the tap.
        let tap = unsafe { CGEventTapCreate(SESSION_EVENT_TAP, HEAD_INSERT, LISTEN_ONLY, mask, callback, state as *mut c_void) };
        if tap.is_null() {
            // The one expected cause is Input Monitoring not being
            // granted; there is nothing to retry, so hand the box back to
            // be dropped rather than leaking it on the failure path.
            // SAFETY: nothing else ever saw this pointer — the tap that
            // would have held it was not created.
            drop(unsafe { Box::from_raw(state) });
            return Err("could not create the event tap");
        }
        // SAFETY: `state` is uniquely owned here; the tap has not run yet.
        unsafe { (*state).tap = tap };

        // SAFETY: `tap` is a CFMachPort this thread just created; the
        // source is added to this thread's own run loop and released once
        // the run loop retains it.
        unsafe {
            let source = CFMachPortCreateRunLoopSource(std::ptr::null(), tap, 0);
            if source.is_null() {
                return Err("could not create the run loop source");
            }
            CFRunLoopAddSource(CFRunLoopGetCurrent(), source, kCFRunLoopCommonModes);
            CFRelease(source);
            CGEventTapEnable(tap, true);
            CFRunLoopRun();
        }
        Ok(())
    }
}

/// True if keyboard input can actually be observed on this device.
///
/// Always true off macOS: Windows needs no permission for a low-level
/// hook, and on Linux the failure is an honest one — rdev cannot attach
/// without an X server and says so.
fn input_monitoring_permitted() -> bool {
    #[cfg(target_os = "macos")]
    {
        input_permission::granted()
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

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

        // Asked before the listener is built, because afterwards there is
        // nothing to ask: the tap installs either way and only the
        // keyboard events go missing. `request` raises the prompt the
        // first time and answers from TCC's records after that, so this
        // costs nothing on a device that has already decided.
        #[cfg(target_os = "macos")]
        if !input_permission::granted() && !input_permission::request() {
            tracing::warn!(
                "input monitoring permission is not granted — keyboard input cannot be counted. \
                 Grant it in System Settings › Privacy & Security › Input Monitoring, then restart \
                 the agent. Mouse and scroll are still counted, so activity will read low rather \
                 than zero"
            );
        }

        let inner = self.inner.clone();
        let handle = std::thread::Builder::new()
            .name("aavishield-activity-monitor".into())
            .spawn(move || {
                // macOS gets its own tap — see mac_tap for the crash that
                // rdev's key handling causes on every keystroke. Blocks
                // forever on success, exactly as `listen` does, so the
                // liveness check below reads the same either way.
                #[cfg(target_os = "macos")]
                {
                    if let Err(e) = mac_tap::run(inner) {
                        tracing::warn!(
                            error = %e,
                            "activity monitoring could not start — this is Input Monitoring not \
                             being granted (System Settings › Privacy & Security › Input Monitoring). \
                             Keyboard, mouse and scroll counts will stay at zero"
                        );
                    }
                    return;
                }

                #[cfg(not(target_os = "macos"))]
                {
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
                    tracing::warn!(
                        error = ?e,
                        "activity monitoring could not start — on macOS this is Input Monitoring \
                         not being granted (System Settings › Privacy & Security › Input Monitoring). \
                         Keyboard, mouse and scroll counts will stay at zero"
                    );
                }
                }
            });
        // Listener installation is effectively synchronous on every
        // platform rdev supports (the hook either registers immediately or
        // the thread returns almost immediately on failure), so a short
        // grace period is enough to know which happened without adding a
        // real handshake channel for a value nothing blocks on.
        std::thread::sleep(Duration::from_millis(200));
        // The thread is still running => `listen` is blocked delivering
        // events => the hook installed. It has already exited => `listen`
        // returned an error and there is no hook.
        //
        // This used to store `true` unconditionally, directly under a
        // comment claiming it checked exactly this, because the
        // `JoinHandle` had been dropped with `.ok()` and there was nothing
        // left to ask. `is_available` was therefore true on every device
        // that had ever called `start`, including every device where the
        // permission was refused — so a dashboard showing "monitoring
        // active" next to permanently zero counters was reporting the
        // truth it had been given.
        let running = match &handle {
            Ok(h) => !h.is_finished(),
            Err(e) => {
                tracing::warn!(error = %e, "could not spawn the activity monitor thread");
                false
            }
        };
        // Both conditions, not just the thread. A live thread proves a tap
        // exists; it does not prove the tap is being fed. Without Input
        // Monitoring the thread runs forever, mouse and scroll arrive, and
        // every keystroke is dropped before it gets here — reporting that
        // as "monitoring available" is how a device spent hours claiming
        // its user never touched the keyboard.
        self.available.store(running && input_monitoring_permitted(), Ordering::Relaxed);
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
