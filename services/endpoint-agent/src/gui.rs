//! The desktop window — a native re-implementation of `ui/main.html`'s
//! states and actions using `egui`, not a webview. See Cargo.toml for why:
//! one renderer, everywhere, with no external runtime a Linux desktop
//! might not have installed.
//!
//! This mirrors the Python original's state machine exactly (state names,
//! button visibility rules, the ownership-gated Disconnect button) so
//! nobody using both versions during the rollout sees different behaviour
//! — only a different (faster, more consistent) rendering technology.

use crate::background::{ClientSlot, Command};
use crate::ui_state::{ConnState, UiState};
use eframe::egui;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

// Brand tokens lifted from the HTML UI's :root custom properties, so the
// native window reads as the same product.
const BRAND: egui::Color32 = egui::Color32::from_rgb(0xFF, 0x70, 0x00);
const PANEL_BG: egui::Color32 = egui::Color32::from_rgb(0x11, 0x11, 0x11);
const CARD_BG: egui::Color32 = egui::Color32::from_rgb(0x14, 0x14, 0x14);
const BODY_FG: egui::Color32 = egui::Color32::from_rgb(0xD4, 0xD4, 0xD4);
const SUBTLE_FG: egui::Color32 = egui::Color32::from_rgb(0x6B, 0x6B, 0x6B);
const SUCCESS: egui::Color32 = egui::Color32::from_rgb(0x4A, 0xDE, 0x80);
const WARN: egui::Color32 = egui::Color32::from_rgb(0xFA, 0xCC, 0x15);
const DANGER: egui::Color32 = egui::Color32::from_rgb(0xF8, 0x71, 0x71);

pub struct ConnectorApp {
    ui_state: UiState,
    #[allow(dead_code)] // wired up once Enable-HTTPS calls the server directly from here
    client_slot: ClientSlot,
    commands: tokio::sync::mpsc::Sender<Command>,
    /// Set once "Run in background" (or the window's own close button) is
    /// used, so the app knows to hide rather than exit — mirrors Python's
    /// `_background` event. The tokio runtime driving the actual agent
    /// lives on a separate OS thread regardless, so hiding this window
    /// never pauses enforcement.
    running_in_background: Arc<AtomicBool>,
    confirm_disconnect: bool,
    /// Owned here (not leaked, not on a side thread) so its lifetime is
    /// exactly the app's — dropping `ConnectorApp` removes the tray icon,
    /// which is the correct behaviour on the one path that ends the
    /// process (an unrecoverable eframe error), and otherwise never runs.
    tray: Option<crate::tray::Tray>,
    uninstall: UninstallState,
}

/// The uninstall confirmation dialog's own state — kept separate from the
/// handful of top-level `ConnectorApp` fields because it is a small state
/// machine of its own (closed → editing → pending → error), not a single
/// flag like `confirm_disconnect`.
#[derive(Default)]
struct UninstallState {
    showing: bool,
    email: String,
    password: String,
    /// `Some` while a request is in flight — polled once per frame via
    /// `try_recv`, which works outside a tokio runtime context because it
    /// is non-blocking and touches no waker. Cleared the moment a result
    /// arrives (`Ok` or `Err`), replaced by `error` for the failure case.
    pending: Option<tokio::sync::oneshot::Receiver<Result<(), String>>>,
    error: Option<String>,
}

impl ConnectorApp {
    pub fn new(ui_state: UiState, client_slot: ClientSlot, commands: tokio::sync::mpsc::Sender<Command>, tray: Option<crate::tray::Tray>) -> Self {
        ConnectorApp {
            ui_state,
            client_slot,
            commands,
            running_in_background: Arc::new(AtomicBool::new(false)),
            confirm_disconnect: false,
            tray,
            uninstall: UninstallState::default(),
        }
    }

    fn send(&self, cmd: Command) {
        // A full channel would mean commands are backing up faster than the
        // background thread can act on them, which never happens for
        // "somebody clicked a button" traffic — try_send, not a blocking
        // send that would freeze the frame waiting on it.
        let _ = self.commands.try_send(cmd);
    }
}

