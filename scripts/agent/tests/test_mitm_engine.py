"""MITMEngine.policy_enabled() — internal state is seeded directly, exactly
like a completed refresh() would (see test_policy_cache.py for the same
pattern), since refresh() itself talks to the network.

This is the flag the macOS desktop UI's "Enable HTTPS protection" banner is
gated on (see run_agent's _watch_ca_state). It must stay True whenever the
org has SSL Inspection turned on, even while the CA isn't trusted yet —
that's exactly the moment the banner needs to appear. _enabled (which also
requires the CA to already be trusted) would hide the banner then, which is
the bug this flag exists to avoid."""

import json

from conftest import agent


class _FakeResponse:
    def __init__(self, body: dict):
        self._body = json.dumps(body).encode("utf-8")

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


_FAKE_CONFIG = {"admin_url": "https://admin.example.com", "device_id": "dev-1", "agent_key": "key-1"}


def make_engine(policy_enabled=False, enabled=False):
    engine = agent.MITMEngine(config={})
    engine._policy_enabled = policy_enabled
    engine._enabled = enabled
    return engine


def test_policy_enabled_defaults_false_before_first_refresh():
    assert agent.MITMEngine(config={}).policy_enabled() is False


def test_policy_enabled_true_while_ca_still_untrusted():
    engine = make_engine(policy_enabled=True, enabled=False)
    assert engine.policy_enabled() is True


def test_policy_enabled_false_when_org_never_turned_it_on():
    engine = make_engine(policy_enabled=False, enabled=False)
    assert engine.policy_enabled() is False


def test_policy_enabled_true_once_ca_is_trusted_too():
    engine = make_engine(policy_enabled=True, enabled=True)
    assert engine.policy_enabled() is True


def test_refresh_reports_policy_enabled_even_when_ca_not_yet_trusted(monkeypatch):
    # The regression this guards against: refresh() used to only track the
    # combined "enabled AND trusted" flag, so a fresh install (CA not
    # trusted yet) looked identical to an org that never enabled SSL
    # Inspection at all — the exact state the "Enable HTTPS protection"
    # banner needs to tell apart.
    engine = agent.MITMEngine(config=_FAKE_CONFIG)
    monkeypatch.setattr(agent, "mitm_ca_trusted", lambda config: False)
    monkeypatch.setattr(agent._DIRECT_OPENER, "open",
                        lambda req, timeout=None: _FakeResponse({"enabled": True, "bypass_domains": []}))
    engine.refresh()
    assert engine.policy_enabled() is True
    assert engine.should_intercept("example.com") is False  # CA not trusted -> no interception


def test_refresh_reports_policy_disabled_when_org_never_turned_it_on(monkeypatch):
    engine = agent.MITMEngine(config=_FAKE_CONFIG)
    monkeypatch.setattr(agent, "mitm_ca_trusted", lambda config: True)
    monkeypatch.setattr(agent._DIRECT_OPENER, "open",
                        lambda req, timeout=None: _FakeResponse({"enabled": False, "bypass_domains": []}))
    engine.refresh()
    assert engine.policy_enabled() is False
