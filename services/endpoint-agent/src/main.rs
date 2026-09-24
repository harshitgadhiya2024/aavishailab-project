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

// SIGUSR1 (a second launch asking this instance to show itself) reaches
// the tray's ShowSignal through a self-pipe: the handler writes one byte,
// and a plain thread blocked on the read end turns that into
// `ShowSignal::request`. The handler can't call `request` itself —
// `request_repaint` takes locks, and `write(2)` is one of the few calls
// that is async-signal-safe — the same constraint Python's own SIGUSR1
// handler documents ("showing a window from inside a signal handler runs
// on whatever the interpreter was doing, which is not somewhere to be
// touching the GUI toolkit").
#[cfg(unix)]
static SIGUSR1_PIPE_WRITE: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(-1);

#[cfg(unix)]
extern "C" fn handle_sigusr1(_signum: libc::c_int) {
    let fd = SIGUSR1_PIPE_WRITE.load(std::sync::atomic::Ordering::Relaxed);
    if fd >= 0 {
        let byte = 1u8;
        // Non-blocking write end: if the pipe is somehow full, a wake-up
        // is already pending and dropping this one loses nothing.
        // SAFETY: a valid one-byte buffer; write(2) is async-signal-safe.
        unsafe {
            libc::write(fd, &byte as *const u8 as *const libc::c_void, 1);
        }
    }
}

/// Creates the self-pipe, starts the thread that drains it into `show`,
/// then installs the SIGUSR1 handler — in that order, so a signal can never
/// arrive before there is somewhere for it to go.
#[cfg(unix)]
fn forward_sigusr1_to(show: aavishield_agent::tray::ShowSignal) {
    let mut fds = [0 as libc::c_int; 2];
    // SAFETY: `fds` is a two-element array, exactly what pipe(2) writes to.
    if unsafe { libc::pipe(fds.as_mut_ptr()) } != 0 {
        tracing::warn!(error = %std::io::Error::last_os_error(), "could not create SIGUSR1 pipe — re-launching won't reopen the window");
        return;
    }
    let (read_fd, write_fd) = (fds[0], fds[1]);
    // SAFETY: both fds were just returned by pipe(2) and are owned here.
    unsafe {
        // Close-on-exec so the pipe never leaks into child processes the
        // agent spawns; non-blocking on the write end for the handler.
        libc::fcntl(read_fd, libc::F_SETFD, libc::FD_CLOEXEC);
        libc::fcntl(write_fd, libc::F_SETFD, libc::FD_CLOEXEC);
        libc::fcntl(write_fd, libc::F_SETFL, libc::fcntl(write_fd, libc::F_GETFL) | libc::O_NONBLOCK);
    }

    std::thread::Builder::new()
        .name("sigusr1-show".into())
        .spawn(move || {
            let mut buf = [0u8; 16];
            loop {
                // SAFETY: `buf` is valid for `buf.len()` bytes.
                let n = unsafe { libc::read(read_fd, buf.as_mut_ptr() as *mut libc::c_void, buf.len()) };
                if n > 0 {
                    show.request();
                } else if n < 0 && std::io::Error::last_os_error().kind() == std::io::ErrorKind::Interrupted {
                    continue;
                } else {
                    break;
                }
            }
        })
        .expect("spawning the SIGUSR1 forwarding thread");

    SIGUSR1_PIPE_WRITE.store(write_fd, std::sync::atomic::Ordering::Relaxed);
    // SAFETY: installing a handler for a real signal number with an
    // `extern "C" fn(c_int)` of the exact signature `signal(2)` expects.
    // The handler itself only does a write(2) — see its own comment.
    unsafe {
        libc::signal(libc::SIGUSR1, handle_sigusr1 as *const () as libc::sighandler_t);
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
        forward_sigusr1_to(t.show.clone());
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
        Box::new(move |cc| {
            // Only now does the egui context exist for ShowSignal::request
            // to wake — anything requested earlier is still pending and is
            // picked up by the first frame.
            if let Some(t) = &tray {
                t.show.attach(&cc.egui_ctx);
            }
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
