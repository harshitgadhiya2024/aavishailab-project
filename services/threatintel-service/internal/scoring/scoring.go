// Package scoring turns reputation lookups + heuristics into a 0-100 risk
// score and a decision band (block / alert / allow).
package scoring

import (
	"strings"

	"github.com/aavishield/threatintel-service/internal/heuristics"
	"github.com/aavishield/threatintel-service/internal/store"
)

// Feed membership is near-ground-truth (someone already verified the indicator
// is bad), so it alone clears the block band; heuristics exist mainly to catch
// indicators not yet on a feed.
const (
	feedDomainScore = 85
	feedIPScore     = 90
	feedHashScore   = 100
)

type Result struct {
	Indicator      string   `json:"indicator"`
	Kind           string   `json:"kind"` // domain | ip | hash
	Score          int      `json:"score"`
	Band           string   `json:"band"`
	Category       string   `json:"category"`
	Source         string   `json:"source,omitempty"`
	ThreatIntelHit bool     `json:"threat_intel_hit"`
	Reasons        []string `json:"reasons"`
}

func band(score, blockT, alertT int) string {
	if alertT >= blockT {
		alertT = blockT - 1
	}
	switch {
	case score >= blockT:
		return "block"
	case score >= alertT:
		return "alert"
	default:
		return "allow"
	}
}

// ScoreDomain combines feed membership with DNS/name heuristics.
func ScoreDomain(s *store.Store, domain string, blockT, alertT int) Result {
	domain = strings.ToLower(strings.TrimSpace(domain))
	r := Result{Indicator: domain, Kind: "domain", Category: "uncategorized"}

	if e, ok := s.LookupDomain(domain); ok {
		r.Score += feedDomainScore
		r.ThreatIntelHit = true
		r.Category = e.Category
		r.Source = e.Source
		r.Reasons = append(r.Reasons, "listed on "+e.Source+" threat-intel feed ("+e.Category+")")
	}
	if hs, hr := heuristics.DNSAnomalyScore(domain); hs > 0 {
		r.Score += hs
		r.Reasons = append(r.Reasons, hr...)
	}
	if r.Score > 100 {
		r.Score = 100
	}
	if len(r.Reasons) == 0 {
		r.Reasons = []string{"no threat-intel indicators found"}
	}
	r.Band = band(r.Score, blockT, alertT)
	return r
}

func ScoreIP(s *store.Store, ip string, blockT, alertT int) Result {
	r := Result{Indicator: ip, Kind: "ip", Category: "uncategorized"}
	if e, ok := s.LookupIP(ip); ok {
		r.Score = feedIPScore
		r.ThreatIntelHit = true
		r.Category = e.Category
		r.Source = e.Source
		r.Reasons = []string{"listed on " + e.Source + " threat-intel feed (" + e.Category + ")"}
	} else {
		r.Reasons = []string{"no threat-intel indicators found"}
	}
	r.Band = band(r.Score, blockT, alertT)
	return r
}

func ScoreHash(s *store.Store, hash string, blockT, alertT int) Result {
	r := Result{Indicator: strings.ToLower(hash), Kind: "hash", Category: "uncategorized"}
	if e, ok := s.LookupHash(hash); ok {
		r.Score = feedHashScore
		r.ThreatIntelHit = true
		r.Category = e.Category
		r.Source = e.Source
		r.Reasons = []string{"file hash listed on " + e.Source + " (" + e.Category + ")"}
	} else {
		r.Reasons = []string{"no threat-intel indicators found"}
	}
	r.Band = band(r.Score, blockT, alertT)
	return r
}
