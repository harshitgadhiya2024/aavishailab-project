"""EnforcementGate — the BYOD working-hours gate. This is the piece that
guarantees a personal laptop isn't monitored outside working hours, so its
per-mode capability matrix is worth pinning down explicitly."""

from conftest import agent


def test_default_mode_is_full():
    gate = agent.EnforcementGate()
    assert gate.mode == "full"
    assert gate.intercepts()
    assert gate.enforces_policy()
    assert gate.enforces_dlp()
    assert gate.enforces_app_control()
    assert gate.scans_downloads()
    assert gate.checks_threat_intel()
    assert gate.captures_screenshots()
    assert gate.logs("activity")
    assert gate.logs("security")


def test_paused_mode_disables_everything_including_interception():
    gate = agent.EnforcementGate()
    gate.apply({"mode": "paused", "reason": "outside working hours"})
    assert gate.mode == "paused"
    assert not gate.intercepts()  # the system proxy must come off entirely
    assert not gate.enforces_policy()
    assert not gate.enforces_dlp()
    assert not gate.enforces_app_control()
    assert not gate.scans_downloads()
    assert not gate.checks_threat_intel()
    assert not gate.captures_screenshots()
    assert not gate.logs("activity")
    assert not gate.logs("security")


def test_security_only_mode_keeps_machine_protection_drops_monitoring():
    gate = agent.EnforcementGate()
    gate.apply({"mode": "security_only", "reason": "off hours, BYOD"})
    assert gate.mode == "security_only"
    assert gate.intercepts()  # still proxying — just not watching the person
    assert not gate.enforces_policy()
    assert not gate.enforces_dlp()
    assert not gate.enforces_app_control()
    assert gate.scans_downloads()       # machine protection survives
    assert gate.checks_threat_intel()   # machine protection survives
    assert not gate.captures_screenshots()  # monitoring, not protection
    assert not gate.logs("activity")    # ordinary browsing telemetry: off
    assert gate.logs("security")        # a malware/threat block: still logged


def test_apply_returns_new_mode_only_on_change():
    gate = agent.EnforcementGate()
    assert gate.apply({"mode": "full"}) is None  # already full, no change
    assert gate.apply({"mode": "paused"}) == "paused"
    assert gate.apply({"mode": "paused"}) is None  # no change this time
    assert gate.apply({"mode": "full"}) == "full"


def test_apply_defaults_unknown_mode_to_full():
    gate = agent.EnforcementGate()
    gate.apply({"mode": "paused"})
    gate.apply({"mode": "nonsense"})
    assert gate.mode == "full"


def test_apply_active_flag_without_mode_maps_to_full_or_paused():
    gate = agent.EnforcementGate()
    gate.apply({"active": False})
    assert gate.mode == "paused"
    gate.apply({"active": True})
    assert gate.mode == "full"


def test_apply_ignores_non_dict_payload():
    gate = agent.EnforcementGate()
    assert gate.apply(None) is None
    assert gate.apply("not a dict") is None
    assert gate.mode == "full"


def test_reason_and_until_text_are_recorded():
    gate = agent.EnforcementGate()
    gate.apply({"mode": "paused", "reason": "Friday 6pm schedule", "until": "2026-01-01T00:00:00Z"})
    assert gate.reason == "Friday 6pm schedule"
    assert gate.until_text == "2026-01-01T00:00:00Z"
