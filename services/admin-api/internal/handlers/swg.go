package handlers

import (
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/aavishield/admin-api/internal/middleware"
	"github.com/aavishield/admin-api/internal/models"
	"github.com/aavishield/admin-api/internal/riskengine"
	"github.com/aavishield/admin-api/internal/threatintelclient"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type SWGHandler struct {
	db *gorm.DB
}

func NewSWGHandler(db *gorm.DB) *SWGHandler {
	return &SWGHandler{db: db}
}

// ThreatLookup handles GET /swg/threat-lookup?domain=|ip=|hash=
// Dashboard-facing reputation check. Proxies to threatintel-service when
// configured (covering domains, IPs, and file hashes); otherwise falls back to
// the in-process riskengine for domains only.
func (h *SWGHandler) ThreatLookup(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")
	if orgID == "" {
		c.JSON(http.StatusForbidden, gin.H{"error": "No organization context"})
		return
	}

	var kind, indicator string
	switch {
	case c.Query("domain") != "":
		kind, indicator = "domain", strings.TrimSpace(c.Query("domain"))
	case c.Query("ip") != "":
		kind, indicator = "ip", strings.TrimSpace(c.Query("ip"))
	case c.Query("hash") != "":
		kind, indicator = "hash", strings.TrimSpace(c.Query("hash"))
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "one of domain/ip/hash query params required"})
		return
	}

	if threatintelclient.Enabled() {
		if r, err := threatintelclient.Lookup(orgID, kind, indicator); err == nil {
			c.JSON(http.StatusOK, r)
			return
		}
		// fall through to in-process fallback on error
	}

	if kind != "domain" {
		// The in-process engine only scores domains; IP/hash intel needs the
		// microservice. Report an honest "unknown" rather than a false clean.
		c.JSON(http.StatusOK, gin.H{
			"indicator": indicator, "kind": kind, "score": 0, "band": "allow",
			"threat_intel_hit": false, "category": "unknown",
			"reasons": []string{"IP/hash reputation requires threatintel-service (not configured)"},
		})
		return
	}

	a := riskengine.Assess(h.db, indicator)
	band := "allow"
	if a.Score >= 80 {
		band = "block"
	} else if a.Score >= 50 {
		band = "alert"
	}
	c.JSON(http.StatusOK, gin.H{
		"indicator": a.Domain, "kind": "domain", "score": a.Score, "band": band,
		"category": a.Category, "threat_intel_hit": a.ThreatIntel, "reasons": a.Reasons,
	})
}

// ─── Domain Rules ──────────────────────────────────────────────────────────────

// ListDomainRules handles GET /swg/rules
func (h *SWGHandler) ListDomainRules(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")

	page, _  := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	search   := c.Query("search")
	action   := c.Query("action")
	category := c.Query("category")

	if page < 1 { page = 1 }
	if limit > 200 { limit = 200 }

	q := h.db.Where("org_id = ? OR org_id IS NULL", orgID)
	if search != "" {
		q = q.Where("domain LIKE ?", "%"+search+"%")
	}
	if action != "" {
		q = q.Where("action = ?", action)
	}
	if category != "" {
		q = q.Where("category = ?", category)
	}

	var total int64
	q.Model(&models.DomainRule{}).Count(&total)

	var rules []models.DomainRule
	q.Order("created_at DESC").Offset((page-1)*limit).Limit(limit).Find(&rules)

	c.JSON(http.StatusOK, gin.H{"data": rules, "total": total, "page": page, "limit": limit})
}

