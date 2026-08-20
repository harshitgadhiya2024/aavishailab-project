"""Loads aavishield-agent.py as a module (its filename has a hyphen, so it
can't be `import`ed normally) and resets its process-global mutable state
between tests.

Scope note (see the Rust migration plan, Phase 3): this is groundwork, not
a full test suite. It covers the pure/cross-platform logic that's safe to
exercise on a headless Linux CI box without a real network, a real OS
proxy, or macOS/Windows-specific code paths — policy/threat-intel/CASB
caching, the working-hours enforcement gate, activity dedup, and the
RFC3339/version-compare helpers. It deliberately does NOT cover: the MITM
proxy connection handling, TLS interception, system-proxy manipulation,
screenshot capture, the tray UI, or platform-specific posture probes —
those need a real OS and are out of scope for what got built in this
session. Before any real rewrite (Rust or otherwise) of this file, this
suite needs to grow to cover those paths first, ideally via golden-file
tests recorded against the real agent on each target OS.
"""

import importlib.util
import os
import sys

import pytest

_AGENT_PATH = os.path.join(os.path.dirname(__file__), "..", "aavishield-agent.py")


def _load_agent_module():
    spec = importlib.util.spec_from_file_location("aavishield_agent", _AGENT_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules["aavishield_agent"] = module
    spec.loader.exec_module(module)
    return module


agent = _load_agent_module()


@pytest.fixture(autouse=True)
def _reset_agent_globals():
    """The agent module holds a few process-global singletons (GATE,
    AGENT_REVOKED) that real request handling mutates. Reset them before
    every test so tests can't leak state into each other regardless of
    execution order."""
    agent.AGENT_REVOKED.clear()
    with agent.GATE._lock:
        agent.GATE._mode = "full"
        agent.GATE._reason = "Enforcing continuously"
        agent.GATE._expires_at = None
        agent.GATE._until_text = ""
        agent.GATE._source = ""
        agent.GATE._last_update = agent.time.monotonic()
    yield
