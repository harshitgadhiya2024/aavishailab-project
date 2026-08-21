package handlers

import (
	"net/http"
	"strings"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// GlobalBlocklistHandler manages platform-wide domain rules — DomainRule
// rows with OrgID nil, which every org's own SWG evaluation already treats
// as a fallback beneath its org-specific rules (see swg.go's
// evaluateURL: "org_id = ? OR org_id IS NULL"). Before this, the only way to
// create one was the now-closed is_global loophole in CreateDomainRule; this
// is the actual, superadmin-only front door for the same capability.
type GlobalBlocklistHandler struct {
	db *gorm.DB
}

func NewGlobalBlocklistHandler(db *gorm.DB) *GlobalBlocklistHandler {
	return &GlobalBlocklistHandler{db: db}
}

// List handles GET /superadmin/blocklist
func (h *GlobalBlocklistHandler) List(c *gin.Context) {
	var rules []models.DomainRule
	h.db.Where("org_id IS NULL").Order("created_at DESC").Find(&rules)
	c.JSON(http.StatusOK, gin.H{"rules": rules, "total": len(rules)})
}

type globalBlocklistRequest struct {
	Domain   string `json:"domain" binding:"required"`
	Action   string `json:"action"`
	Category string `json:"category"`
	Reason   string `json:"reason"`
}

// Create handles POST /superadmin/blocklist
func (h *GlobalBlocklistHandler) Create(c *gin.Context) {
	var req globalBlocklistRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	domain := strings.ToLower(strings.TrimSpace(req.Domain))
	if domain == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "domain is required"})
		return
	}
	action := models.PolicyAction(req.Action)
	if action == "" {
		action = models.PolicyActionBlock
	}

	rule := models.DomainRule{
		OrgID:    nil,
		Domain:   domain,
		Action:   action,
		Category: req.Category,
		Reason:   req.Reason,
		Source:   "superadmin",
		Enabled:  true,
	}
	if err := h.db.Create(&rule).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create rule"})
		return
	}
	writeAudit(h.db, c, nil, "create", "global_blocklist", &rule.ID, map[string]any{"domain": domain, "action": string(action)})
	c.JSON(http.StatusCreated, rule)
}

// Toggle handles PATCH /superadmin/blocklist/:id
func (h *GlobalBlocklistHandler) Toggle(c *gin.Context) {
	var rule models.DomainRule
	if err := h.db.Where("id = ? AND org_id IS NULL", c.Param("id")).First(&rule).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Rule not found"})
		return
	}
	next := !rule.Enabled
	h.db.Model(&rule).Update("enabled", next)
	writeAudit(h.db, c, nil, "update", "global_blocklist", &rule.ID, map[string]any{"enabled": next})
	c.JSON(http.StatusOK, gin.H{"id": rule.ID, "enabled": next})
}

// Delete handles DELETE /superadmin/blocklist/:id
func (h *GlobalBlocklistHandler) Delete(c *gin.Context) {
	ruleID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad rule id"})
		return
	}
	result := h.db.Where("id = ? AND org_id IS NULL", ruleID).Delete(&models.DomainRule{})
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Rule not found"})
		return
	}
	writeAudit(h.db, c, nil, "delete", "global_blocklist", &ruleID, nil)
	c.JSON(http.StatusOK, gin.H{"message": "Rule deleted"})
}

// FeedStatus handles GET /superadmin/threat-feeds — read-only visibility
// into the free threat-intel feeds riskengine.StartFeedSyncLoop already
// syncs every 6h (URLhaus, OpenPhish, Feodo Tracker), which previously had
// no UI anywhere despite silently shaping every org's domain risk scoring.
func (h *GlobalBlocklistHandler) FeedStatus(c *gin.Context) {
	type feedStat struct {
		Source     string `json:"source"`
		Count      int64  `json:"count"`
		LastSeenAt string `json:"last_seen_at"`
	}
	var stats []feedStat
	h.db.Model(&models.ThreatIntelDomain{}).
		Select("source, count(*) as count, max(last_seen_at) as last_seen_at").
		Group("source").
		Scan(&stats)

	var total int64
	h.db.Model(&models.ThreatIntelDomain{}).Count(&total)

	c.JSON(http.StatusOK, gin.H{"feeds": stats, "total_indicators": total})
}
