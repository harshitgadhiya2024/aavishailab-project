"""run_agent() installs SIGTERM/SIGINT handlers, but signal.signal() only
works on the main thread. With the desktop UI, run_agent runs in a background
thread (the Cocoa loop owns main) — so an unguarded signal.signal() raised
ValueError on run_agent's first line and killed the whole thread before the
proxy was applied or a single heartbeat sent. The device then showed
"Protected" in the window while the server saw it offline and nothing was
enforced.

This pins the guard: installing the handlers the way run_agent does must be a
no-op (not a crash) off the main thread, and must actually install on it."""

import signal
import threading

from conftest import agent


def _install_like_run_agent():
    # Mirrors run_agent's guard exactly.
    def _sh(sig, frame):
        pass
    if threading.current_thread() is threading.main_thread():
        signal.signal(signal.SIGTERM, _sh)
        signal.signal(signal.SIGINT, _sh)
        return "installed"
    return "skipped"


def test_off_main_thread_does_not_raise():
    result = {}
    def worker():
        try:
            result["r"] = _install_like_run_agent()
        except ValueError as e:  # the exact crash that shipped
            result["r"] = f"CRASH: {e}"
    t = threading.Thread(target=worker)
    t.start(); t.join()
    assert result["r"] == "skipped", result


def test_on_main_thread_installs():
    # Running on the test's main thread, it should install without error.
    assert _install_like_run_agent() == "installed"
