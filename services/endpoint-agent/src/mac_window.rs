//! Bringing the window back on macOS, without going through the frame loop.
//!
//! "Run in background" hides the window with `orderOut:`. Everything that
//! can ask for it back — the tray's "Open Aavishield", a second launch from
//! Spotlight arriving as SIGUSR1 — runs on some other thread, so the
//! obvious design is to hand the request to the GUI and let
//! `ConnectorApp::update` answer it with `ViewportCommand::Visible(true)`.
//!
//! That design cannot work here, and the reason is circular: `update` only
//! runs when the window draws, and AppKit never draws a window that has
//! been ordered out. `Window::request_redraw` marks the view as needing
//! display, the window is off-screen, no `drawRect:` follows, so winit
//! emits no `RedrawRequested`, so there is no frame — and the command that
//! would un-hide the window is sitting in a loop that is not running.
//! Waking the event loop does not break the cycle either: it wakes, finds
//! nothing to draw, and parks again.
//!
//! Measured on a backgrounded agent rather than reasoned about: `sample`
//! shows the main thread parked in `mach_msg` under
//! `__CFRunLoopServiceMachPort`, and the process burns 0.00s of CPU across
//! a `Context::request_repaint` from another thread — the request arrives,
//! and nothing on the main thread ever acts on it.
//!
//! So AppKit has to order the window back in, not egui. `show` does that
//! directly, and once the window is on screen again AppKit sends it a
//! `drawRect:` of its own accord, which is what restarts the frame loop —
//! egui picks up painting again without being asked.
//!
//! Two details this also gets right by construction, both of which the
//! egui route would have had to solve separately:
//!
//! - The bundle is `LSUIElement`, so the agent is an *accessory* app. An
//!   accessory app that is not frontmost cannot make a window key, so
//!   ordering the window in without `activateIgnoringOtherApps:` would
//!   leave it stacked behind whatever the user was looking at — visible to
//!   `CGWindowList`, invisible to the person who clicked "Open".
//! - AppKit may only be touched from the main thread, and callers are
//!   never on it, so the work is hopped over with `dispatch_async_f`. That
//!   is also what wakes the run loop: the main queue drains as a run-loop
//!   source, so the same call that schedules the work un-parks the
//!   `mach_msg` above.

use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, Bool, Imp, Sel};
use objc2::{ffi, sel, MainThreadMarker};
use objc2_app_kit::{NSApplication, NSView};
use raw_window_handle::RawWindowHandle;
use std::ffi::c_void;
use std::ptr;
use std::sync::atomic::{AtomicPtr, Ordering};

/// The window's `NSView`, retained for the life of the process — `show`
/// reaches the window through `-[NSView window]` rather than storing the
/// `NSWindow` itself, because the view is what the window handle actually
/// gives us and the two have the same lifetime here anyway.
static NS_VIEW: AtomicPtr<NSView> = AtomicPtr::new(ptr::null_mut());

extern "C" {
    /// The main dispatch queue. Declared here rather than pulled in with a
    /// `dispatch` crate: two symbols is the whole of what this needs.
    static _dispatch_main_q: c_void;

    /// The function-pointer form of `dispatch_async`. Takes a plain
    /// context pointer instead of a block, which suits a caller that has
    /// exactly one pointer to pass and no allocation to make.
    fn dispatch_async_f(queue: *const c_void, context: *mut c_void, work: extern "C" fn(*mut c_void));
}

/// Records the window eframe just created. Called once, from the
/// app-creation callback; a handle that isn't AppKit's (or isn't there at
/// all) leaves `show` a no-op rather than failing the launch — the window
/// is on screen at that point, and the worst case is the tray's "Open"
/// doing nothing, not the agent refusing to start.
pub fn remember(handle: &RawWindowHandle) {
    let RawWindowHandle::AppKit(appkit) = handle else {
        tracing::warn!("window handle is not AppKit's — the tray's Open will not reopen the window");
        return;
    };

    let ptr = appkit.ns_view.as_ptr().cast::<NSView>();
    // SAFETY: winit hands out a live, valid `NSView` here, and it stays
    // alive as long as the window does. The retain is deliberately never
    // balanced: one view is leaked for the process's lifetime so that
    // `show` can dereference it from the main queue at any later point
    // without coordinating with eframe's ownership of the window.
    let Some(view) = (unsafe { Retained::retain(ptr) }) else {
        tracing::warn!("window handle had a null NSView — the tray's Open will not reopen the window");
        return;
    };

    NS_VIEW.store(Retained::into_raw(view), Ordering::Release);

    // SAFETY: eframe runs this callback on the main thread — `run_native`
    // requires it, and AppKit aborts the process if it is ever not true.
    install_reopen_handler(unsafe { MainThreadMarker::new_unchecked() });
}

