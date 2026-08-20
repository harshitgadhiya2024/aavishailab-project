"""ThreatIntelCache / CASBControlCache — TTL caching around a network
lookup. _lookup is monkeypatched so these tests never touch the network;
they verify the cache hit/miss/expiry logic, which is the part with actual
branching to get wrong."""

from conftest import agent


def test_threat_cache_miss_calls_lookup(monkeypatch):
    cache = agent.ThreatIntelCache(config={})
    calls = []
    monkeypatch.setattr(cache, "_lookup", lambda host: calls.append(host) or {"action": "block"})
    result = cache.check("evil.com")
    assert calls == ["evil.com"]
    assert result == {"action": "block"}


def test_threat_cache_hit_does_not_call_lookup_again(monkeypatch):
    cache = agent.ThreatIntelCache(config={})
    calls = []
    monkeypatch.setattr(cache, "_lookup", lambda host: calls.append(host) or {"action": "block"})
    cache.check("evil.com")
    cache.check("evil.com")
    cache.check("evil.com")
    assert calls == ["evil.com"]  # only the first call actually hit _lookup


def test_threat_cache_expiry_triggers_a_fresh_lookup(monkeypatch):
    cache = agent.ThreatIntelCache(config={})
    calls = []
    monkeypatch.setattr(cache, "_lookup", lambda host: calls.append(host) or None)
    cache.check("evil.com")
    # Force the cached entry to look expired.
    expiry, verdict = cache._cache["evil.com"]
    cache._cache["evil.com"] = (expiry - agent.THREAT_CACHE_TTL - 1, verdict)
    cache.check("evil.com")
    assert calls == ["evil.com", "evil.com"]


def test_threat_cache_host_normalization_shares_one_cache_entry(monkeypatch):
    cache = agent.ThreatIntelCache(config={})
    calls = []
    monkeypatch.setattr(cache, "_lookup", lambda host: calls.append(host) or None)
    cache.check("EVIL.com")
    cache.check("www.evil.com")
    assert calls == ["evil.com"]  # both normalize to the same key


def test_threat_cache_revoked_agent_skips_lookup_entirely(monkeypatch):
    cache = agent.ThreatIntelCache(config={})
    calls = []
    monkeypatch.setattr(cache, "_lookup", lambda host: calls.append(host) or {"action": "block"})
    agent.AGENT_REVOKED.set()
    try:
        assert cache.check("evil.com") is None
    finally:
        agent.AGENT_REVOKED.clear()
    assert calls == []


def test_casb_cache_key_is_scoped_by_activity_not_just_host(monkeypatch):
    cache = agent.CASBControlCache(config={})
    calls = []

    def fake_lookup(host, activity):
        calls.append((host, activity))
        return {"action": "block"} if activity == "upload" else None

    monkeypatch.setattr(cache, "_lookup", fake_lookup)
    upload_result = cache.check("drive.google.com", "upload")
    download_result = cache.check("drive.google.com", "download")
    assert upload_result == {"action": "block"}
    assert download_result is None
    assert calls == [("drive.google.com", "upload"), ("drive.google.com", "download")]


def test_casb_cache_hit_does_not_relookup(monkeypatch):
    cache = agent.CASBControlCache(config={})
    calls = []
    monkeypatch.setattr(cache, "_lookup", lambda host, activity: calls.append((host, activity)) or {"action": "alert"})
    cache.check("drive.google.com", "upload")
    cache.check("drive.google.com", "upload")
    assert len(calls) == 1
