package riskengine

import (
	"context"
	"log"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/aavishield/admin-api/internal/dataplane"
	"github.com/aavishield/admin-api/internal/models"
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

	lastTenantScan time.Time
}

// Companies that keep employee data in their own database are scanned less
// often than Aavishield's (every tenantScanEvery, over the last
// tenantLookback): each scan is a query against someone else's server. Only
// domain names come back — never who visited them — and they feed the same
// platform-wide assessment as everyone else's.
const (
	tenantScanEvery = 5 * time.Minute
	tenantLookback  = 30 * time.Minute
)

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
	if time.Since(w.lastTenantScan) >= tenantScanEvery {
		w.lastTenantScan = time.Now()
		domains = append(domains, w.unassessedTenantDomains()...)
	}
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

// unassessedTenantDomains is unassessedRecentDomains for companies on their
// own database: the domains come from their stores, the "already ruled or
// assessed" filter from Aavishield's tables.
func (w *AssessmentWorker) unassessedTenantDomains() []string {
	ctx := context.Background()
	orgs, err := dataplane.TenantOrgs(ctx)
	if err != nil || len(orgs) == 0 {
		return nil
	}
	seen := map[string]bool{}
	var candidates []string
	for _, org := range orgs {
		st, err := dataplane.Events(ctx, org)
		if err != nil {
			continue
		}
		groups, err := st.GroupEvents(ctx, dataplane.EventQuery{
			OrgID: org, Since: time.Now().Add(-tenantLookback), HasTargetDomain: true,
		}, "target_domain", 500)
		if err != nil {
			continue
		}
		for _, g := range groups {
			d := strings.ToLower(g.Key)
			if !seen[d] {
				seen[d] = true
				candidates = append(candidates, d)
			}
		}
	}
	if len(candidates) == 0 {
		return nil
	}
	var ruled, assessed []string
	w.db.Model(&models.DomainRule{}).Where("enabled = true AND domain IN ?", candidates).Pluck("domain", &ruled)
	w.db.Model(&models.DomainRiskAssessment{}).Where("assessed_at >= ? AND domain IN ?", time.Now().Add(-time.Hour), candidates).Pluck("domain", &assessed)
	skip := map[string]bool{}
	for _, d := range append(ruled, assessed...) {
		skip[strings.ToLower(d)] = true
	}
	var out []string
	for _, d := range candidates {
		if !skip[d] && len(out) < 200 {
			out = append(out, d)
		}
	}
	return out
}
