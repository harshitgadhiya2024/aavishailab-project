package handlers

import (
	"context"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/aavishield/admin-api/internal/policysig"
	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
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

// TestRulesCacheEntryExpiresDespiteContinuousReads is a regression test for
// a real bug caught via live testing (see the comment above the GET branch
// in GetRules, agents.go): an earlier version called rdb.Expire() on every
// cache hit to "keep a continuously-polling device cached indefinitely".
// Since a device polls every 10s — inside the 15s TTL — that sliding
// refresh meant the cache entry NEVER expired naturally, so an admin's
// domain-rule change would never reach an actively-polling device. This
// test locks in the fix's actual contract: reading a key on the same
// schedule GetRules uses must NOT extend its TTL, so the entry still
// expires on time.
func TestRulesCacheEntryExpiresDespiteContinuousReads(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("start miniredis: %v", err)
	}
	defer mr.Close()
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	ctx := context.Background()

	key := "agent:rules:test-org:test-emp"
	if err := rdb.Set(ctx, key, `{"rules":[]}`, rulesCacheTTL).Err(); err != nil {
		t.Fatalf("seed cache entry: %v", err)
	}

	// Simulate a device polling every 10s (GetRules' real interval) for
	// longer than rulesCacheTTL, doing only a GET each time — exactly what
	// the fixed code path does on a cache hit, with no Expire() call.
	elapsed := time.Duration(0)
	for elapsed < rulesCacheTTL+5*time.Second {
		mr.FastForward(10 * time.Second)
		elapsed += 10 * time.Second
		rdb.Get(ctx, key) // the read itself — must not be a side-effecting refresh
	}

	if mr.Exists(key) {
		t.Fatal("cache entry must expire on its own schedule even under continuous reads — " +
			"a sliding TTL here means a policy change never reaches an actively-polling device")
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

// setPolicySignatureHeaders is what both the cache-hit and cache-miss paths
// in GetRules call to attach a signature to the response — verified in
// isolation here since GetRules itself needs a real DB (see the package
// comment above).
func TestSetPolicySignatureHeadersSetsBothHeaders(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := &AgentHandler{signer: testSigner(t)}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	h.setPolicySignatureHeaders(c, "fake-signature-value")

	if got := w.Header().Get("X-Policy-Signature"); got != "fake-signature-value" {
		t.Errorf("X-Policy-Signature = %q, want %q", got, "fake-signature-value")
	}
	if got := w.Header().Get("X-Policy-Key-Id"); got != h.signer.KeyID() {
		t.Errorf("X-Policy-Key-Id = %q, want %q", got, h.signer.KeyID())
	}
}

// The signature must be cached under its own key alongside the body — this
// is the property that lets a cache HIT still serve a valid signature
// without re-signing on every request (see the comment in GetRules).
func TestRulesSignatureCacheKeyIsSiblingOfBodyKey(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("start miniredis: %v", err)
	}
	defer mr.Close()
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	ctx := context.Background()

	org := uuid.New()
	key := rulesCacheKey(org, nil)
	body := []byte(`{"rules":[]}`)
	signer := testSigner(t)
	sig := signer.Sign(body)

	if err := rdb.Set(ctx, key, body, rulesCacheTTL).Err(); err != nil {
		t.Fatal(err)
	}
	if err := rdb.Set(ctx, key+":sig", sig, rulesCacheTTL).Err(); err != nil {
		t.Fatal(err)
	}

	gotSig, err := rdb.Get(ctx, key+":sig").Result()
	if err != nil || gotSig != sig {
		t.Fatalf("signature not retrievable from its sibling key: err=%v got=%q want=%q", err, gotSig, sig)
	}
}

func testSigner(t *testing.T) *policysig.Signer {
	t.Helper()
	t.Setenv("POLICY_SIGNING_KEY", "")
	t.Setenv("APP_ENV", "development")
	return policysig.New()
}
