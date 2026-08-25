"""The single-instance lock, and the hand-off it enables.

Now that the app installs to /Applications, opening it from Spotlight,
Launchpad or the Dock starts a second copy while the LaunchAgent's is
already running. The second one must lose the lock AND be able to tell the
first to raise its window — exiting silently would make clicking the icon
look broken.

The PID hand-off is the fragile half: an earlier version opened the lock
file with "w", which truncates on open, so a losing instance wiped the
winner's PID before its own lock attempt had even failed. Nothing was left
to signal. These run in real subprocesses because that bug only appears
across processes.
"""

import importlib.util
import multiprocessing
import os
import signal
import sys
import tempfile
import time

_AGENT = os.path.join(os.path.dirname(__file__), "..", "aavishield-agent.py")


def _load(home):
    os.environ["HOME"] = home
    spec = importlib.util.spec_from_file_location("ag_proc", os.path.abspath(_AGENT))
    mod = importlib.util.module_from_spec(spec)
    sys.modules["ag_proc"] = mod
    spec.loader.exec_module(mod)
    return mod


def _winner(home, q):
    m = _load(home)
    q.put(("lock", m.acquire_single_instance_lock()))
    received = []
    signal.signal(signal.SIGUSR1, lambda *_: received.append(1))
    q.put(("ready", True))
    for _ in range(80):          # up to ~4s
        if received:
            break
        time.sleep(0.05)
    q.put(("signalled", bool(received)))


def _loser(home, q):
    m = _load(home)
    q.put(("loser_lock", m.acquire_single_instance_lock()))
    m._signal_running_instance_to_show()


def test_second_launch_loses_lock_and_wakes_the_first():
    with tempfile.TemporaryDirectory() as home:
        ctx = multiprocessing.get_context("spawn")
        q = ctx.Queue()
        w = ctx.Process(target=_winner, args=(home, q))
        w.start()
        results = {}
        k, v = q.get(timeout=30); results[k] = v
        k, v = q.get(timeout=30); results[k] = v          # "ready"
        assert results["lock"] is True, "first instance must acquire the lock"

        time.sleep(0.3)
        l = ctx.Process(target=_loser, args=(home, q))
        l.start()
        l.join(timeout=30)
        w.join(timeout=30)

        while not q.empty():
            k, v = q.get(); results[k] = v

        assert results["loser_lock"] is False, "second instance must not get the lock"
        assert results["signalled"] is True, (
            "second instance must signal the first to show its window — "
            "check the lock file isn't opened in a truncating mode"
        )