// CreateDomainRule handles POST /swg/rules
func (h *SWGHandler) CreateDomainRule(c *gin.Context) {
	orgID := middleware.GetScopedOrgID(c)
	orgUUID, _ := uuid.Parse(orgID)

	var req struct {
		Domain    string `json:"domain" binding:"required"`
		Action    string `json:"action"`
		RuleType  string `json:"rule_type"`
		Category  string `json:"category"`
		Reason    string `json:"reason"`
		IsGlobal  bool   `json:"is_global"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	action := req.Action
	if action == "" {
		action = req.RuleType
	}
	if action == "" {
		action = "block"
	}

	rule := models.DomainRule{
		Domain:   req.Domain,
		Action:   models.PolicyAction(action),
		Category: req.Category,
		Reason:   req.Reason,
		Enabled:  true,
	}
	if !req.IsGlobal {
		rule.OrgID = &orgUUID
	}

	if err := h.db.Create(&rule).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create rule"})
		return
	}
	c.JSON(http.StatusCreated, rule)
}

// DeleteDomainRule handles DELETE /swg/rules/:id
func (h *SWGHandler) DeleteDomainRule(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")
	ruleID := c.Param("id")

	result := h.db.Where("id = ? AND org_id = ?", ruleID, orgID).Delete(&models.DomainRule{})
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Rule not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Rule deleted"})
}

// ─── URL Categories ────────────────────────────────────────────────────────────

// ListCategories handles GET /swg/categories
func (h *SWGHandler) ListCategories(c *gin.Context) {
	var categories []models.URLCategory
	h.db.Order("name ASC").Find(&categories)
	c.JSON(http.StatusOK, categories)
}

// ─── SWG Stats ─────────────────────────────────────────────────────────────────

// Stats handles GET /swg/stats
func (h *SWGHandler) Stats(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")

	type CategoryStat struct {
		Category string `json:"category"`
		Count    int    `json:"count"`
	}
	var topBlocked []CategoryStat
	h.db.Raw(`SELECT category, COUNT(*) as count
		FROM activity_events
		WHERE org_id = ? AND action = 'blocked' AND category != ''
		GROUP BY category ORDER BY count DESC LIMIT 10`, orgID).Scan(&topBlocked)

	var topBlockedDomains []struct {
		Domain string `json:"domain"`
		Count  int    `json:"count"`
	}
	h.db.Raw(`SELECT target_domain as domain, COUNT(*) as count
		FROM activity_events
		WHERE org_id = ? AND action = 'blocked' AND target_domain != ''
		GROUP BY target_domain ORDER BY count DESC LIMIT 10`, orgID).Scan(&topBlockedDomains)

	var totalBlocked, totalAllowed int64
	h.db.Model(&models.ActivityEvent{}).
		Where("org_id = ? AND event_type IN ('web_request', 'dns_query') AND action = 'blocked'", orgID).
		Count(&totalBlocked)
	h.db.Model(&models.ActivityEvent{}).
		Where("org_id = ? AND event_type IN ('web_request', 'dns_query') AND action = 'allowed'", orgID).
		Count(&totalAllowed)

	var ruleCount int64
	h.db.Model(&models.DomainRule{}).Where("org_id = ? OR org_id IS NULL", orgID).Count(&ruleCount)

	c.JSON(http.StatusOK, gin.H{
		"total_blocked":       totalBlocked,
		"total_allowed":       totalAllowed,
		"top_blocked_categories": topBlocked,
		"top_blocked_domains":    topBlockedDomains,
		"rule_count":          ruleCount,
	})
}

// ─── Policy Check ──────────────────────────────────────────────────────────────

// CheckURLDashboard handles POST /swg/check for the company dashboard.
func (h *SWGHandler) CheckURLDashboard(c *gin.Context) {
	orgID := middleware.GetScopedOrgID(c)

	var req struct {
		URL    string `json:"url" binding:"required"`
		Domain string `json:"domain"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	domain := req.Domain
	if domain == "" {
		domain = extractDomainFromURL(req.URL)
	}
	if domain == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid URL or domain"})
		return
	}

	result := h.evaluateURL(orgID, domain, "")
	blocked := result["action"] == "block" || result["action"] == models.PolicyActionBlock
	c.JSON(http.StatusOK, gin.H{
		"blocked":  blocked,
		"action":   result["action"],
		"reason":   result["reason"],
		"category": result["category"],
		"domain":   domain,
		"rule_id":  result["rule_id"],
		"policy_id": result["policy_id"],
	})
}

func extractDomainFromURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if !strings.Contains(raw, "://") {
		raw = "https://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return ""
	}
	host := u.Hostname()
	return strings.TrimPrefix(strings.ToLower(host), "www.")
}

func (h *SWGHandler) evaluateURL(orgID, domain, category string) gin.H {
	var rule models.DomainRule
	err := h.db.Where("(org_id = ? OR org_id IS NULL) AND domain = ? AND enabled = true", orgID, domain).
		Order("org_id DESC NULLS LAST").
		First(&rule).Error

	if err == nil {
		return gin.H{
			"action":   rule.Action,
			"reason":   rule.Reason,
			"category": rule.Category,
			"rule_id":  rule.ID,
		}
	}

	var policies []models.Policy
	h.db.Where("org_id = ? AND enabled = true", orgID).
		Order("priority ASC").
		Find(&policies)

	for _, p := range policies {
		categories, _ := p.Rules["categories"].([]any)
		for _, cat := range categories {
			if cat == category {
				return gin.H{
					"action":      p.Action,
					"policy_id":   p.ID,
					"policy_name": p.Name,
					"reason":      "Category blocked: " + category,
				}
			}
		}
		// Check explicit URL/domain lists in policy rules
		if urls, ok := p.Rules["urls"].([]any); ok {
			for _, u := range urls {
				if strings.EqualFold(domain, strings.TrimSpace(u.(string))) {
					return gin.H{
						"action":      p.Action,
						"policy_id":   p.ID,
						"policy_name": p.Name,
						"reason":      "URL blocked by policy: " + p.Name,
					}
				}
			}
		}
		if domains, ok := p.Rules["domains"].([]any); ok {
			for _, d := range domains {
				if strings.EqualFold(domain, strings.TrimSpace(d.(string))) {
					return gin.H{
						"action":      p.Action,
						"policy_id":   p.ID,
						"policy_name": p.Name,
						"reason":      "Domain blocked by policy: " + p.Name,
					}
				}
			}
		}
	}

	return gin.H{"action": "allow", "reason": "no matching rule"}
}
