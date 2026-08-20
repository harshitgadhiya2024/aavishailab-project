package handlers

import (
	"testing"

	"github.com/google/uuid"
)

// These test the pure, DB-free pieces of the Phase 1 Redis caching added to
// authAgent/GetRules (see the comment block above cachedAgentToken in
// agents.go). The cache-hit/miss/invalidation behavior itself is verified
// live against the running stack — see scripts/loadtest/README.md — since
// this repo's test suite doesn't stand up a Postgres+Redis harness (the
// existing handler tests are all pure-function tests; this follows that
// pattern rather than introducing a new one).

func TestRulesCacheKeyDiffersByEmployee(t *testing.T) {
	org := uuid.New()
	emp1 := uuid.New()
	emp2 := uuid.New()

	k1 := rulesCacheKey(org, &emp1)
	k2 := rulesCacheKey(org, &emp2)
	kNil := rulesCacheKey(org, nil)

	if k1 == k2 {
		t.Fatalf("different employees must not share a cache key: %q == %q", k1, k2)
	}
	if k1 == kNil || k2 == kNil {
		t.Fatalf("a nil-employee device must not collide with a real employee's cache entry")
	}
}

func TestRulesCacheKeyIsStableForSameInputs(t *testing.T) {
	org := uuid.New()
	emp := uuid.New()

	if rulesCacheKey(org, &emp) != rulesCacheKey(org, &emp) {
		t.Fatal("cache key must be deterministic for identical (org, employee) inputs")
	}
}

func TestRulesCacheKeyDiffersByOrg(t *testing.T) {
	org1 := uuid.New()
	org2 := uuid.New()
	emp := uuid.New()

	// This is a tenant-isolation guarantee, not just a cache-efficiency
	// detail: two orgs must never be able to read each other's rules via a
	// colliding cache key.
	if rulesCacheKey(org1, &emp) == rulesCacheKey(org2, &emp) {
		t.Fatal("different orgs must not share a cache key even with the same employee UUID")
	}
}

func TestAgentTokenCacheKeyIsScopedToDeviceAndKeyHash(t *testing.T) {
	dev := uuid.New().String()
	if agentTokenCacheKey(dev, "hashA") == agentTokenCacheKey(dev, "hashB") {
		t.Fatal("a stale/rotated token hash must not hit the same cache entry as the current one")
	}
	if agentTokenCacheKey(uuid.New().String(), "hashA") == agentTokenCacheKey(uuid.New().String(), "hashA") {
		t.Fatal("two different devices must not collide on the same key hash")
	}
}

func TestRulesETagChangesWithContentAndIsStableOtherwise(t *testing.T) {
	a := rulesETag(`{"rules":[{"domain":"a.com"}]}`)
	b := rulesETag(`{"rules":[{"domain":"b.com"}]}`)
	aAgain := rulesETag(`{"rules":[{"domain":"a.com"}]}`)

	if a == b {
		t.Fatal("different rule bodies must not produce the same ETag")
	}
	if a != aAgain {
		t.Fatal("identical rule bodies must produce the same ETag (this is what makes 304 possible)")
	}
	if len(a) < 3 || a[0] != '"' || a[len(a)-1] != '"' {
		t.Fatalf("ETag must be a quoted opaque string per RFC 7232, got %q", a)
	}
}