/// Teaches the application delegate to answer
/// `applicationShouldHandleReopen:hasVisibleWindows:`.
///
/// This is the *only* thing that hears about the user opening an
/// already-running app. It is tempting to assume — as the agent did until
/// this was measured — that Spotlight, Launchpad or Finder start a second
/// copy of the binary, which finds the single-instance lock taken and
/// signals the winner to show itself. On macOS that never happens:
/// LaunchServices deduplicates by bundle identity, so opening a running
/// app starts no process at all and simply sends the one already running
/// a reopen event. (Verified by running `open -a Aavishield` against a
/// live agent and watching the pid list not change.) The signalling path
/// is still worth keeping for a binary launched directly, bypassing
/// LaunchServices, but nothing a user does through the UI reaches it.
///
/// The method is added to winit's own delegate class rather than
/// installed as a second delegate, because `NSApplication` has room for
/// exactly one and winit needs the one it has — it routes
/// `applicationDidFinishLaunching:` and `applicationWillTerminate:`
/// through it, so replacing it would trade this bug for a worse one.
/// Winit's delegate does not implement the reopen selector, so this adds
/// a method rather than replacing one: `class_addMethod` refuses to
/// overwrite, and the `false` it returns in that case would mean winit
/// had grown its own handler and this needs revisiting.
fn install_reopen_handler(mtm: MainThreadMarker) {
    let Some(delegate) = NSApplication::sharedApplication(mtm).delegate() else {
        tracing::warn!("no application delegate — reopening from Spotlight will not show the window");
        return;
    };

    // SAFETY: a live delegate object; `class` is valid on any Objective-C
    // instance, and the class outlives the process.
    let class: *mut AnyClass = unsafe { (*Retained::as_ptr(&delegate).cast::<AnyObject>()).class() as *const AnyClass as *mut AnyClass };

    // "c@:@c" — BOOL return, then the two implicit arguments every method
    // takes (self, _cmd), then the NSApplication and the BOOL.
    let added = unsafe {
        ffi::class_addMethod(
            class,
            sel!(applicationShouldHandleReopen:hasVisibleWindows:),
            std::mem::transmute::<ReopenFn, Imp>(should_handle_reopen),
            c"c@:@c".as_ptr(),
        )
    };

    if !added.as_bool() {
        tracing::warn!("the application delegate already answers applicationShouldHandleReopen: — leaving it alone");
    }
}

type ReopenFn = extern "C" fn(*mut AnyObject, Sel, *mut AnyObject, Bool) -> Bool;

extern "C" fn should_handle_reopen(_this: *mut AnyObject, _cmd: Sel, _app: *mut AnyObject, _has_visible_windows: Bool) -> Bool {
    // Deliberately not conditioned on `has_visible_windows`: someone who
    // opens the app while its window is already up is asking for it to be
    // in front, which is what `show` does, and doing it twice is harmless.
    show();
    // NO — "the reopen is handled", so AppKit does not also run its own
    // default, which for an app with no windows open means trying to make
    // an untitled document.
    Bool::NO
}

/// Orders the window back in and brings the app forward. Safe to call from
/// any thread, at any time, however often — the work is hopped to the main
/// queue, and asking a window that is already on screen to come forward is
/// what the tenth click should do anyway.
pub fn show() {
    let view = NS_VIEW.load(Ordering::Acquire);
    if view.is_null() {
        return;
    }

    // SAFETY: `_dispatch_main_q` is the main queue, `show_on_main` has the
    // signature `dispatch_async_f` calls, and the context is the retained
    // view from `remember`, which outlives every call.
    unsafe {
        dispatch_async_f(ptr::addr_of!(_dispatch_main_q), view.cast::<c_void>(), show_on_main);
    }
}

extern "C" fn show_on_main(view: *mut c_void) {
    // SAFETY: `dispatch_async_f` on the main queue runs this on the main
    // thread, which is where AppKit requires it, and the pointer is the
    // leaked `NSView` from `remember`.
    let (mtm, view) = unsafe { (MainThreadMarker::new_unchecked(), &*view.cast::<NSView>()) };

    let Some(window) = view.window() else {
        tracing::warn!("the NSView has no window — nothing to reopen");
        return;
    };

    // Order matters: an accessory app has to be activated before it can
    // own the key window, so activating second would order the window in
    // behind the frontmost app and leave it there.
    //
    // `activateIgnoringOtherApps:` is soft-deprecated in favour of
    // `activate`, which cannot be used here: the bundle's
    // LSMinimumSystemVersion is 11.0 and `activate` arrived in 14. The
    // `ignoringOtherApps` behaviour is also the one actually wanted —
    // plain `activate` defers to whatever is frontmost, which for a window
    // the user just asked for by clicking the tray is the wrong answer.
    #[allow(deprecated)]
    NSApplication::sharedApplication(mtm).activateIgnoringOtherApps(true);
    window.makeKeyAndOrderFront(None);
}
