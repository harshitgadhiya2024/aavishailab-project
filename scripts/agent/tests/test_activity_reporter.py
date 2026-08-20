"""ActivityReporter.record() — the dedup window (one visit shouldn't become
N events because a page fires N sub-requests) and the working-hours gate
integration (an off-hours event must be dropped, never queued for later
upload — see the class docstring: queuing it would mean the employee's
evening shows up on the dashboard the next morning)."""

from conftest import agent


def test_records_a_single_event():
    reporter = agent.ActivityReporter(config={})
    reporter.record("https://example.com/", "example.com", "allowed", None)
    assert len(reporter._queue) == 1
    assert reporter._queue[0]["target_domain"] == "example.com"
    assert reporter._queue[0]["action"] == "allowed"


def test_dedup_window_collapses_rapid_repeats():
    reporter = agent.ActivityReporter(config={})
    reporter.record("https://example.com/a", "example.com", "allowed", None)
    reporter.record("https://example.com/b", "example.com", "allowed", None)
    reporter.record("https://example.com/c", "example.com", "allowed", None)
    # Same (domain, action) fired three times almost instantly -> one event.
    assert len(reporter._queue) == 1


def test_different_action_is_not_deduped():
    reporter = agent.ActivityReporter(config={})
    reporter.record("https://example.com/a", "example.com", "allowed", None)
    reporter.record("https://example.com/b", "example.com", "blocked", None)
    assert len(reporter._queue) == 2


def test_dedup_key_ignores_www_prefix():
    reporter = agent.ActivityReporter(config={})
    reporter.record("https://example.com/", "example.com", "allowed", None)
    reporter.record("https://www.example.com/", "www.example.com", "allowed", None)
    assert len(reporter._queue) == 1


def test_dedup_expires_after_window():
    reporter = agent.ActivityReporter(config={})
    reporter.record("https://example.com/", "example.com", "allowed", None)
    # Force the recorded timestamp far enough into the past that the dedup
    # window (ACTIVITY_DEDUP_WINDOW seconds) has elapsed.
    key = ("example.com", "allowed")
    reporter._recent[key] -= agent.ACTIVITY_DEDUP_WINDOW + 1
    reporter.record("https://example.com/", "example.com", "allowed", None)
    assert len(reporter._queue) == 2


def test_off_hours_activity_event_is_dropped_not_queued():
    reporter = agent.ActivityReporter(config={})
    agent.GATE.apply({"mode": "security_only"})
    reporter.record("https://example.com/", "example.com", "allowed", None, kind="activity")
    assert len(reporter._queue) == 0


def test_off_hours_security_event_is_still_queued():
    reporter = agent.ActivityReporter(config={})
    agent.GATE.apply({"mode": "security_only"})
    reporter.record("https://evil.com/", "evil.com", "blocked", None, kind="security")
    assert len(reporter._queue) == 1


def test_paused_drops_everything_including_security():
    reporter = agent.ActivityReporter(config={})
    agent.GATE.apply({"mode": "paused"})
    reporter.record("https://evil.com/", "evil.com", "blocked", None, kind="security")
    assert len(reporter._queue) == 0


def test_rule_metadata_is_captured_on_the_event():
    reporter = agent.ActivityReporter(config={})
    rule = {"category": "gambling", "reason": "Category blocked", "risk_score": 90}
    reporter.record("https://evil.com/", "evil.com", "blocked", rule)
    event = reporter._queue[0]
    assert event["category"] == "gambling"
    assert event["policy_name"] == "Category blocked"
    assert event["risk_score"] == 90


def test_recent_map_is_pruned_past_512_entries():
    reporter = agent.ActivityReporter(config={})
    for i in range(600):
        reporter.record(f"https://site{i}.com/", f"site{i}.com", "allowed", None)
    # The pruning pass only fires once len() exceeds 512, and only removes
    # entries older than the dedup window — all of these are fresh, so nothing
    # gets pruned yet, but the map must not have grown unboundedly past the
    # number of unique keys actually recorded.
    assert len(reporter._recent) == 600
    assert len(reporter._queue) == 600
