"""PolicyCache.check() — the domain block/allow decision every proxied
request goes through. No network: tests populate _by_domain directly,
exactly like a completed refresh() would."""

from conftest import agent


def make_cache(rules_by_domain):
    cache = agent.PolicyCache(config={})
    cache._by_domain = rules_by_domain
    cache._loaded = True
    return cache


def test_no_rule_allows():
    cache = make_cache({})
    assert cache.check("example.com") is None


def test_exact_domain_match():
    rule = {"domain": "evil.com", "action": "block"}
    cache = make_cache({"evil.com": [rule]})
    assert cache.check("evil.com") == rule


def test_www_prefix_is_stripped():
    rule = {"domain": "evil.com", "action": "block"}
    cache = make_cache({"evil.com": [rule]})
    assert cache.check("www.evil.com") == rule


def test_case_insensitive():
    rule = {"domain": "evil.com", "action": "block"}
    cache = make_cache({"evil.com": [rule]})
    assert cache.check("EVIL.COM") == rule


def test_walks_up_to_parent_domain():
    rule = {"domain": "instagram.com", "action": "block"}
    cache = make_cache({"instagram.com": [rule]})
    assert cache.check("cdn.instagram.com") == rule
    assert cache.check("a.b.c.instagram.com") == rule


def test_never_matches_a_bare_tld():
    # A rule keyed on a single-label parent ("com") must never apply — this
    # is the guard against ever blocking an entire TLD via the parent walk.
    rule = {"domain": "com", "action": "block"}
    cache = make_cache({"com": [rule]})
    assert cache.check("example.com") is None


def test_org_specific_rule_beats_global_rule():
    global_rule = {"domain": "example.com", "action": "allow", "org_id": None}
    org_rule = {"domain": "example.com", "action": "block", "org_id": "org-1"}
    # Order in the list must not matter — org-specific always wins.
    cache = make_cache({"example.com": [global_rule, org_rule]})
    assert cache.check("example.com") == org_rule

    cache2 = make_cache({"example.com": [org_rule, global_rule]})
    assert cache2.check("example.com") == org_rule


def test_falls_back_to_global_rule_when_no_org_rule():
    global_rule = {"domain": "example.com", "action": "allow", "org_id": None}
    cache = make_cache({"example.com": [global_rule]})
    assert cache.check("example.com") == global_rule


def test_child_domain_rule_does_not_leak_to_sibling():
    rule = {"domain": "evil.example.com", "action": "block"}
    cache = make_cache({"evil.example.com": [rule]})
    assert cache.check("safe.example.com") is None
    assert cache.check("example.com") is None


def test_revoked_agent_always_allows():
    rule = {"domain": "evil.com", "action": "block"}
    cache = make_cache({"evil.com": [rule]})
    agent.AGENT_REVOKED.set()
    try:
        assert cache.check("evil.com") is None
    finally:
        agent.AGENT_REVOKED.clear()


def test_unloaded_cache_allows_everything():
    # Before the first successful refresh(), a momentarily-unreachable
    # admin API must not brick browsing.
    cache = agent.PolicyCache(config={})
    assert cache.check("anything.com") is None
