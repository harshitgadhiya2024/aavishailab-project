package handlers

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/aavishield/admin-api/internal/shadowitclient"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type ShadowITHandler struct {
	db *gorm.DB
}

func NewShadowITHandler(db *gorm.DB) *ShadowITHandler {
	return &ShadowITHandler{db: db}
}

type discoveredApp struct {
	Domain    string     `json:"domain"`
	AppName   string     `json:"app_name"`
	Category  string     `json:"category"`
	RiskScore int        `json:"risk_score"`
	Matched   bool       `json:"matched"`
	Events    int64      `json:"events"`
	Users     int64      `json:"users"`
	FirstSeen *time.Time `json:"first_seen"`
	LastSeen  *time.Time `json:"last_seen"`
	Status    string     `json:"status"` // sanctioned | blocked | unreviewed
}

// DiscoveredApps handles GET /shadow-it/apps
// Rolls up activity events by destination domain, classifies each via
// shadowit-service, and marks each app's sanction status from the org's domain
// rules — turning the traffic we already log into an actionable app inventory.
func (h *ShadowITHandler) DiscoveredApps(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")
	if orgID == "" {
		c.JSON(http.StatusForbidden, gin.H{"error": "No organization context"})
		return
	}

	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "300"))
	if limit <= 0 || limit > 1000 {
		limit = 300
	}
	knownOnly := c.Query("known_only") == "true"

	type aggRow struct {
		TargetDomain string
		Events       int64
		Users        int64
		FirstSeen    *time.Time
		LastSeen     *time.Time
	}
	var rows []aggRow
	h.db.Model(&models.ActivityEvent{}).
		Select("target_domain, count(*) as events, count(distinct employee_id) as users, min(timestamp) as first_seen, max(timestamp) as last_seen").
		Where("org_id = ? AND target_domain <> ''", orgID).
		Group("target_domain").
		Order("events desc").
		Limit(limit).
		Scan(&rows)

	if len(rows) == 0 {
		c.JSON(http.StatusOK, gin.H{"apps": []discoveredApp{}, "total": 0})
		return
	}

	domains := make([]string, 0, len(rows))
	for _, r := range rows {
		domains = append(domains, r.TargetDomain)
	}

	// Classify (best-effort — if the service is down, everything is "unclassified").
	classMap := map[string]shadowitclient.AppResult{}
	if shadowitclient.Enabled() {
		if results, err := shadowitclient.Classify(c.Request.Context(), orgID, domains); err == nil {
			for _, res := range results {
				classMap[res.Domain] = res
			}
		}
	}

	// Sanction status from domain rules (org-specific or global).
	statusMap := h.sanctionStatus(orgID, domains)

	apps := make([]discoveredApp, 0, len(rows))
	for _, r := range rows {
		cls := classMap[normDomainKey(r.TargetDomain)]
		if cls.Domain == "" {
			cls = classMap[r.TargetDomain]
		}
		if knownOnly && !cls.Matched {
			continue
		}
		name := r.TargetDomain
		if cls.Matched && cls.App != "" {
			name = cls.App
		}
		category := "unknown"
		if cls.Category != "" {
			category = cls.Category
		}
		status := statusMap[normDomainKey(r.TargetDomain)]
		if status == "" {
			status = "unreviewed"
		}
		apps = append(apps, discoveredApp{
			Domain:    r.TargetDomain,
			AppName:   name,
			Category:  category,
			RiskScore: cls.RiskScore,
			Matched:   cls.Matched,
			Events:    r.Events,
			Users:     r.Users,
			FirstSeen: r.FirstSeen,
			LastSeen:  r.LastSeen,
			Status:    status,
		})
	}

	c.JSON(http.StatusOK, gin.H{"apps": apps, "total": len(apps)})
}

// Sanction handles POST /shadow-it/apps/sanction
// Closes the loop from discovery to control: sanction (allow), unsanction
// (block), or reset to unreviewed (remove the shadow-IT rule) for a domain.
func (h *ShadowITHandler) Sanction(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")
	if orgID == "" {
		c.JSON(http.StatusForbidden, gin.H{"error": "No organization context"})
		return
	}
	var req struct {
		Domain string `json:"domain" binding:"required"`
		Action string `json:"action" binding:"required"` // sanction | unsanction | unreviewed
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "domain and action required"})
		return
	}
	domain := normDomainKey(req.Domain)
	orgUUID, err := uuid.Parse(orgID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad org"})
		return
	}

	// The shadow-IT decision is expressed as a domain rule sourced "shadow_it",
	// so it flows to agents through the exact same enforcement path as every
	// other block/allow rule.
	var existing models.DomainRule
	found := h.db.Where("org_id = ? AND domain = ? AND source = ?", orgUUID, domain, "shadow_it").First(&existing).Error == nil

	if req.Action == "unreviewed" {
		if found {
			h.db.Delete(&existing)
		}
		c.JSON(http.StatusOK, gin.H{"status": "unreviewed", "domain": domain})
		return
	}

	action := models.PolicyActionAllow
	status := "sanctioned"
	if req.Action == "unsanction" {
		action = models.PolicyActionBlock
		status = "blocked"
	}

	if found {
		h.db.Model(&existing).Updates(map[string]any{"action": action, "enabled": true})
	} else {
		h.db.Create(&models.DomainRule{
			OrgID:    &orgUUID,
			Domain:   domain,
			Action:   action,
			Category: "shadow_it",
			Reason:   "Shadow IT review decision",
			Source:   "shadow_it",
			Enabled:  true,
		})
	}
	c.JSON(http.StatusOK, gin.H{"status": status, "domain": domain})
}

// sanctionStatus maps each domain to sanctioned/blocked/"" from domain rules.
func (h *ShadowITHandler) sanctionStatus(orgID string, domains []string) map[string]string {
	normed := make([]string, 0, len(domains))
	for _, d := range domains {
		normed = append(normed, normDomainKey(d))
	}
	var rules []models.DomainRule
	h.db.Where("(org_id = ? OR org_id IS NULL) AND domain IN ?", orgID, normed).Find(&rules)

	out := map[string]string{}
	for i := range rules {
		r := &rules[i]
		switch r.Action {
		case models.PolicyActionBlock:
			out[r.Domain] = "blocked"
		case models.PolicyActionAllow:
			// Don't let a global allow override an explicit block already set.
			if out[r.Domain] == "" {
				out[r.Domain] = "sanctioned"
			}
		}
	}
	return out
}

func normDomainKey(d string) string {
	d = strings.ToLower(strings.TrimSpace(strings.TrimSuffix(d, ".")))
	return strings.TrimPrefix(d, "www.")
}
