//! System tray icon — a port of Python's `TrayUI`. Optional in the same
//! sense: on a headless box or a Linux desktop with no notification-area
//! host running, `TrayIcon::new` fails and the agent runs exactly as it
//! would otherwise, just without a way back once the window is hidden
//! (see gui.rs's "Run in background" handling — the window can still be
//! reached by re-launching the binary).

use crate::ui_state::UiState;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

/// Where main.rs deposits the real `egui::Context` once eframe hands it one
/// (inside the `run_native` closure) — `None` for the brief window before
/// that, and forever after on a platform with no tray. See `build`'s
/// MenuEvent handler for why this exists: a plain `show_requested` flag on
/// its own is not enough.
pub type SharedCtx = Arc<Mutex<Option<eframe::egui::Context>>>;
use tray_icon::menu::{Menu, MenuEvent, MenuItem};
use tray_icon::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};

/// Owns the tray icon and the flag the GUI checks to un-hide the window.
/// `show_requested` is a plain bool behind an atomic, not a channel,
/// because "the tray wants the window shown" has no queue semantics worth
/// having — the tenth click while the window is already visible means
/// exactly the same thing as the first.
pub struct Tray {
    _icon: TrayIcon,
    pub show_requested: Arc<AtomicBool>,
}

/// Builds and shows the tray icon. Returns None on any failure — a missing
/// notification-area host (some minimal Linux desktops, some CI/test
/// environments) must degrade to "no tray", never to a crash.
///
/// `ctx_cell` is empty when this is called (main.rs builds the tray before
/// eframe has handed out a `Context`) and filled in moments later — the
/// MenuEvent handler below reads through it at click time, not at build
/// time, so it always sees whatever main.rs has deposited by then.
pub fn build(ui_state: UiState, ctx_cell: SharedCtx) -> Option<Tray> {
    // Linux only: tray-icon's Linux backend goes through GTK, which —
    // unlike winit — does not initialize itself. Skipping this is what
    // "GTK has not been initialized" (a hard panic, not a graceful
    // failure) looks like, caught by actually running the binary under
    // Xvfb rather than by it merely compiling. See gui.rs's per-frame
    // `pump_platform_events` for the other half: GTK's main loop still
    // needs pumping alongside winit's, or the tray icon never repaints.
    #[cfg(target_os = "linux")]
    if gtk::init().is_err() {
        tracing::info!("GTK could not initialize — running without a tray icon");
        return None;
    }

    let menu = Menu::new();
    let open_item = MenuItem::new("Open Aavishield", true, None);
    // Disabled, text-only — the same "read the status, don't act on it"
    // item Python's tray shows via `enabled=False`.
    let status_item = MenuItem::new(crate::gui::tray_status_text(ui_state.snapshot().state), false, None);
    menu.append(&open_item).ok()?;
    menu.append(&status_item).ok()?;

    let icon = tray_icon::Icon::from_rgba(shield_rgba(), 64, 64).ok()?;

    let show_requested = Arc::new(AtomicBool::new(false));
    let tray = TrayIconBuilder::new()
        .with_tooltip("Aavishield")
        .with_icon(icon)
        .with_menu(Box::new(menu))
        .build()
        .ok()?;

    // Setting the flag alone used to be the whole story here — and on
    // macOS that left the window unable to ever reopen: a hidden
    // (Visible:false) window stops getting its egui `update()` called at
    // anything close to the normal cadence once the OS decides nothing is
    // drawing it, so the per-frame `show_requested` check in gui.rs (the
    // only place that flag is ever read) could go uncalled indefinitely.
    // request_repaint() is exactly the escape hatch egui provides for
    // this — safe to call from any thread, including these callbacks,
    // which tray-icon runs on its own dispatch thread, not egui's — and
    // forces that next `update()` to actually happen regardless of what
    // the OS thinks a hidden window deserves.
    let request_show = {
        let flag = show_requested.clone();
        move || {
            flag.store(true, Ordering::SeqCst);
            if let Ok(guard) = ctx_cell.lock() {
                if let Some(ctx) = guard.as_ref() {
                    ctx.request_repaint();
                }
            }
        }
    };

    let open_id = open_item.id().clone();
    let on_menu_click = request_show.clone();
    // tray-icon delivers clicks on a global channel rather than a per-item
    // callback; matching on the id we stashed above is how this tells "Open"
    // apart from any other item added later.
    MenuEvent::set_event_handler(Some(move |event: MenuEvent| {
        if event.id == open_id {
            on_menu_click();
        }
    }));

    // A left-click straight on the icon — not through the right-click/
    // menu path above at all — reported live as not doing anything either:
    // this crate delivers icon clicks as their own event stream, separate
    // from MenuEvent, and nothing was listening to it before this. Left
    // only (Right stays the OS's own cue to show the attached menu — the
    // one thing that already worked without any handler here), and only
    // on release (Up), matching the platform convention every other
    // status-bar app follows so a press-drag-elsewhere doesn't also
    // trigger it.
    TrayIconEvent::set_event_handler(Some(move |event: TrayIconEvent| {
        if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
            request_show();
        }
    }));

    Some(Tray { _icon: tray, show_requested })
}

/// A brand-orange shield, matching the pystray icon's own generated glyph
/// (a hexagonal shield silhouette) closely enough to be recognisable, not
/// pixel-identical — a tray icon at 16-22px doesn't reward more detail than
/// this.
fn shield_rgba() -> Vec<u8> {
    const SIZE: usize = 64;
    let mut buf = vec![0u8; SIZE * SIZE * 4];
    let cx = SIZE as f32 / 2.0;
    let cy = SIZE as f32 / 2.0;
    for y in 0..SIZE {
        for x in 0..SIZE {
            let (fx, fy) = (x as f32 - cx, y as f32 - cy);
            let inside = point_in_shield(fx / cx, fy / cy);
            let idx = (y * SIZE + x) * 4;
            if inside {
                buf[idx] = 0xFF;
                buf[idx + 1] = 0x70;
                buf[idx + 2] = 0x00;
                buf[idx + 3] = 0xFF;
            }
        }
    }
    buf
}

/// Normalised (-1..1, -1..1) point-in-shield test — a hexagon tapering to a
/// point at the bottom, the same silhouette the HTML UI's SVG path draws.
fn point_in_shield(x: f32, y: f32) -> bool {
    if y < -0.85 || y > 0.9 {
        return false;
    }
    let width_at_y = if y < -0.3 {
        // Shoulders: widest just below the top edge.
        0.85 * (1.0 - (y + 0.85) / 0.55 * 0.15)
    } else {
        // Taper to the point.
        0.85 * (1.0 - (y + 0.3) / 1.2).max(0.0)
    };
    x.abs() <= width_at_y
}
