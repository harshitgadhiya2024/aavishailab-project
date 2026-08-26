"""ActivityMonitor must not touch the input APIs until monitoring is actually on.

pynput's macOS backend installs a Quartz event tap and spins a CoreFoundation
run loop. Starting that from a background thread, while the app's own Cocoa
loop owns main, in an unsigned bundle without Input Monitoring permission, is
what made the connector hang on launch and abort with SIGTRAP straight after
enrolment. An org with monitoring switched off should never pay that cost —
and never needed to, since nothing reads these counters until a screenshot is
captured."""

import threading
import time

from conftest import agent


def test_start_is_idempotent():
    m = agent.ActivityMonitor()
    m._listeners = ["already-running"]      # pretend listeners exist
    m.start()                                # must return immediately
    assert m._listeners == ["already-running"]


def test_does_not_start_while_screenshots_are_disabled():
    m = agent.ActivityMonitor()
    started = []
    m.start = lambda: started.append(1)      # type: ignore[method-assign]

    agent.SCREENSHOT.enabled = False
    t = threading.Thread(target=m.start_when_enabled, daemon=True)
    t.start()
    time.sleep(0.2)
    assert started == [], "listeners must stay off while monitoring is disabled"


def test_starts_once_monitoring_turns_on():
    m = agent.ActivityMonitor()
    calls = []

    def fake_start():
        calls.append(1)
        m._listeners = ["listening"]         # what a real start would set

    m.start = fake_start                     # type: ignore[method-assign]
    agent.SCREENSHOT.enabled = True          # gate open; GATE defaults to full
    t = threading.Thread(target=m.start_when_enabled, daemon=True)
    t.start()
    t.join(timeout=3)
    agent.SCREENSHOT.enabled = False         # leave global state as found
    assert calls == [1], "should start exactly once when monitoring is enabled"
