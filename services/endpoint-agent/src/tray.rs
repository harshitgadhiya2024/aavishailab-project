//! System tray icon — a port of Python's `TrayUI`. Optional in the same
//! sense: on a headless box or a Linux desktop with no notification-area
//! host running, `TrayIcon::new` fails and the agent runs exactly as it
//! would otherwise, just without a way back once the window is hidden
//! (see gui.rs's "Run in background" handling — the window can still be
//! reached by re-launching the binary).

use crate::ui_state::UiState;
use eframe::egui;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use tray_icon::menu::{Menu, MenuEvent, MenuItem};
use tray_icon::{TrayIcon, TrayIconBuilder};

/// "Someone wants the window shown" — raised from outside the GUI (the tray
/// menu, a second launch of the app) and consumed by the GUI's frame loop.
///
/// A flag alone is not enough: once the window is hidden, macOS stops
/// giving it a reason to draw and App Nap throttles the 500ms repaint
/// timer, so the frame loop that would read the flag can go unrun
/// indefinitely. `request` therefore also pokes the egui context directly —
/// `request_repaint` is safe from any thread and wakes the event loop
/// through winit's proxy, which a hidden window still receives.
///
/// Still a plain bool rather than a channel: the tenth request while the
/// window is already visible means exactly the same thing as the first.
#[derive(Clone, Default)]
pub struct ShowSignal {
    inner: Arc<ShowSignalInner>,
}

#[derive(Default)]
struct ShowSignalInner {
    pending: AtomicBool,
    /// Set once eframe has created the context — requests that arrive
    /// before then just leave `pending` set for the first frame to pick up.
    ctx: OnceLock<egui::Context>,
}

impl ShowSignal {
    pub fn request(&self) {
        self.inner.pending.store(true, Ordering::SeqCst);
        if let Some(ctx) = self.inner.ctx.get() {
            ctx.request_repaint();
        }
    }

    /// Hands over the context `request` wakes. Called once, from eframe's
    /// app-creation callback.
    pub fn attach(&self, ctx: &egui::Context) {
        let _ = self.inner.ctx.set(ctx.clone());
    }

    /// True (once) if a show was requested since the last call.
    pub fn take(&self) -> bool {
        self.inner.pending.swap(false, Ordering::SeqCst)
    }
}

/// Owns the tray icon and the signal the GUI checks to un-hide the window.
pub struct Tray {
    _icon: TrayIcon,
    pub show: ShowSignal,
}

/// Builds and shows the tray icon. Returns None on any failure — a missing
/// notification-area host (some minimal Linux desktops, some CI/test
/// environments) must degrade to "no tray", never to a crash.
pub fn build(ui_state: UiState) -> Option<Tray> {
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

    let show = ShowSignal::default();
    let tray = TrayIconBuilder::new()
        .with_tooltip("Aavishield")
        .with_icon(icon)
        .with_menu(Box::new(menu))
        .build()
        .ok()?;

    let open_id = open_item.id().clone();
    let on_open = show.clone();
    // tray-icon delivers clicks on a global channel rather than a per-item
    // callback; matching on the id we stashed above is how this tells "Open"
    // apart from any other item added later.
    MenuEvent::set_event_handler(Some(move |event: MenuEvent| {
        if event.id == open_id {
            on_open.request();
        }
    }));

    Some(Tray { _icon: tray, show })
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