impl eframe::App for ConnectorApp {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        let ctx = ui.ctx().clone();

        // The window is watched from outside (the background thread writes
        // to ui_state whenever a heartbeat, enrollment attempt, or
        // disconnect changes something) — repaint on a timer rather than
        // only on user input, so those updates actually show up without
        // needing a click first.
        ctx.request_repaint_after(std::time::Duration::from_millis(500));

        // Hiding, not exiting: the agent thread runs independently of this
        // window's lifetime (see background.rs) — the only thing "closing"
        // the window should ever do is stop showing it.
        if ctx.input(|i| i.viewport().close_requested()) {
            ctx.send_viewport_cmd(egui::ViewportCommand::CancelClose);
            self.running_in_background.store(true, Ordering::SeqCst);
            ctx.send_viewport_cmd(egui::ViewportCommand::Visible(false));
        }

        // Linux only: GTK owns the tray icon (see tray.rs), and nothing
        // else in this process drives GTK's own main loop — winit's X11/
        // Wayland backends talk to the display server directly and know
        // nothing about GTK. Without this the icon is created but never
        // repaints, never reflects a changed status label, and never
        // delivers a click.
        #[cfg(target_os = "linux")]
        if self.tray.is_some() {
            while gtk::events_pending() {
                gtk::main_iteration_do(false);
            }
        }

        // The tray's "Open" click (or a second launch of the app) un-hides
        // the window. This is what does it on Windows and Linux, where the
        // repaint timer above keeps running while the window is hidden and
        // so this loop is still here to be asked.
        //
        // On macOS it is not: a hidden window is never drawn, so this loop
        // is stopped and mac_window has already ordered the window in by
        // the time the frame it woke gets here. Re-issuing the commands
        // costs nothing — asking a visible window to be visible and
        // focused is what the request meant anyway — and leaving the flag
        // on one code path for all three platforms is worth more than
        // saving them.
        if let Some(tray) = &self.tray {
            if tray.show.take() {
                ctx.send_viewport_cmd(egui::ViewportCommand::Visible(true));
                ctx.send_viewport_cmd(egui::ViewportCommand::Focus);
            }
        }

        let snap = self.ui_state.snapshot();

        ui.style_mut().visuals.panel_fill = PANEL_BG;
        egui::Frame::NONE.fill(PANEL_BG).show(ui, |ui| {
            ui.vertical_centered(|ui| {
                ui.add_space(28.0);
                self.render_medallion(ui, &snap);
                ui.add_space(14.0);

                let (headline, subline) = headline_for(&snap);
                ui.label(egui::RichText::new(headline).size(19.0).strong().color(egui::Color32::WHITE));
                ui.add_space(4.0);
                if !subline.is_empty() {
                    ui.label(egui::RichText::new(subline).size(13.0).color(SUBTLE_FG));
                }
                ui.add_space(18.0);

                if matches!(snap.state, ConnState::Blocked | ConnState::Revoked) {
                    self.render_notice(ui, &snap);
                    ui.add_space(14.0);
                }

                if matches!(snap.state, ConnState::Connected | ConnState::Paused) {
                    self.render_profile(ui, &snap);
                    ui.add_space(14.0);
                }

                self.render_cta(ui, &snap);

                let live = matches!(snap.state, ConnState::Connected | ConnState::Paused);
                if live {
                    ui.add_space(8.0);
                    if ui.add_sized([260.0, 34.0], egui::Button::new("Run in background")).clicked() {
                        self.running_in_background.store(true, Ordering::SeqCst);
                        ctx.send_viewport_cmd(egui::ViewportCommand::Visible(false));
                    }
                }

                // Disconnect only on personal hardware — see ui_state.rs's
                // doc comment on set_ownership for why this is not
                // optional polish: on company equipment there is no
                // consent bargain to honour, and the button would simply
                // be a hole in protection.
                if live && snap.ownership == "personal" {
                    ui.add_space(8.0);
                    let btn = egui::Button::new(egui::RichText::new("Disconnect").color(DANGER))
                        .stroke(egui::Stroke::new(1.0, DANGER.gamma_multiply(0.5)));
                    if ui.add_sized([260.0, 34.0], btn).clicked() {
                        self.confirm_disconnect = true;
                    }
                }

                // A small text link, not a full button — removal is rare
                // and deliberately less prominent than Disconnect, which
                // an employee might reach for often on their own hardware.
                // `uninstall_allowed` comes from the server (see
                // ui_state.rs), so this simply doesn't render on a device
                // the company hasn't granted removal on, rather than
                // showing a button that would just answer "no" every time.
                if live && snap.uninstall_allowed {
                    ui.add_space(10.0);
                    if ui.add(egui::Label::new(egui::RichText::new("Uninstall the connector").size(11.0).color(SUBTLE_FG)).sense(egui::Sense::click())).clicked() {
                        self.uninstall.showing = true;
                        self.uninstall.error = None;
                    }
                }
            });
        });

