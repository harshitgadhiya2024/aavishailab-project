package riskengine

import (
	"strings"
	"time"

	"github.com/aavishield/admin-api/internal/models"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Assessment is the result of scoring a single domain. Score is 0-100;
// Reasons explains every contributing signal so the audit log (and whoever
// reads it) can see WHY a domain was scored the way it was — never just a
// bare number.
type Assessment struct {
	Domain        string
	Score         int
	Category      string
	Reasons       []string
	DomainAgeDays *int
	ThreatIntel   bool
}

const BlockThreshold = 80

// Assess computes a real, honest risk score for domain using only
// signals this system can actually back up — no paid APIs, no faked ML:
//
//  1. URL category risk — this org's own domain-rule/policy category data,
//     scored via the category's configured risk level (0-4).
//  2. Threat-intel membership — free open feeds (URLhaus malware domains,
//     OpenPhish phishing domains), synced periodically, no API key.
//  3. Domain age — via a real WHOIS lookup; newly-registered domains are a
//     well-established phishing/malware indicator.
//  4. DNS/name-structure heuristics — entropy, digit density, subdomain
//     depth (the same class of signal DGA detectors use).
func Assess(db *gorm.DB, domain string) Assessment {
	domain = strings.ToLower(strings.TrimSuffix(strings.TrimSpace(domain), "."))
	domain = strings.TrimPrefix(domain, "www.")

	a := Assessment{Domain: domain}

	// 1. Threat-intel feed membership — the strongest, most direct signal.
	// A confirmed hit on a live malware/phishing feed is close to ground
	// truth (someone already verified this domain is bad), so on its own it
	// scores comfortably past the block threshold — the other signals below
	// exist mainly to catch domains that AREN'T on a feed yet.
	var hit models.ThreatIntelDomain
	if err := db.Where("domain = ?", domain).First(&hit).Error; err == nil {
		a.ThreatIntel = true
		a.Category = hit.Category
		a.Score += 85
		a.Reasons = append(a.Reasons, "listed on "+hit.Source+" threat-intel feed ("+hit.Category+")")
	}

	// 2. URL category risk (existing category data, e.g. gambling, adult,
	// malware — whatever this org/global rules already categorize it as).
	if cat, riskLevel, ok := categoryFor(db, domain); ok {
		if a.Category == "" {
			a.Category = cat
		}
		contribution := riskLevel * 10 // risk_level is 0-4 -> up to 40 points
		a.Score += contribution
		if contribution > 0 {
			a.Reasons = append(a.Reasons, "category '"+cat+"' risk level "+itoa(riskLevel))
		}
	}

	// 3. Domain age via WHOIS — best-effort; nil means "couldn't determine,"
	// which contributes nothing rather than guessing.
	if age := DomainAgeDays(domain); age != nil {
		a.DomainAgeDays = age
		switch {
		case *age <= 7:
			a.Score += 25
			a.Reasons = append(a.Reasons, "domain registered within the last 7 days")
		case *age <= 30:
			a.Score += 15
			a.Reasons = append(a.Reasons, "domain registered within the last 30 days")
		}
	}

	// 4. DNS/name-structure heuristics.
	if dnsScore, dnsReasons := DNSAnomalyScore(domain); dnsScore > 0 {
		a.Score += dnsScore
		a.Reasons = append(a.Reasons, dnsReasons...)
	}

	if a.Score > 100 {
		a.Score = 100
	}
	if a.Category == "" {
		a.Category = "uncategorized"
	}
	return a
}

func itoa(n int) string {
	digits := "0123456789"
	if n == 0 {
		return "0"
	}
	var b []byte
	for n > 0 {
		b = append([]byte{digits[n%10]}, b...)
		n /= 10
	}
	return string(b)
}

// categoryFor looks up whatever category this system already has on file for
// domain (from existing domain rules) and that category's configured risk
// level. Returns ok=false if the domain has no existing categorization.
func categoryFor(db *gorm.DB, domain string) (category string, riskLevel int, ok bool) {
	var rule models.DomainRule
	if err := db.Where("domain = ? AND category != ''", domain).First(&rule).Error; err != nil {
		return "", 0, false
	}
	var uc models.URLCategory
	if err := db.Where("slug = ?", rule.Category).First(&uc).Error; err != nil {
		return rule.Category, 0, true
	}
	return rule.Category, uc.RiskLevel, true
}

// PersistAssessment upserts the assessment into domain_risk_assessments so
// there's a durable audit trail and repeat visits don't re-run WHOIS/feed
// lookups unnecessarily within a short window.
// A single INSERT ... ON CONFLICT on the unique domain index, rather than
// SELECT-then-UPDATE. Going through Create is what makes Reasons persist
// correctly: GORM only applies a field's serializer (here jsonb) on struct
// writes, so passing []string through Updates(map[string]any{...}) sent a
// Postgres array literal to a jsonb column and every refresh failed with
// SQLSTATE 22P02. The upsert also removes a race where two concurrent requests
// for the same domain both missed the SELECT and then collided on the index.
func PersistAssessment(db *gorm.DB, a Assessment) {
	rec := models.DomainRiskAssessment{
		Domain:         a.Domain,
		RiskScore:      a.Score,
		Category:       a.Category,
		Reasons:        a.Reasons,
		DomainAgeDays:  a.DomainAgeDays,
		ThreatIntelHit: a.ThreatIntel,
		AssessedAt:     time.Now(),
	}
	// deleted_at is reset so a soft-deleted row can't block re-assessment of
	// that domain forever — the unique index covers deleted rows too.
	db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "domain"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"risk_score", "category", "reasons", "domain_age_days",
			"threat_intel_hit", "assessed_at", "updated_at", "deleted_at",
		}),
	}).Create(&rec)
}
