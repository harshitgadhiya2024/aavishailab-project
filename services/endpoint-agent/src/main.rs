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

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env().add_directive("aavishield_agent=info".parse().unwrap()))
        .init();

    let handles = aavishield_agent::background::spawn();
    let tray = aavishield_agent::tray::build(handles.ui.clone());

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