        if self.confirm_disconnect {
            self.render_disconnect_confirm(ui, &ctx);
        }

        // Polled here, once per frame, alongside the tray's own
        // show signal above — try_recv is non-blocking and needs
        // no runtime context, so this is safe to call from the GUI's sync
        // frame loop even though the sender lives on the background
        // thread's tokio runtime.
        if let Some(rx) = &mut self.uninstall.pending {
            match rx.try_recv() {
                Ok(Ok(())) => {
                    self.uninstall.pending = None;
                    self.uninstall.showing = false;
                    self.uninstall.password.clear();
                }
                Ok(Err(message)) => {
                    self.uninstall.pending = None;
                    self.uninstall.error = Some(message);
                }
                Err(tokio::sync::oneshot::error::TryRecvError::Empty) => {}
                Err(tokio::sync::oneshot::error::TryRecvError::Closed) => {
                    self.uninstall.pending = None;
                    self.uninstall.error = Some("Something went wrong. Please try again.".to_string());
                }
            }
        }

        if self.uninstall.showing {
            self.render_uninstall_dialog(ui, &ctx);
        }
    }
}

impl ConnectorApp {
    fn render_medallion(&self, ui: &mut egui::Ui, snap: &crate::ui_state::Snapshot) {
        let (color, glyph) = match snap.state {
            ConnState::Connected => (SUCCESS, "✓"),
            ConnState::Paused => (WARN, "⏸"),
            ConnState::Connecting => (BRAND, "…"),
            ConnState::Blocked | ConnState::Revoked => (DANGER, "!"),
            ConnState::Disconnected => (SUBTLE_FG, ""),
        };
        let (rect, _) = ui.allocate_exact_size(egui::vec2(80.0, 80.0), egui::Sense::hover());
        let painter = ui.painter();
        painter.circle_stroke(rect.center(), 38.0, egui::Stroke::new(1.5, color));
        painter.text(rect.center(), egui::Align2::CENTER_CENTER, "🛡", egui::FontId::proportional(34.0), color);
        if !glyph.is_empty() {
            painter.text(
                rect.center() + egui::vec2(14.0, 14.0),
                egui::Align2::CENTER_CENTER,
                glyph,
                egui::FontId::proportional(14.0),
                color,
            );
        }
    }

    fn render_notice(&self, ui: &mut egui::Ui, snap: &crate::ui_state::Snapshot) {
        egui::Frame::NONE
            .fill(DANGER.gamma_multiply(0.07))
            .stroke(egui::Stroke::new(1.0, DANGER.gamma_multiply(0.28)))
            .corner_radius(9.0)
            .inner_margin(12.0)
            .show(ui, |ui| {
                ui.set_width(280.0);
                let title = match snap.state {
                    ConnState::Blocked => "Device already registered",
                    ConnState::Revoked => "Device not registered",
                    _ => "",
                };
                ui.label(egui::RichText::new(title).strong().color(DANGER));
                let fallback = match snap.state {
                    ConnState::Blocked => "Your device entry already exists — ask your company IT administrator for permission to reconnect.",
                    ConnState::Revoked => "This device is no longer registered. Reconnect it, or ask your company IT administrator.",
                    _ => "",
                };
                let body = if snap.message.is_empty() { fallback } else { &snap.message };
                ui.label(egui::RichText::new(body).size(12.0).color(BODY_FG));
            });
    }

