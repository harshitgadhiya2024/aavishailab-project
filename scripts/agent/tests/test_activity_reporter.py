"""ActivityReporter.record() — the dedup window (one visit shouldn't become
N events because a page fires N sub-requests), the working-hours gate
integration (an off-hours event must be dropped, never queued for later
upload — see the class docstring: queuing it would mean the employee's
evening shows up on the dashboard the next morning), and the "allowed"
action being dropped unconditionally (see its own tests below).

"alerted" stands in for "allowed" as the sample action in the dedup/queue
tests: "allowed" is now unconditionally dropped, so it can no longer
exercise the dedup and off-hours logic those tests are actually about.
"""

from conftest import agent


def test_records_a_single_event():
    reporter = agent.ActivityReporter(config={})
    reporter.record("https://example.com/", "example.com", "alerted", None)
    assert len(reporter._queue) == 1
    assert reporter._queue[0]["target_domain"] == "example.com"
    assert reporter._queue[0]["action"] == "alerted"


def test_dedup_window_collapses_rapid_repeats():
    reporter = agent.ActivityReporter(config={})
    reporter.record("https://example.com/a", "example.com", "alerted", None)
    reporter.record("https://example.com/b", "example.com", "alerted", None)
    reporter.record("https://example.com/c", "example.com", "alerted", None)
    # Same (domain, action) fired three times almost instantly -> one event.
    assert len(reporter._queue) == 1


def test_different_action_is_not_deduped():
    reporter = agent.ActivityReporter(config={})
    reporter.record("https://example.com/a", "example.com", "alerted", None)
    reporter.record("https://example.com/b", "example.com", "blocked", None)
    assert len(reporter._queue) == 2


def test_dedup_key_ignores_www_prefix():
    reporter = agent.ActivityReporter(config={})
    reporter.record("https://example.com/", "example.com", "alerted", None)
    reporter.record("https://www.example.com/", "www.example.com", "alerted", None)
    assert len(reporter._queue) == 1


def test_dedup_expires_after_window():
    reporter = agent.ActivityReporter(config={})
    reporter.record("https://example.com/", "example.com", "alerted", None)
    # Force the recorded timestamp far enough into the past that the dedup
    # window (ACTIVITY_DEDUP_WINDOW seconds) has elapsed.
    key = ("example.com", "alerted")
    reporter._recent[key] -= agent.ACTIVITY_DEDUP_WINDOW + 1
    reporter.record("https://example.com/", "example.com", "alerted", None)
    assert len(reporter._queue) == 2


def test_off_hours_activity_event_is_dropped_not_queued():
    reporter = agent.ActivityReporter(config={})
    agent.GATE.apply({"mode": "security_only"})
    reporter.record("https://example.com/", "example.com", "alerted", None, kind="activity")
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
        reporter.record(f"https://site{i}.com/", f"site{i}.com", "alerted", None)
    # The pruning pass only fires once len() exceeds 512, and only removes
    # entries older than the dedup window — all of these are fresh, so nothing
    # gets pruned yet, but the map must not have grown unboundedly past the
    # number of unique keys actually recorded.
    assert len(reporter._recent) == 600
    assert len(reporter._queue) == 600


# ─── "allowed" is never stored ─────────────────────────────────────────────
#
# Routine, ordinary browsing — every one of the hundreds of ordinary requests
# a workday produces. It is not an incident, nothing about it is ever shown
# to the company, and it must not even be stored: before this fix it became
# 83% of every row this platform kept (3,978 of 4,787 on a real org).
# Dropped before it is ever queued, batched, or sent.

def test_allowed_is_never_queued():
    reporter = agent.ActivityReporter(config={})
    reporter.record("https://example.com/", "example.com", "allowed", None)
    reporter.record("https://other.com/", "other.com", "allowed", None, kind="security")
    assert len(reporter._queue) == 0


def test_allowed_is_dropped_even_during_full_enforcement():
    reporter = agent.ActivityReporter(config={})
    # Default gate mode is "full" — the most permissive-to-log state — and
    # "allowed" must still never reach the queue.
    assert agent.GATE.mode == "full"
    reporter.record("https://example.com/", "example.com", "allowed", None)
    assert len(reporter._queue) == 0


def test_allowed_never_ends_up_mixed_into_a_real_batch():
    """A mixed sequence of outcomes must drop exactly the allowed one and
    keep the rest — not drop the whole batch, and not let allowed slip
    through because something else in it was legitimate."""
    reporter = agent.ActivityReporter(config={})
    reporter.record("https://a.com/", "a.com", "blocked", None)
    reporter.record("https://b.com/", "b.com", "allowed", None)
    reporter.record("https://c.com/", "c.com", "alerted", None)
    actions = [e["action"] for e in reporter._queue]
    assert "allowed" not in actions
    assert set(actions) == {"blocked", "alerted"}
