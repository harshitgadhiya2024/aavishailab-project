"""UploadCarryCache + _ChainedReader — resumable-upload boundary coverage.

A sensitive value split across two Content-Range chunks (Google Drive,
OneDrive, Slack resumable uploads) must still be detected by carrying the
previous chunk's tail into the next chunk's scan. See the class docstring
in aavishield-agent.py for the full rationale.
"""

import io

from conftest import agent


def test_session_key_none_without_content_range():
    headers = b"PUT /upload HTTP/1.1\r\nHost: example.com\r\nContent-Length: 10\r\n\r\n"
    assert agent.UploadCarryCache.session_key(headers, "example.com", "/upload") is None


def test_session_key_present_with_content_range():
    headers = b"PUT /upload HTTP/1.1\r\nContent-Range: bytes 0-999/5000\r\n\r\n"
    key = agent.UploadCarryCache.session_key(headers, "drive.google.com", "/upload/session123")
    assert key == ("drive.google.com", "/upload/session123")


def test_take_returns_empty_for_unknown_session():
    cache = agent.UploadCarryCache()
    assert cache.take(("host", "/path")) == b""
    assert cache.take(None) == b""


def test_update_then_take_round_trips_tail():
    cache = agent.UploadCarryCache()
    key = ("host", "/session")
    content = b"A" * 100_000 + b"CARD:4111111111111111"
    spool = io.BytesIO(content)
    cache.update(key, spool, len(content))

    tail = cache.take(key)
    assert tail == content[-agent.UPLOAD_CARRY_TAIL_BYTES:]
    assert b"4111111111111111" in tail


def test_take_consumes_the_entry_once():
    cache = agent.UploadCarryCache()
    key = ("host", "/session")
    spool = io.BytesIO(b"x" * 1000)
    cache.update(key, spool, 1000)

    assert cache.take(key) != b""
    # A second take (e.g. a retried/duplicate chunk) must not still see it —
    # entries are one-shot so a session can't accidentally replay stale tail
    # bytes into an unrelated later chunk.
    assert cache.take(key) == b""


def test_update_evicts_oldest_beyond_max_sessions():
    cache = agent.UploadCarryCache()
    for i in range(agent.UPLOAD_CARRY_MAX_SESSIONS + 10):
        spool = io.BytesIO(b"x" * 10)
        cache.update((f"host{i}", "/s"), spool, 10)
    assert len(cache._sessions) <= agent.UPLOAD_CARRY_MAX_SESSIONS


def test_expired_entry_not_returned():
    cache = agent.UploadCarryCache()
    key = ("host", "/session")
    # Insert an already-expired entry directly, bypassing update()'s TTL.
    cache._sessions[key] = (0.0, b"stale-tail")
    assert cache.take(key) == b""


def test_chained_reader_read_all_prepends_prefix():
    reader = agent._ChainedReader(b"PREFIX-", io.BytesIO(b"REST"))
    assert reader.read(-1) == b"PREFIX-REST"


def test_chained_reader_bounded_reads_span_boundary():
    reader = agent._ChainedReader(b"AB", io.BytesIO(b"CDEF"))
    assert reader.read(1) == b"A"
    assert reader.read(3) == b"BCD"  # crosses from prefix into the spool
    assert reader.read(10) == b"EF"
    assert reader.read(10) == b""


def test_chained_reader_empty_prefix_delegates_directly():
    spool = io.BytesIO(b"HELLO")
    reader = agent._ChainedReader(b"", spool)
    assert reader.read(5) == b"HELLO"