    fn render_profile(&self, ui: &mut egui::Ui, snap: &crate::ui_state::Snapshot) {
        egui::Frame::NONE
            .fill(if snap.state == ConnState::Connected { SUCCESS.gamma_multiply(0.05) } else { CARD_BG })
            .stroke(egui::Stroke::new(
                1.0,
                if snap.state == ConnState::Connected { SUCCESS.gamma_multiply(0.28) } else { egui::Color32::from_gray(0x26) },
            ))
            .corner_radius(9.0)
            .inner_margin(egui::Margin::symmetric(13, 11))
            .show(ui, |ui| {
                ui.set_width(280.0);
                ui.horizontal(|ui| {
                    let initial = snap.org_name.chars().next().unwrap_or('A').to_uppercase().to_string();
                    egui::Frame::NONE.fill(BRAND).corner_radius(7.0).inner_margin(6.0).show(ui, |ui| {
                        ui.label(egui::RichText::new(initial).strong().color(egui::Color32::BLACK));
                    });
                    ui.vertical(|ui| {
                        let org = if snap.org_name.is_empty() { "Your company" } else { &snap.org_name };
                        ui.label(egui::RichText::new(org).size(13.5).strong().color(egui::Color32::WHITE));
                        let who = if snap.employee_name.is_empty() { "This device" } else { &snap.employee_name };
                        ui.label(egui::RichText::new(who).size(11.5).color(SUBTLE_FG));
                    });
                    if !snap.uptime.is_empty() {
                        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                            let color = if snap.state == ConnState::Connected { SUCCESS } else { WARN };
                            ui.label(egui::RichText::new(&snap.uptime).size(11.0).color(color));
                        });
                    }
                });
            });
    }

    fn render_cta(&mut self, ui: &mut egui::Ui, snap: &crate::ui_state::Snapshot) {
        let (label, enabled, primary) = match snap.state {
            ConnState::Disconnected => ("Connect", true, true),
            ConnState::Connecting => ("Cancel", true, false),
            ConnState::Connected | ConnState::Paused => ("Connected", false, false),
            ConnState::Blocked => ("Waiting for permission", false, false),
            ConnState::Revoked => ("Reconnect", true, true),
        };

        let button = if primary {
            egui::Button::new(egui::RichText::new(label).strong().color(egui::Color32::BLACK)).fill(BRAND)
        } else {
            egui::Button::new(label)
        };

        let resp = ui.add_enabled_ui(enabled, |ui| ui.add_sized([260.0, 38.0], button)).inner;
        if resp.clicked() {
            match snap.state {
                ConnState::Disconnected | ConnState::Revoked => self.send(Command::Connect),
                ConnState::Connecting => self.send(Command::CancelConnect),
                _ => {}
            }
        }
    }

    fn render_disconnect_confirm(&mut self, ui: &mut egui::Ui, ctx: &egui::Context) {
        egui::Window::new("Disconnect this device?")
            .collapsible(false)
            .resizable(false)
            .anchor(egui::Align2::CENTER_CENTER, egui::vec2(0.0, 0.0))
            .show(ctx, |ui| {
                ui.set_width(300.0);
                ui.label("Protection stops and your company is notified.");
                ui.add_space(10.0);
                ui.horizontal(|ui| {
                    if ui.button("Cancel").clicked() {
                        self.confirm_disconnect = false;
                    }
                    let btn = egui::Button::new(egui::RichText::new("Disconnect").color(egui::Color32::WHITE)).fill(DANGER);
                    if ui.add(btn).clicked() {
                        self.send(Command::Disconnect);
                        self.confirm_disconnect = false;
                    }
                });
            });
        let _ = ui; // the confirm dialog is drawn via ctx directly, above
    }

    /// Company administrator credentials, verified server-side before
    /// anything is removed — mirrors Python's `begin_uninstall` dialog.
    /// The employee cannot approve their own device's removal; this form
    /// only ever succeeds against an org_admin account of the same
    /// company (enforced by `AuthorizeUninstall` on the server, not by
    /// anything client-side).
    fn render_uninstall_dialog(&mut self, ui: &mut egui::Ui, ctx: &egui::Context) {
        let _ = ui; // drawn via ctx directly below, same as render_disconnect_confirm
        let pending = self.uninstall.pending.is_some();
        egui::Window::new("Remove the connector")
            .collapsible(false)
            .resizable(false)
            .anchor(egui::Align2::CENTER_CENTER, egui::vec2(0.0, 0.0))
            .show(ctx, |ui| {
                ui.set_width(300.0);
                ui.label(egui::RichText::new("Requires a company administrator's credentials.").size(12.0).color(SUBTLE_FG));
                ui.add_space(8.0);

                ui.add_enabled_ui(!pending, |ui| {
                    ui.label("Administrator email");
                    ui.add_sized([280.0, 24.0], egui::TextEdit::singleline(&mut self.uninstall.email));
                    ui.add_space(6.0);
                    ui.label("Password");
                    ui.add_sized([280.0, 24.0], egui::TextEdit::singleline(&mut self.uninstall.password).password(true));
                });

                if let Some(err) = &self.uninstall.error {
                    ui.add_space(8.0);
                    ui.label(egui::RichText::new(err).size(12.0).color(DANGER));
                }

                ui.add_space(10.0);
                ui.horizontal(|ui| {
                    if ui.add_enabled(!pending, egui::Button::new("Cancel")).clicked() {
                        self.uninstall.showing = false;
                        self.uninstall.password.clear();
                        self.uninstall.error = None;
                    }
                    let label = if pending { "Removing…" } else { "Remove" };
                    let ready = !pending && !self.uninstall.email.trim().is_empty() && !self.uninstall.password.is_empty();
                    let btn = egui::Button::new(egui::RichText::new(label).color(egui::Color32::WHITE)).fill(DANGER);
                    if ui.add_enabled(ready, btn).clicked() {
                        self.send_uninstall();
                    }
                });
            });
    }

    /// Builds the response channel `Command::Uninstall` carries, sends the
    /// command, and stashes the receiving half to be polled once per frame
    /// — see the `try_recv` loop in `ui()`.
    fn send_uninstall(&mut self) {
        let email = self.uninstall.email.trim().to_string();
        let password = std::mem::take(&mut self.uninstall.password);
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.uninstall.error = None;
        self.uninstall.pending = Some(rx);
        self.send(Command::Uninstall { email, password, respond: tx });
    }
}

/// (headline, subline) for the current state — a direct port of the
/// `if/else if` chain in `main.html`'s `paint()`.
fn headline_for(snap: &crate::ui_state::Snapshot) -> (&'static str, String) {
    match snap.state {
        ConnState::Connected => ("Protected", "Your device is connected and monitored".to_string()),
        ConnState::Paused => (
            "Paused",
            if snap.reason.is_empty() { "Personal time — monitoring is off".to_string() } else { snap.reason.clone() },
        ),
        ConnState::Connecting => ("Waiting for browser", "Finish signing in — this window updates on its own".to_string()),
        ConnState::Blocked => ("Can't connect", String::new()),
        ConnState::Revoked => ("Not protected", String::new()),
        ConnState::Disconnected => ("Not connected", "Sign in to protect this device".to_string()),
    }
}

/// Also used by the tray to build its own status line — see tray.rs.
pub fn tray_status_text(state: ConnState) -> &'static str {
    match state {
        ConnState::Connected => "Protected",
        ConnState::Paused => "Paused — personal time",
        ConnState::Connecting => "Signing in…",
        ConnState::Blocked => "Needs IT approval",
        ConnState::Revoked => "Not protected — reconnect needed",
        ConnState::Disconnected => "Not connected",
    }
}
