package scoring

import (
	"testing"

	"github.com/aavishield/threatintel-service/internal/store"
)

func newStore() *store.Store {
	s := store.New()
	s.SetDomain("evil-malware.com", store.Entry{Source: "urlhaus", Category: "malware"})
	s.SetDomain("phish-login.net", store.Entry{Source: "openphish", Category: "phishing"})
	s.SetIP("203.0.113.66", store.Entry{Source: "feodotracker", Category: "botnet"})
	s.SetHash("abc123def456abc123def456abc123def456abc123def456abc123def4560000", store.Entry{Source: "malwarebazaar", Category: "malware"})
	return s
}

func TestDomainFeedHitBlocks(t *testing.T) {
	r := ScoreDomain(newStore(), "evil-malware.com", 80, 50)
	if r.Band != "block" || r.Score < 80 {
		t.Fatalf("expected block, got band=%s score=%d", r.Band, r.Score)
	}
	if !r.ThreatIntelHit || r.Category != "malware" || r.Source != "urlhaus" {
		t.Fatalf("expected malware/urlhaus hit, got %+v", r)
	}
}

func TestDomainSubdomainOfFeedHit(t *testing.T) {
	// A subdomain of a listed domain normalizes/looks up the bare host only for
	// the exact entry; here we verify the exact host hits.
	r := ScoreDomain(newStore(), "www.evil-malware.com", 80, 50)
	if r.Band != "block" {
		t.Fatalf("www. prefix should still hit, got %s", r.Band)
	}
}

func TestCleanDomainAllows(t *testing.T) {
	r := ScoreDomain(newStore(), "example.com", 80, 50)
	if r.Band != "allow" || r.Score != 0 {
		t.Fatalf("expected allow/0, got band=%s score=%d", r.Band, r.Score)
	}
	if r.ThreatIntelHit {
		t.Fatal("clean domain should not be a threat-intel hit")
	}
}

func TestDGADomainHeuristicAlerts(t *testing.T) {
	// High-entropy, non-listed domain -> heuristic points but not feed hit.
	r := ScoreDomain(newStore(), "x7k9qz2v8mwp3f.com", 80, 50)
	if r.Score == 0 {
		t.Fatalf("expected heuristic points for DGA-looking domain, got 0")
	}
	if r.ThreatIntelHit {
		t.Fatal("should not be a feed hit")
	}
}

func TestIPFeedHitBlocks(t *testing.T) {
	r := ScoreIP(newStore(), "203.0.113.66", 80, 50)
	if r.Band != "block" || r.Category != "botnet" {
		t.Fatalf("expected botnet block, got %+v", r)
	}
}

func TestCleanIPAllows(t *testing.T) {
	r := ScoreIP(newStore(), "8.8.8.8", 80, 50)
	if r.Band != "allow" {
		t.Fatalf("expected allow, got %s", r.Band)
	}
}

func TestHashFeedHitBlocks(t *testing.T) {
	r := ScoreHash(newStore(), "ABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF4560000", 80, 50)
	if r.Band != "block" || r.Score != 100 {
		t.Fatalf("expected block/100 (case-insensitive), got %+v", r)
	}
}

func TestBandThresholdOverride(t *testing.T) {
	// With a low block threshold, a heuristic-only DGA domain can block.
	r := ScoreDomain(newStore(), "x7k9qz2v8mwp3f.com", 5, 2)
	if r.Band != "block" {
		t.Fatalf("expected block under low threshold, got %s", r.Band)
	}
}
