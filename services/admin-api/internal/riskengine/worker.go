package riskengine

import (
	"log"
	"strings"
	"time"

	"github.com/aavishield/admin-api/internal/models"
	"gorm.io/gorm"
)

// AssessmentWorker periodically scans recently-visited domains that haven't
// been risk-assessed yet, scores them, and — for anything scoring above
// BlockThreshold — creates a global block rule so every org's agents pick it
// up on their next rules poll (within ~10s, per the agent's refresh
// interval).
//
// Honest limitation: a domain's very first-ever visit anywhere is what
// triggers assessment, so that first visit itself isn't blocked pre-emptively
// unless it's already on a threat-intel feed (those are pre-synced ahead of
// any visit). Every visit after assessment completes (typically within one
// worker tick) is blocked. Doing this synchronously per-request instead would
// add multi-second WHOIS-lookup latency to every single new site an employee
// opens, which is a worse trade-off for an MVP.
type AssessmentWorker struct {
	db       *gorm.DB
	interval time.Duration
	lookback time.Duration
}

func NewAssessmentWorker(db *gorm.DB, interval, lookback time.Duration) *AssessmentWorker {
	return &AssessmentWorker{db: db, interval: interval, lookback: lookback}
}

func (w *AssessmentWorker) Start() {
	go func() {
		ticker := time.NewTicker(w.interval)
		for range ticker.C {
			w.tick()
		}
	}()
}

func (w *AssessmentWorker) tick() {
	domains := w.unassessedRecentDomains()
	for _, domain := range domains {
		a := Assess(w.db, domain)
		PersistAssessment(w.db, a)

		if a.Score > BlockThreshold {
			w.createRiskBlock(a)
			log.Printf("risk-engine: blocked %s (score=%d, category=%s)", a.Domain, a.Score, a.Category)
		}
	}
}

// unassessedRecentDomains returns distinct domains seen in activity within
// the lookback window that don't already have an existing domain rule and
// haven't been assessed in the last hour (avoids hammering WHOIS servers for
// a domain that gets visited repeatedly).
func (w *AssessmentWorker) unassessedRecentDomains() []string {
	var domains []string
	since := time.Now().Add(-w.lookback)
	reassessCutoff := time.Now().Add(-1 * time.Hour)

	w.db.Raw(`
		SELECT DISTINCT ae.target_domain
		FROM activity_events ae
		WHERE ae.timestamp >= ?
		  AND ae.target_domain != ''
		  AND NOT EXISTS (
		      SELECT 1 FROM domain_rules dr
		      WHERE dr.domain = ae.target_domain AND dr.enabled = true
		  )
		  AND NOT EXISTS (
		      SELECT 1 FROM domain_risk_assessments dra
		      WHERE dra.domain = ae.target_domain AND dra.assessed_at >= ?
		  )
		LIMIT 200`, since, reassessCutoff).Scan(&domains)

	return domains
}

func (w *AssessmentWorker) createRiskBlock(a Assessment) {
	rule := models.DomainRule{
		OrgID:     nil, // global — a malicious domain is malicious for every org
		Domain:    a.Domain,
		Action:    models.PolicyActionBlock,
		Category:  "malware_detection",
		Reason:    "Automated risk assessment: " + strings.Join(a.Reasons, "; "),
		Source:    "risk_engine",
		RiskScore: a.Score,
		Enabled:   true,
	}
	w.db.Create(&rule)
}
