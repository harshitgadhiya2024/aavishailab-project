"""_parse_rfc3339 / _seconds_between — these exist specifically to hold the
working-hours deadline against a MONOTONIC clock computed from the
server's own timestamps, so the device's wall clock never enters the
calculation (see EnforcementGate's docstring: "set the clock to Sunday"
must not end the working day early). The 9-vs-6-digit fractional-second
handling is a real Go/Python interop edge — Go's time.Format emits
nanosecond precision, Python's datetime.fromisoformat caps at 6 digits."""

import datetime

from conftest import agent


def test_parses_z_suffix_as_utc():
    dt = agent._parse_rfc3339("2026-01-01T12:00:00Z")
    assert dt is not None
    assert dt.tzinfo == datetime.timezone.utc
    assert dt.hour == 12


def test_parses_explicit_offset():
    dt = agent._parse_rfc3339("2026-01-01T12:00:00+05:30")
    assert dt is not None
    assert dt.utcoffset() == datetime.timedelta(hours=5, minutes=30)


def test_truncates_go_nanosecond_precision_to_six_digits():
    # Go emits 9 fractional digits; Python's fromisoformat rejects more
    # than 6. Without truncation this raises ValueError and the whole
    # enforcement deadline silently fails to parse.
    dt = agent._parse_rfc3339("2026-01-01T12:00:00.123456789Z")
    assert dt is not None
    assert dt.microsecond == 123456


def test_naive_datetime_gets_utc_attached():
    dt = agent._parse_rfc3339("2026-01-01T12:00:00")
    assert dt is not None
    assert dt.tzinfo == datetime.timezone.utc


def test_none_and_empty_return_none():
    assert agent._parse_rfc3339(None) is None
    assert agent._parse_rfc3339("") is None


def test_garbage_input_returns_none_not_an_exception():
    assert agent._parse_rfc3339("not a timestamp") is None


def test_seconds_between_uses_server_clock_for_both_ends():
    remaining = agent._seconds_between("2026-01-01T12:00:00Z", "2026-01-01T13:00:00Z")
    assert remaining == 3600.0


def test_seconds_between_negative_when_deadline_already_passed():
    remaining = agent._seconds_between("2026-01-01T13:00:00Z", "2026-01-01T12:00:00Z")
    assert remaining == -3600.0


def test_seconds_between_falls_back_to_now_when_server_time_missing():
    # Falls back to wall-clock "now" only for the START of the interval —
    # still doesn't let the DEVICE's clock decide the deadline itself,
    # since `until` still comes from the server.
    far_future = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=3650)).isoformat()
    remaining = agent._seconds_between(None, far_future)
    assert remaining is not None
    assert remaining > 0


def test_seconds_between_none_when_until_unparseable():
    assert agent._seconds_between("2026-01-01T12:00:00Z", "garbage") is None
