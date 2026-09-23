//! Entry point.
//!
//! Two threads, split by what each one may never do to the other:
//!
//! - The **background thread** (`background::spawn`) owns a `tokio::
//!   Runtime` and runs the entire data plane — proxy, MITM, DLP/malware
//!   scan orchestration, policy/threat/CASB caching, activity reporting,
//!   heartbeat, app control, inventory. Nothing here may ever block
//!   waiting on the GUI.
//! - The **real OS main thread**, below, runs the desktop window
//!   (`eframe::run_native`, which blocks it) and the tray icon. This is
//!   not a style choice: `eframe`'s winit backend requires the platform
//!   event loop run on the actual main thread, and on macOS AppKit aborts
//!   the process outright if touched from anywhere else — the same
//!   constraint the Python original's tray/window code carries, for the
//!   same reason.
//!
//! They talk in one direction each way: the GUI sends `Command`s
//! (Connect/CancelConnect/Disconnect) down a channel, and reads `UiState`
//! (written by the background thread) once per frame. Neither ever calls
//! into the other directly.

// Bridges a `'static` C signal handler (which cannot capture anything) to
// the per-run `Arc<AtomicBool>` the tray icon's "Open" click already uses
// — set once, below, right after the tray is built. The handler only ever
// stores `true`: an atomic store is the one thing safe to do from inside a
// signal handler, the same constraint Python's own SIGUSR1 handler
// documents ("the handler only sets an event — showing a window from
// inside a signal handler runs on whatever the interpreter was doing,
// which is not somewhere to be touching the GUI toolkit").
#[cfg(unix)]
static SHOW_REQUESTED: std::sync::OnceLock<std::sync::Arc<std::sync::atomic::AtomicBool>> = std::sync::OnceLock::new();

#[cfg(unix)]
extern "C" fn handle_sigusr1(_signum: libc::c_int) {
    if let Some(flag) = SHOW_REQUESTED.get() {
        flag.store(true, std::sync::atomic::Ordering::SeqCst);
    }
}

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env().add_directive("aavishield_agent=info".parse().unwrap()))
        .init();

    // Opening the app from Spotlight/Launchpad/the Dock while a
    // LaunchAgent-started instance is already running would otherwise
    // start a second copy — see single_instance.rs for the exact launchd
    // race this guards against. Checked before anything else touches the
    // network or the proxy port, so a losing instance never contends for
    // either. The sleep keeps KeepAlive from respawning a pointless loser
    // in a tight loop; it will keep losing the lock to the same winner
    // every time regardless, so there is nothing to retry for.
    if !aavishield_agent::single_instance::acquire() {
        aavishield_agent::single_instance::signal_running_instance_to_show();
        tracing::debug!("another agent instance already holds the lock — exiting quietly");
        std::thread::sleep(std::time::Duration::from_secs(5));
        return;
    }

    let handles = aavishield_agent::background::spawn();
    let tray = aavishield_agent::tray::build(handles.ui.clone());

    // Unix only, matching Python's own `platform.system() != "Windows"`
    // guard — Windows has no SIGUSR1, and `single_instance::
    // signal_running_instance_to_show` is already a no-op there. Tied to
    // the tray specifically, not the window in general: a tray build
    // failure (no D-Bus session, no GTK) means there is nowhere for
    // "someone clicked the icon again" to be shown either way.
    #[cfg(unix)]
    if let Some(t) = &tray {
        let _ = SHOW_REQUESTED.set(t.show_requested.clone());
        // SAFETY: installing a handler for a real signal number with a
        // `extern "C" fn(c_int)` of the exact signature `signal(2)`
        // expects, called once before any other thread that could race
        // this installation exists (the background thread doesn't touch
        // signal disposition). The handler itself does only an atomic
        // store — see its own doc comment for why that is the one safe
        // thing to do here.
        unsafe {
            libc::signal(libc::SIGUSR1, handle_sigusr1 as *const () as libc::sighandler_t);
        }
    }

    let viewport = eframe::egui::ViewportBuilder::default()
        .with_title("Aavishield")
        .with_inner_size([340.0, 460.0])
        .with_resizable(false);

    let native_options = eframe::NativeOptions {
        viewport,
        // The window closing must not end the process — the background
        // thread (proxy, heartbeat, everything that matters) keeps running
        // regardless of whether anyone is looking at it. gui.rs turns an
        // OS close request into "hide" rather than "exit" for exactly this
        // reason.
        run_and_return: true,
        ..Default::default()
    };

    let result = eframe::run_native(
        "Aavishield",
        native_options,
        Box::new(move |_cc| {
            Ok(Box::new(aavishield_agent::gui::ConnectorApp::new(
                handles.ui,
                handles.client_slot,
                handles.commands,
                tray,
            )))
        }),
    );

    if let Err(e) = result {
        tracing::error!(error = %e, "desktop window exited with an error");
    }
}
