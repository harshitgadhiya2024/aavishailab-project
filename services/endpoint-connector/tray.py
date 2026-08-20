#!/usr/bin/env python3
"""
Delphic Secure Client Connector — tray / menu-bar UI.

This is the user-facing face of the endpoint agent (aavishield-agent.py). The
agent itself runs headless as a system service (launchd / systemd / Windows
service). This tray app gives the employee what a Zscaler-style client
connector gives them:

  • a menu-bar / system-tray icon showing protection status at a glance
    (green shield = protected, grey = paused/not running),
  • their device identity and last sync time,
  • one-click links to the employee portal and the local logs,
  • pause / resume (stop / start the background service),

…without ever exposing the raw proxy internals. It's status + convenience; all
enforcement still happens in the agent service.

Packaged into a single signed binary by aavishield-agent.spec (PyInstaller) and
wrapped in a native installer by build-macos.sh / build-windows.ps1.
"""

from __future__ import annotations

import json
import os
import platform
import socket
import subprocess
import sys
import threading
import time
import webbrowser

CONFIG_PATH = os.path.expanduser("~/.aavishield/config.json")
LOG_PATH = os.path.expanduser("~/.aavishield/agent.log")
LOCAL_PORT = 6118
STATUS_POLL_SECONDS = 5

APP_NAME = "Delphic Secure Client Connector"


# ─── Status ─────────────────────────────────────────────────────────────────────

def load_config() -> dict:
    try:
        with open(CONFIG_PATH) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def is_protected() -> bool:
    """Protected == the agent's local proxy is accepting connections."""
    try:
        with socket.create_connection(("127.0.0.1", LOCAL_PORT), timeout=1):
            return True
    except OSError:
        return False


def last_sync() -> str:
    """Best-effort: the mtime of the agent log is a good proxy for 'last active'."""
    try:
        ts = os.path.getmtime(LOG_PATH)
        return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(ts))
    except OSError:
        return "unknown"


# ─── Service control (best-effort, per-OS) ──────────────────────────────────────

_SERVICE_LABEL = "com.aavishield.agent"


def _run(cmd: list[str]) -> bool:
    try:
        return subprocess.run(cmd, capture_output=True, timeout=10).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def pause_protection() -> None:
    system = platform.system().lower()
    if system == "darwin":
        _run(["launchctl", "unload", os.path.expanduser(f"~/Library/LaunchAgents/{_SERVICE_LABEL}.plist")])
    elif system == "linux":
        _run(["systemctl", "--user", "stop", "aavishield-agent"])
    elif system == "windows":
        _run(["sc", "stop", "AavishieldAgent"])


def resume_protection() -> None:
    system = platform.system().lower()
    if system == "darwin":
        _run(["launchctl", "load", os.path.expanduser(f"~/Library/LaunchAgents/{_SERVICE_LABEL}.plist")])
    elif system == "linux":
        _run(["systemctl", "--user", "start", "aavishield-agent"])
    elif system == "windows":
        _run(["sc", "start", "AavishieldAgent"])


def open_portal() -> None:
    cfg = load_config()
    url = cfg.get("portal_url") or "https://aavishield-employee.aavishailab.com"
    webbrowser.open(url)


def open_logs() -> None:
    system = platform.system().lower()
    if system == "darwin":
        _run(["open", LOG_PATH])
    elif system == "windows":
        os.startfile(LOG_PATH)  # type: ignore[attr-defined]
    else:
        _run(["xdg-open", LOG_PATH])


# ─── Icon ───────────────────────────────────────────────────────────────────────

def _make_icon(protected: bool):
    """A simple shield glyph — green when protected, grey when paused."""
    from PIL import Image, ImageDraw

    size = 64
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    color = (34, 197, 94, 255) if protected else (120, 120, 120, 255)
    # shield outline
    d.polygon(
        [(32, 6), (56, 16), (56, 34), (32, 58), (8, 34), (8, 16)],
        fill=color,
    )
    d.line([(22, 32), (30, 42), (44, 22)], fill=(255, 255, 255, 255), width=5, joint="curve")
    return img


# ─── Tray app ───────────────────────────────────────────────────────────────────

def run_tray() -> int:
    try:
        import pystray
        from pystray import MenuItem as Item
    except ImportError:
        sys.stderr.write(
            "pystray is not installed. Install the build requirements:\n"
            "  pip install -r requirements-build.txt\n"
        )
        return 1

    cfg = load_config()
    device_id = cfg.get("device_id", "not enrolled")
    org_id = cfg.get("org_id", "—")

    state = {"protected": is_protected()}

    def status_text(_=None):
        return "🟢 Protected" if state["protected"] else "⚪ Paused"

    def toggle(icon, item):
        if state["protected"]:
            pause_protection()
        else:
            resume_protection()

    icon = pystray.Icon(
        "aavishield",
        icon=_make_icon(state["protected"]),
        title=APP_NAME,
        menu=pystray.Menu(
            Item(status_text, None, enabled=False),
            Item(lambda _: f"Device: {str(device_id)[:8]}", None, enabled=False),
            Item(lambda _: f"Org: {str(org_id)[:8]}", None, enabled=False),
            Item(lambda _: f"Last sync: {last_sync()}", None, enabled=False),
            pystray.Menu.SEPARATOR,
            Item(lambda _: ("Pause protection" if state["protected"] else "Resume protection"), toggle),
            Item("Open Employee Portal", lambda i, it: open_portal()),
            Item("View logs", lambda i, it: open_logs()),
            pystray.Menu.SEPARATOR,
            Item("Quit", lambda i, it: i.stop()),
        ),
    )

    def poll():
        while True:
            time.sleep(STATUS_POLL_SECONDS)
            now = is_protected()
            if now != state["protected"]:
                state["protected"] = now
                icon.icon = _make_icon(now)
            icon.update_menu()

    threading.Thread(target=poll, daemon=True).start()
    icon.run()
    return 0


if __name__ == "__main__":
    raise SystemExit(run_tray())
